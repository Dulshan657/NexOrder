import { describe, it, expect } from 'vitest'
import {
  functionOutputItem,
  parseServerEvent,
  responseCreate,
  userTextItem,
} from '../../lib/voice/realtimeEvents'

describe('client event builders', () => {
  it('builds a typed user message as a conversation item', () => {
    expect(userTextItem('How are sales today?')).toEqual({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'How are sales today?' }] },
    })
  })

  it('lets the caller choose the item id so its own echo can be matched', () => {
    expect(userTextItem('hello', 'local-1').item).toMatchObject({ id: 'local-1', role: 'user' })
    expect('id' in userTextItem('hello').item).toBe(false)
  })

  it('builds a function result carrying the call id and the output as a JSON string', () => {
    const output = JSON.stringify({ ok: true, basis: 'b', asOf: 'a', data: { revenue: 5 } })
    expect(functionOutputItem('call_1', output)).toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_1', output },
    })
  })

  it('builds a bare response.create', () => {
    expect(responseCreate()).toEqual({ type: 'response.create' })
  })

  it('returns fresh objects each time so a caller cannot share state through them', () => {
    expect(responseCreate()).not.toBe(responseCreate())
    expect(userTextItem('x').item.content).not.toBe(userTextItem('x').item.content)
  })

  it('produces JSON a data channel can carry', () => {
    const wire = JSON.stringify(userTextItem('quote " and newline \n done'))
    expect(JSON.parse(wire).item.content[0].text).toBe('quote " and newline \n done')
  })
})

describe('parseServerEvent', () => {
  const wire = (value: unknown): string => JSON.stringify(value)

  it('reads a JSON string off the data channel', () => {
    const event = parseServerEvent(wire({ type: 'session.created', event_id: 'e1', session: { id: 'sess_1' } }))
    expect(event).toMatchObject({ type: 'session.created', session: { id: 'sess_1' } })
  })

  it('also takes an already-parsed object', () => {
    expect(parseServerEvent({ type: 'response.created', response: { id: 'resp_1' } })).toMatchObject({ type: 'response.created' })
  })

  it('returns null for text that is not JSON, not an object, or has no type', () => {
    for (const bad of ['not json', '', '[]', '42', 'null', wire({ no: 'type' }), wire({ type: 7 }), null, undefined, 12, true]) {
      expect(parseServerEvent(bad)).toBeNull()
    }
  })

  it('returns null for an event type it does not handle', () => {
    expect(parseServerEvent(wire({ type: 'rate_limits.updated', rate_limits: [] }))).toBeNull()
    expect(parseServerEvent(wire({ type: 'response.output_item.added', item: {} }))).toBeNull()
  })

  it('returns null when a field the reducer depends on is missing or the wrong type', () => {
    expect(parseServerEvent(wire({ type: 'input_audio_buffer.speech_started' }))).toBeNull()
    expect(parseServerEvent(wire({ type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 5 }))).toBeNull()
    expect(parseServerEvent(wire({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1' }))).toBeNull()
    expect(parseServerEvent(wire({ type: 'conversation.item.added', item: { type: 'message' } }))).toBeNull()
  })

  it('reads speech, item and transcription events', () => {
    expect(parseServerEvent(wire({ type: 'input_audio_buffer.speech_started', item_id: 'u1', audio_start_ms: 320 })))
      .toMatchObject({ type: 'input_audio_buffer.speech_started', item_id: 'u1' })
    expect(parseServerEvent(wire({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' })))
      .toMatchObject({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' })
    expect(parseServerEvent(wire({
      type: 'conversation.item.added', previous_item_id: null,
      item: { id: 'u1', type: 'message', role: 'user', content: [{ type: 'input_audio', transcript: null }] },
    }))).toMatchObject({ item: { id: 'u1', role: 'user' } })
    expect(parseServerEvent(wire({
      type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', content_index: 0, transcript: 'hi\n',
    }))).toMatchObject({ item_id: 'u1', transcript: 'hi\n' })
  })

  it('reads the assistant transcript and audio buffer events', () => {
    expect(parseServerEvent(wire({ type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Sales' })))
      .toMatchObject({ item_id: 'a1', delta: 'Sales' })
    expect(parseServerEvent(wire({ type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'Sales are up.' })))
      .toMatchObject({ item_id: 'a1', transcript: 'Sales are up.' })
    for (const type of ['output_audio_buffer.started', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared', 'response.output_audio.delta', 'response.cancelled']) {
      expect(parseServerEvent(wire({ type }))).toMatchObject({ type })
    }
  })

  it('reads a function call argument event', () => {
    expect(parseServerEvent(wire({
      type: 'response.function_call_arguments.done', call_id: 'call_1', name: 'get_sales_summary', arguments: '{"period":"today"}',
    }))).toMatchObject({ call_id: 'call_1', name: 'get_sales_summary', arguments: '{"period":"today"}' })
  })

  it('reads an error event', () => {
    expect(parseServerEvent(wire({ type: 'error', error: { type: 'invalid_request_error', code: 'x', message: 'bad' } })))
      .toMatchObject({ type: 'error', error: { message: 'bad' } })
  })

  describe('response.done', () => {
    const done = {
      type: 'response.done',
      response: {
        id: 'resp_1',
        status: 'completed',
        output: [
          { id: 'item_fc', type: 'function_call', call_id: 'call_1', name: 'get_sales_summary', arguments: '{"period":"today"}', status: 'completed' },
          { id: 'item_a', type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'Sales are up.' }] },
        ],
        usage: {
          total_tokens: 100, input_tokens: 60, output_tokens: 40,
          input_token_details: { text_tokens: 10, audio_tokens: 50, cached_tokens: 5 },
          output_token_details: { text_tokens: 4, audio_tokens: 36 },
        },
      },
    }

    it('carries output items and usage', () => {
      const event = parseServerEvent(wire(done))
      expect(event).toMatchObject({ type: 'response.done', response: { status: 'completed' } })
      if (event?.type !== 'response.done') throw new Error('wrong type')
      expect(event.response.output).toHaveLength(2)
      expect(event.response.usage?.input_token_details?.audio_tokens).toBe(50)
    })

    it('still delivers the function calls when the usage block is malformed', () => {
      const event = parseServerEvent(wire({ ...done, response: { ...done.response, usage: 'unavailable' } }))
      expect(event?.type).toBe('response.done')
      if (event?.type !== 'response.done') return
      expect(event.response.output.some((item) => item.type === 'function_call')).toBe(true)
      expect(event.response.usage).toBeUndefined()
    })

    it('drops a malformed output item but keeps the good ones', () => {
      const event = parseServerEvent(wire({ ...done, response: { ...done.response, output: [42, null, ...done.response.output] } }))
      if (event?.type !== 'response.done') throw new Error('wrong type')
      expect(event.response.output).toHaveLength(2)
    })

    it('treats a missing output list as empty', () => {
      const event = parseServerEvent(wire({ type: 'response.done', response: { id: 'r', status: 'cancelled' } }))
      if (event?.type !== 'response.done') throw new Error('wrong type')
      expect(event.response.output).toEqual([])
    })
  })
})
