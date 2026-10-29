// The conversation as the screen shows it, rebuilt from the Realtime event stream.
//
//   state' = reduceTranscript(state, event)      pure; never changes `state`
//
// Entries are keyed by the server's item id and ORDERED BY FIRST SIGHTING. That
// matters because the transcription of what the user said is produced by a
// separate model and routinely lands AFTER the assistant has started, or even
// finished, answering. Ordering by arrival would put the question under its
// answer. Instead a user line is created the moment speech starts (or the typed
// item is added), shows as in progress, and is filled in whenever its
// transcription turns up; it never moves.
//
// `live` is what the status pill shows:
//   response.created                  thinking
//   first sound of the answer         speaking   (a transcript delta, an audio delta,
//                                                 or output_audio_buffer.started)
//   response.done / response.cancelled listening
//
// Over WebRTC the audio is a media track, not data-channel events, and a response
// finishes GENERATING well before it finishes PLAYING. output_audio_buffer.started
// and .stopped bracket the playback, so `response.done` keeps the state at
// `speaking` while audio is still playing, and the .stopped event ends it. If the
// user speaks over the assistant, or the buffer is cleared, it ends at once.

import type { ConversationItem, ResponseOutputItem, ServerEvent } from './realtimeEvents'

export type LiveState = 'listening' | 'thinking' | 'speaking'
export type EntryRole = 'user' | 'assistant'

export interface TranscriptEntry {
  /** The Realtime item id. */
  readonly id: string
  readonly role: EntryRole
  readonly text: string
  /** False while the words are still arriving. */
  readonly final: boolean
}

export interface FunctionCall {
  readonly callId: string
  readonly name: string
  /** The JSON string the model produced, unparsed. */
  readonly arguments: string
}

export interface TranscriptState {
  readonly entries: readonly TranscriptEntry[]
  /** Every function call seen, once each, in order. Answering them is the session's job. */
  readonly calls: readonly FunctionCall[]
  readonly live: LiveState
  /** Audio of the answer is playing right now (WebRTC only). */
  readonly audioPlaying: boolean
}

export const INITIAL_TRANSCRIPT: TranscriptState = Object.freeze({
  entries: Object.freeze([]) as readonly TranscriptEntry[],
  calls: Object.freeze([]) as readonly FunctionCall[],
  live: 'listening',
  audioPlaying: false,
})

type Patch = (current: TranscriptEntry) => TranscriptEntry

/** Apply `patch` to the entry with this id, creating it (empty, in progress) at the end if it is new. */
function upsert(state: TranscriptState, id: string, role: EntryRole, patch: Patch): TranscriptState {
  const known = state.entries.some((entry) => entry.id === id)
  const entries = known
    ? state.entries.map((entry) => (entry.id === id ? patch(entry) : entry))
    : [...state.entries, patch({ id, role, text: '', final: false })]
  return { ...state, entries }
}

const without = (state: TranscriptState, id: string): TranscriptState => ({
  ...state,
  entries: state.entries.filter((entry) => entry.id !== id),
})

function speaking(state: TranscriptState): TranscriptState {
  return state.live === 'speaking' ? state : { ...state, live: 'speaking' }
}

/** The text of a part of this kind, if the item has one. */
function partText(item: ConversationItem | ResponseOutputItem, kind: 'input_text' | 'transcript'): string | undefined {
  for (const part of item.content ?? []) {
    const value = kind === 'transcript' ? part.transcript : part.type === 'input_text' ? part.text : undefined
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function onSpeechStarted(state: TranscriptState, itemId: string): TranscriptState {
  const started = upsert(state, itemId, 'user', (entry) => entry)
  return { ...started, live: 'listening', audioPlaying: false }
}

function onItemAdded(state: TranscriptState, item: ConversationItem): TranscriptState {
  if (item.type !== 'message' || item.role !== 'user') return state
  const typed = partText(item, 'input_text')
  return upsert(state, item.id, 'user', (entry) => (typed === undefined ? entry : { ...entry, text: typed, final: true }))
}

/** Shown for a line the transcriber could not have heard right. */
export const MISHEARD_TEXT = "(Didn't catch that)"

/**
 * Letters, but not one of them Latin: the session transcribes English, so this is
 * the transcriber hallucinating in another script on short or noisy audio (a demo
 * test turned "what's the weather?" into "Восстановлено."). Accented Latin ("Café
 * Olé") and digit-only lines pass.
 */
export function looksMisheard(text: string): boolean {
  return /\p{L}/u.test(text) && !/\p{Script=Latin}/u.test(text)
}

function onUserTranscript(state: TranscriptState, itemId: string, transcript: string): TranscriptState {
  const heard = transcript.trim()
  // The model heard something it could not make out: nothing worth a bubble.
  if (heard.length === 0) return without(state, itemId)
  const text = looksMisheard(heard) ? MISHEARD_TEXT : heard
  return upsert(state, itemId, 'user', (entry) => ({ ...entry, text, final: true }))
}

function onAssistantDelta(state: TranscriptState, itemId: string, delta: string): TranscriptState {
  const updated = upsert(state, itemId, 'assistant', (entry) => (entry.final ? entry : { ...entry, text: entry.text + delta }))
  return speaking(updated)
}

function onAssistantDone(state: TranscriptState, itemId: string, transcript: string): TranscriptState {
  return upsert(state, itemId, 'assistant', (entry) => ({ ...entry, text: transcript.trim() || entry.text, final: true }))
}

/** An assistant message in a finished response closes its line, whatever else arrived. */
function settleAssistant(state: TranscriptState, item: ResponseOutputItem): TranscriptState {
  if (item.type !== 'message' || item.role !== 'assistant' || !item.id) return state
  const spoken = partText(item, 'transcript')
  const exists = state.entries.some((entry) => entry.id === item.id)
  if (!exists && spoken === undefined) return state
  return upsert(state, item.id, 'assistant', (entry) => ({
    ...entry,
    text: entry.text.length > 0 ? entry.text : (spoken ?? ''),
    final: true,
  }))
}

function collectCalls(state: TranscriptState, output: readonly ResponseOutputItem[]): TranscriptState {
  const seen = new Set(state.calls.map((call) => call.callId))
  const fresh: FunctionCall[] = []
  for (const item of output) {
    if (item.type !== 'function_call' || !item.call_id || !item.name || seen.has(item.call_id)) continue
    seen.add(item.call_id)
    fresh.push({ callId: item.call_id, name: item.name, arguments: item.arguments ?? '' })
  }
  return fresh.length === 0 ? state : { ...state, calls: [...state.calls, ...fresh] }
}

function onResponseDone(state: TranscriptState, output: readonly ResponseOutputItem[]): TranscriptState {
  const settled = output.reduce(settleAssistant, collectCalls(state, output))
  return { ...settled, live: settled.audioPlaying ? 'speaking' : 'listening' }
}

function onAudioEnded(state: TranscriptState): TranscriptState {
  // A stale "stopped" must not cancel a newer "thinking".
  return { ...state, audioPlaying: false, live: state.live === 'speaking' ? 'listening' : state.live }
}

export function reduceTranscript(state: TranscriptState, event: ServerEvent): TranscriptState {
  switch (event.type) {
    case 'input_audio_buffer.speech_started':
      return onSpeechStarted(state, event.item_id)
    case 'conversation.item.added':
      return onItemAdded(state, event.item)
    case 'conversation.item.input_audio_transcription.completed':
      return onUserTranscript(state, event.item_id, event.transcript)
    case 'response.created':
      return { ...state, live: 'thinking', audioPlaying: false }
    case 'response.output_audio_transcript.delta':
      return onAssistantDelta(state, event.item_id, event.delta)
    case 'response.output_audio_transcript.done':
      return onAssistantDone(state, event.item_id, event.transcript)
    case 'response.output_audio.delta':
      return speaking(state)
    case 'output_audio_buffer.started':
      return { ...speaking(state), audioPlaying: true }
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      return onAudioEnded(state)
    case 'response.cancelled':
      return { ...state, live: 'listening', audioPlaying: false }
    case 'response.done':
      return onResponseDone(state, event.response.output)
    default:
      return state
  }
}
