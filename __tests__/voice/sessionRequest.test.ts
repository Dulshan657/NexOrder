import { describe, it, expect } from 'vitest'
import {
  REALTIME_MODEL,
  REALTIME_TRANSCRIPTION_MODEL,
  REALTIME_VOICE,
  buildClientSecretRequest,
} from '../../supabase/functions/_shared/voice/sessionRequest'
import { VOICE_TOOLS } from '../../supabase/functions/_shared/voice/toolSchemas'
import type { VoiceToolSchema } from '../../supabase/functions/_shared/voice/toolSchemas'

const SAFETY_ID = 'sid-7c1f0e52a9'

type Input = { instructions: string; tools: readonly VoiceToolSchema[]; safetyIdentifier: string }

function mint(over: Partial<Input> = {}) {
  return buildClientSecretRequest({
    instructions: 'You are Nex Assistant.',
    tools: VOICE_TOOLS.slice(0, 2),
    safetyIdentifier: SAFETY_ID,
    ...over,
  })
}

type MintBody = {
  expires_after: { anchor: string; seconds: number }
  session: {
    type: string
    model: string
    instructions: string
    tools: Array<Record<string, unknown>>
    tool_choice: string
    audio: {
      input: {
        transcription: { model: string; language: string }
        turn_detection: Record<string, unknown>
      }
      output: { voice: string; speed: number }
    }
    max_output_tokens: number
    truncation: string
  }
}

describe('realtime constants', () => {
  it('pins the model, voice and transcription model', () => {
    expect(REALTIME_MODEL).toBe('gpt-realtime-2.1')
    expect(REALTIME_VOICE).toBe('marin')
    expect(REALTIME_TRANSCRIPTION_MODEL).toBe('gpt-4o-mini-transcribe')
  })
})

describe('buildClientSecretRequest', () => {
  it('builds exactly the documented mint body', () => {
    const tools = VOICE_TOOLS.slice(0, 2)
    const { body } = mint({ tools })
    expect(body).toEqual({
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions: 'You are Nex Assistant.',
        tools: tools.map((t) => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        tool_choice: 'auto',
        audio: {
          input: {
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'auto',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: 'marin', speed: 1.0 },
        },
        max_output_tokens: 800,
        truncation: 'auto',
      },
    })
  })

  it('expires the client secret 120 seconds after creation', () => {
    const body = mint().body as MintBody
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 120 })
  })

  it('speaks with marin at normal speed and transcribes English', () => {
    const body = mint().body as MintBody
    expect(body.session.audio.output).toEqual({ voice: REALTIME_VOICE, speed: 1.0 })
    expect(body.session.audio.input.transcription).toEqual({
      model: REALTIME_TRANSCRIPTION_MODEL,
      language: 'en',
    })
  })

  it('uses semantic VAD that answers on its own and can be interrupted', () => {
    const body = mint().body as MintBody
    expect(body.session.audio.input.turn_detection).toEqual({
      type: 'semantic_vad',
      eagerness: 'auto',
      create_response: true,
      interrupt_response: true,
    })
  })

  it('lets the model choose tools and caps the length of a reply', () => {
    const { session } = mint().body as MintBody
    expect(session.tool_choice).toBe('auto')
    expect(session.max_output_tokens).toBe(800)
    expect(session.truncation).toBe('auto')
    expect(session.type).toBe('realtime')
    expect(session.model).toBe(REALTIME_MODEL)
  })

  it('passes the instructions through unchanged', () => {
    const text = 'Line one\nLine two with "quotes"'
    const { session } = mint({ instructions: text }).body as MintBody
    expect(session.instructions).toBe(text)
  })

  it('carries only type, name, description and parameters for each tool', () => {
    const fat = { ...VOICE_TOOLS[0], extra: 'must not leak' } as unknown as VoiceToolSchema
    const { session } = mint({ tools: [fat] }).body as MintBody
    expect(Object.keys(session.tools[0]).sort()).toEqual(['description', 'name', 'parameters', 'type'])
    expect(session.tools[0]).not.toBe(fat)
  })

  it('accepts an empty tool list', () => {
    const { session } = mint({ tools: [] }).body as MintBody
    expect(session.tools).toEqual([])
  })

  it('sends the safety identifier as a header and never in the body', () => {
    const { body, headersExtra } = mint()
    expect(headersExtra).toEqual({ 'OpenAI-Safety-Identifier': SAFETY_ID })
    expect(JSON.stringify(body)).not.toContain(SAFETY_ID)
  })

  it('refuses a blank safety identifier', () => {
    expect(() => mint({ safetyIdentifier: '' })).toThrow(/safety identifier/i)
    expect(() => mint({ safetyIdentifier: '   ' })).toThrow(/safety identifier/i)
  })

  it('produces a body that survives JSON serialisation unchanged', () => {
    const { body } = mint({ tools: VOICE_TOOLS })
    expect(JSON.parse(JSON.stringify(body))).toEqual(body)
  })

  it('does not change its input', () => {
    const input = { instructions: 'hi', tools: [...VOICE_TOOLS], safetyIdentifier: SAFETY_ID }
    const before = JSON.stringify(input)
    buildClientSecretRequest(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
