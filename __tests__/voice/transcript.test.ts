import { describe, it, expect } from 'vitest'
import { parseServerEvent } from '../../lib/voice/realtimeEvents'
import { INITIAL_TRANSCRIPT, reduceTranscript } from '../../lib/voice/transcript'
import type { TranscriptState } from '../../lib/voice/transcript'
import { deepFreeze } from './voiceFixtures'

type Raw = Record<string, unknown>

/** Events go through the real parser, as they do on the data channel. */
function feed(state: TranscriptState, ...raws: Raw[]): TranscriptState {
  return raws.reduce((current, raw) => {
    const event = parseServerEvent(JSON.stringify(raw))
    return event ? reduceTranscript(current, event) : current
  }, state)
}

const speechStarted = (id: string): Raw => ({ type: 'input_audio_buffer.speech_started', item_id: id, audio_start_ms: 100 })
const userAudioItem = (id: string): Raw => ({
  type: 'conversation.item.added', previous_item_id: null,
  item: { id, type: 'message', role: 'user', content: [{ type: 'input_audio', transcript: null }] },
})
const userTyped = (id: string, text: string): Raw => ({
  type: 'conversation.item.added',
  item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
})
const transcribed = (id: string, transcript: string): Raw => ({
  type: 'conversation.item.input_audio_transcription.completed', item_id: id, content_index: 0, transcript,
})
const responseCreated = (id = 'resp_1'): Raw => ({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
const delta = (id: string, text: string): Raw => ({ type: 'response.output_audio_transcript.delta', item_id: id, delta: text })
const assistantDone = (id: string, text: string): Raw => ({ type: 'response.output_audio_transcript.done', item_id: id, transcript: text })
const responseDone = (output: Raw[] = [], status = 'completed'): Raw => ({ type: 'response.done', response: { id: 'resp_1', status, output } })
const functionCall = (callId: string, name = 'get_sales_summary'): Raw => ({
  id: `item_${callId}`, type: 'function_call', call_id: callId, name, arguments: '{"period":"today"}', status: 'completed',
})

describe('reduceTranscript', () => {
  describe('a spoken exchange that needs a tool', () => {
    // The recorded order of a real turn: the transcription of the user's words
    // arrives AFTER the assistant has finished answering.
    const events: Raw[] = [
      { type: 'session.created', session: { id: 'sess_1' } },
      speechStarted('item_u1'),
      { type: 'input_audio_buffer.speech_stopped', item_id: 'item_u1', audio_end_ms: 2100 },
      { type: 'input_audio_buffer.committed', item_id: 'item_u1' },
      userAudioItem('item_u1'),
      responseCreated('resp_1'),
      { type: 'response.function_call_arguments.done', call_id: 'call_1', name: 'get_sales_summary', arguments: '{"period":"today"}' },
      responseDone([functionCall('call_1')]),
      responseCreated('resp_2'),
      { type: 'output_audio_buffer.started', response_id: 'resp_2' },
      delta('item_a1', 'Sales today'),
      delta('item_a1', ' are about $1,200.'),
      assistantDone('item_a1', 'Sales today are about $1,200.'),
      responseDone([{ id: 'item_a1', type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'Sales today are about $1,200.' }] }]),
      transcribed('item_u1', 'How are sales today?\n'),
      { type: 'output_audio_buffer.stopped', response_id: 'resp_2' },
    ]

    it('orders the entries as the conversation happened, not as the transcripts arrived', () => {
      const end = feed(INITIAL_TRANSCRIPT, ...events)
      expect(end.entries.map((e) => [e.id, e.role])).toEqual([['item_u1', 'user'], ['item_a1', 'assistant']])
    })

    it('fills in the late user transcription and trims it', () => {
      const end = feed(INITIAL_TRANSCRIPT, ...events)
      expect(end.entries[0]).toMatchObject({ text: 'How are sales today?', final: true })
      expect(end.entries[1]).toMatchObject({ text: 'Sales today are about $1,200.', final: true })
    })

    it('shows the user line as in progress until its transcription lands', () => {
      const before = feed(INITIAL_TRANSCRIPT, ...events.slice(0, events.length - 2))
      expect(before.entries[0]).toMatchObject({ id: 'item_u1', text: '', final: false })
      expect(before.entries[1].final).toBe(true)
    })

    it('collects the function call once even though two events announce it', () => {
      const end = feed(INITIAL_TRANSCRIPT, ...events)
      expect(end.calls).toEqual([{ callId: 'call_1', name: 'get_sales_summary', arguments: '{"period":"today"}' }])
    })
  })

  describe('live state', () => {
    it('starts listening', () => {
      expect(INITIAL_TRANSCRIPT.live).toBe('listening')
    })

    it('goes thinking when a response is created', () => {
      expect(feed(INITIAL_TRANSCRIPT, responseCreated()).live).toBe('thinking')
    })

    it('goes speaking on the first sound of the answer, by any of its signals', () => {
      const thinking = feed(INITIAL_TRANSCRIPT, responseCreated())
      expect(feed(thinking, delta('a1', 'Hi')).live).toBe('speaking')
      expect(feed(thinking, { type: 'response.output_audio.delta', item_id: 'a1', delta: 'AAAA' }).live).toBe('speaking')
      expect(feed(thinking, { type: 'output_audio_buffer.started' }).live).toBe('speaking')
    })

    it('goes back to listening when the response is done or cancelled', () => {
      const speaking = feed(INITIAL_TRANSCRIPT, responseCreated(), delta('a1', 'Hi'))
      expect(feed(speaking, responseDone()).live).toBe('listening')
      expect(feed(speaking, { type: 'response.cancelled' }).live).toBe('listening')
      expect(feed(speaking, responseDone([], 'cancelled')).live).toBe('listening')
    })

    it('keeps speaking after response.done while the audio is still playing, until it stops', () => {
      const playing = feed(INITIAL_TRANSCRIPT, responseCreated(), { type: 'output_audio_buffer.started' }, delta('a1', 'Hi'))
      const generated = feed(playing, responseDone())
      expect(generated.live).toBe('speaking')
      expect(feed(generated, { type: 'output_audio_buffer.stopped' }).live).toBe('listening')
    })

    it('goes listening when the user talks over the assistant', () => {
      const speaking = feed(INITIAL_TRANSCRIPT, responseCreated(), { type: 'output_audio_buffer.started' }, delta('a1', 'Hi'))
      expect(feed(speaking, speechStarted('u2')).live).toBe('listening')
      expect(feed(speaking, { type: 'output_audio_buffer.cleared' }).live).toBe('listening')
    })

    it('does not let a late audio-stopped event cancel a newer thinking state', () => {
      const next = feed(INITIAL_TRANSCRIPT, responseCreated(), { type: 'output_audio_buffer.started' }, responseDone(), responseCreated('resp_2'))
      expect(next.live).toBe('thinking')
      expect(feed(next, { type: 'output_audio_buffer.stopped' }).live).toBe('thinking')
    })
  })

  describe('entries', () => {
    it('creates a user line when speech starts, before any transcript exists', () => {
      const state = feed(INITIAL_TRANSCRIPT, speechStarted('u1'))
      expect(state.entries).toEqual([{ id: 'u1', role: 'user', text: '', final: false }])
    })

    it('does not duplicate the line when the item event follows speech start', () => {
      expect(feed(INITIAL_TRANSCRIPT, speechStarted('u1'), userAudioItem('u1')).entries).toHaveLength(1)
    })

    it('creates a final user line from typed text', () => {
      expect(feed(INITIAL_TRANSCRIPT, userTyped('t1', 'stock levels?')).entries)
        .toEqual([{ id: 't1', role: 'user', text: 'stock levels?', final: true }])
    })

    it('does not duplicate a typed line when the server echoes the item the client already added', () => {
      const local = feed(INITIAL_TRANSCRIPT, userTyped('local-1', 'stock levels?'))
      expect(feed(local, userTyped('local-1', 'stock levels?')).entries).toHaveLength(1)
    })

    it('builds the assistant line from deltas and replaces it with the final transcript', () => {
      const partial = feed(INITIAL_TRANSCRIPT, responseCreated(), delta('a1', 'Sales '), delta('a1', 'are up'))
      expect(partial.entries).toEqual([{ id: 'a1', role: 'assistant', text: 'Sales are up', final: false }])
      const done = feed(partial, assistantDone('a1', 'Sales are up, about 12 percent.'))
      expect(done.entries).toEqual([{ id: 'a1', role: 'assistant', text: 'Sales are up, about 12 percent.', final: true }])
    })

    it('finalises an interrupted answer when the response ends without a done transcript', () => {
      const cut = feed(INITIAL_TRANSCRIPT, responseCreated(), delta('a1', 'Sales are'), responseDone(
        [{ id: 'a1', type: 'message', role: 'assistant', content: [] }], 'cancelled',
      ))
      expect(cut.entries).toEqual([{ id: 'a1', role: 'assistant', text: 'Sales are', final: true }])
    })

    it('uses the transcript on the finished response when no deltas were seen', () => {
      const state = feed(INITIAL_TRANSCRIPT, responseDone(
        [{ id: 'a9', type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'All good.' }] }],
      ))
      expect(state.entries).toEqual([{ id: 'a9', role: 'assistant', text: 'All good.', final: true }])
    })

    it('keeps conversation order across several turns', () => {
      const end = feed(
        INITIAL_TRANSCRIPT,
        speechStarted('u1'), userAudioItem('u1'), responseCreated('r1'), delta('a1', 'One.'), assistantDone('a1', 'One.'), responseDone(),
        speechStarted('u2'), userAudioItem('u2'), transcribed('u2', 'Two?'), transcribed('u1', 'One?'),
        responseCreated('r2'), delta('a2', 'Two.'), assistantDone('a2', 'Two.'), responseDone(),
      )
      expect(end.entries.map((e) => e.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
      expect(end.entries.map((e) => e.text)).toEqual(['One?', 'One.', 'Two?', 'Two.'])
    })

    it('places a transcription for an unseen item at the end rather than losing it', () => {
      expect(feed(INITIAL_TRANSCRIPT, transcribed('u7', 'hello')).entries)
        .toEqual([{ id: 'u7', role: 'user', text: 'hello', final: true }])
    })

    it('drops a user line whose transcription came back empty', () => {
      const state = feed(INITIAL_TRANSCRIPT, speechStarted('u1'), userAudioItem('u1'), transcribed('u1', ' \n'))
      expect(state.entries).toEqual([])
    })

    it('ignores items that are not messages, and messages from other roles', () => {
      const state = feed(
        INITIAL_TRANSCRIPT,
        { type: 'conversation.item.added', item: { id: 'f1', type: 'function_call_output', call_id: 'c', output: '{}' } },
        { type: 'conversation.item.added', item: { id: 's1', type: 'message', role: 'system', content: [{ type: 'input_text', text: 'secret' }] } },
      )
      expect(state.entries).toEqual([])
    })
  })

  describe('function calls', () => {
    it('collects each call_id once, in order, across responses', () => {
      const end = feed(
        INITIAL_TRANSCRIPT,
        responseDone([functionCall('c1'), functionCall('c2', 'find_customer')]),
        responseDone([functionCall('c2', 'find_customer'), functionCall('c3')]),
      )
      expect(end.calls.map((c) => c.callId)).toEqual(['c1', 'c2', 'c3'])
      expect(end.calls[1]).toMatchObject({ name: 'find_customer' })
    })

    it('ignores a function_call item that has no call id', () => {
      const end = feed(INITIAL_TRANSCRIPT, responseDone([{ id: 'x', type: 'function_call', name: 'find_customer', arguments: '{}' }]))
      expect(end.calls).toEqual([])
    })
  })

  describe('immutability', () => {
    it('never changes the state it was given', () => {
      // Each state is deep-frozen before the next event, so a write would throw.
      const script: Raw[] = [
        speechStarted('u1'), userAudioItem('u1'), responseCreated(), delta('a1', 'Hi'), assistantDone('a1', 'Hi there.'),
        responseDone([functionCall('c1')]), transcribed('u1', 'Hello'), { type: 'output_audio_buffer.stopped' },
      ]
      let state: TranscriptState = INITIAL_TRANSCRIPT
      for (const raw of script) state = feed(deepFreeze(state), raw)
      expect(state.entries.map((e) => e.text)).toEqual(['Hello', 'Hi there.'])
      expect(state.calls).toHaveLength(1)
    })

    it('returns the same state object for an event that changes nothing', () => {
      const state = feed(INITIAL_TRANSCRIPT, responseCreated())
      expect(feed(state, { type: 'session.created', session: { id: 's' } })).toBe(state)
      expect(feed(state, { type: 'input_audio_buffer.speech_stopped', item_id: 'u1' })).toBe(state)
    })

    it('leaves the earlier state untouched when a later event arrives', () => {
      const first = feed(INITIAL_TRANSCRIPT, speechStarted('u1'))
      const snapshot = JSON.stringify(first)
      feed(first, transcribed('u1', 'Hello'), responseCreated(), delta('a1', 'Hi'))
      expect(JSON.stringify(first)).toBe(snapshot)
    })
  })

  it("shows a non-Latin transcript as Didn't catch that", () => {
    // A demo test: "what's the weather?" came back from the transcriber as Russian.
    const misheard = feed(INITIAL_TRANSCRIPT, speechStarted('item_u1'), userAudioItem('item_u1'), transcribed('item_u1', 'Восстановлено.'))
    expect(misheard.entries[0]).toMatchObject({ role: 'user', text: "(Didn't catch that)", final: true })

    const english = feed(INITIAL_TRANSCRIPT, speechStarted('item_u2'), userAudioItem('item_u2'), transcribed('item_u2', 'Sales for Café Olé?'))
    expect(english.entries[0].text).toBe('Sales for Café Olé?')
    const digits = feed(INITIAL_TRANSCRIPT, speechStarted('item_u3'), userAudioItem('item_u3'), transcribed('item_u3', '42'))
    expect(digits.entries[0].text).toBe('42')
  })

  it('has an initial state with nothing in it', () => {
    expect(INITIAL_TRANSCRIPT).toMatchObject({ entries: [], calls: [], live: 'listening' })
  })
})
