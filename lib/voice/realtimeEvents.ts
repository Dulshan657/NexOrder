// The OpenAI Realtime events this app sends and reads over the WebRTC data
// channel ("oai-events").
//
// Server events are an EXTERNAL boundary, so each one the app uses is parsed with
// zod rather than cast. Anything else the server sends (rate limits, output item
// bookkeeping, content parts) parses to `null` and the caller ignores it. Parsing
// is deliberately forgiving about the parts nothing here depends on: a malformed
// `usage` block must not cost the user their tool call, so the `response.done`
// schema drops a bad usage or a bad output item instead of rejecting the event.
//
// The client events are the three the session needs: a typed user message, the
// result of a function call, and "now answer".

import { z } from 'zod'

// ── Client events ─────────────────────────────────────────────────────────────

export interface UserTextItemEvent {
  type: 'conversation.item.create'
  item: { id?: string; type: 'message'; role: 'user'; content: Array<{ type: 'input_text'; text: string }> }
}

export interface FunctionOutputItemEvent {
  type: 'conversation.item.create'
  item: { type: 'function_call_output'; call_id: string; output: string }
}

export interface ResponseCreateEvent {
  type: 'response.create'
}

export type ClientEvent = UserTextItemEvent | FunctionOutputItemEvent | ResponseCreateEvent

/**
 * A typed user message. Pass `itemId` to name the item yourself: the server then
 * echoes it back under that id, so a transcript that already shows the line
 * updates it instead of showing it twice.
 */
export function userTextItem(text: string, itemId?: string): UserTextItemEvent {
  return {
    type: 'conversation.item.create',
    item: {
      ...(itemId === undefined ? {} : { id: itemId }),
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    },
  }
}

/** The answer to a function call. `outputJson` is already a JSON string. */
export function functionOutputItem(callId: string, outputJson: string): FunctionOutputItemEvent {
  return { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: outputJson } }
}

/** Ask the model to respond now (it does not, after a function result, until told to). */
export function responseCreate(): ResponseCreateEvent {
  return { type: 'response.create' }
}

// ── Server events ─────────────────────────────────────────────────────────────

/** Keep the items of an array that match `schema` and drop the ones that do not. */
function lenientArray<T extends z.ZodTypeAny>(schema: T) {
  return z.array(z.unknown()).transform((values): Array<z.infer<T>> =>
    values.flatMap((value) => {
      const parsed = schema.safeParse(value)
      return parsed.success ? [parsed.data as z.infer<T>] : []
    }),
  )
}

const contentPart = z
  .object({ type: z.string(), text: z.string().nullish(), transcript: z.string().nullish() })
  .passthrough()

const conversationItem = z
  .object({
    id: z.string(),
    type: z.string(),
    role: z.string().optional(),
    content: lenientArray(contentPart).optional(),
  })
  .passthrough()

/** An item in `response.output`. `id` may be absent; a function call is still a function call. */
const outputItem = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    role: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    content: lenientArray(contentPart).optional(),
  })
  .passthrough()

const usage = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    input_token_details: z
      .object({ text_tokens: z.number().optional(), audio_tokens: z.number().optional(), cached_tokens: z.number().optional() })
      .passthrough()
      .optional(),
    output_token_details: z
      .object({ text_tokens: z.number().optional(), audio_tokens: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()

const finishedResponse = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    output: lenientArray(outputItem).catch([]).default([]),
    usage: usage.optional().catch(undefined),
  })
  .passthrough()

const bare = <T extends string>(type: T) => z.object({ type: z.literal(type) }).passthrough()

const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.created'), session: z.object({ id: z.string().optional() }).passthrough().optional() }).passthrough(),
  z.object({ type: z.literal('input_audio_buffer.speech_started'), item_id: z.string() }).passthrough(),
  z.object({ type: z.literal('input_audio_buffer.speech_stopped'), item_id: z.string().optional() }).passthrough(),
  z.object({ type: z.literal('conversation.item.added'), item: conversationItem }).passthrough(),
  z
    .object({ type: z.literal('conversation.item.input_audio_transcription.completed'), item_id: z.string(), transcript: z.string() })
    .passthrough(),
  z.object({ type: z.literal('response.created'), response: z.object({ id: z.string().optional() }).passthrough().optional() }).passthrough(),
  z.object({ type: z.literal('response.output_audio_transcript.delta'), item_id: z.string(), delta: z.string() }).passthrough(),
  z.object({ type: z.literal('response.output_audio_transcript.done'), item_id: z.string(), transcript: z.string() }).passthrough(),
  bare('response.output_audio.delta'),
  bare('output_audio_buffer.started'),
  bare('output_audio_buffer.stopped'),
  bare('output_audio_buffer.cleared'),
  z
    .object({ type: z.literal('response.function_call_arguments.done'), call_id: z.string(), name: z.string(), arguments: z.string() })
    .passthrough(),
  z.object({ type: z.literal('response.done'), response: finishedResponse }).passthrough(),
  bare('response.cancelled'),
  z
    .object({
      type: z.literal('error'),
      error: z.object({ type: z.string().optional(), code: z.string().nullish(), message: z.string().optional() }).passthrough(),
    })
    .passthrough(),
])

export type ServerEvent = z.infer<typeof serverEventSchema>
export type ServerEventType = ServerEvent['type']
export type ConversationItem = z.infer<typeof conversationItem>
export type ResponseOutputItem = z.infer<typeof outputItem>
export type ResponseUsage = z.infer<typeof usage>

/**
 * One message off the data channel. `raw` is the string the channel delivered,
 * or an object already parsed. Returns null for text that is not JSON, for an
 * event type the app does not use, and for one missing a field it depends on.
 */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const parsed = serverEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
