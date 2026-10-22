// Nex Assistant (voice) - the request that mints an ephemeral Realtime key.
//
// PURE: builds the body and the extra headers; the voice-session Edge Function
// owns the network call, the standard API key and the response handling.
//
// The key is minted per session and expires 120 seconds after creation. That is
// long enough to open the WebRTC connection (the browser asks for the microphone
// BEFORE minting, so a slow permission prompt cannot burn it) and short enough
// that a leaked key is useless almost at once.

import type { VoiceToolSchema } from './toolSchemas.ts'

export const REALTIME_MODEL = 'gpt-realtime-2.1'
export const REALTIME_VOICE = 'marin'
// The transcript the rep reads comes from this side model, not from the realtime
// model (which hears the audio itself). gpt-4o-mini-transcribe turned "what's the
// weather?" into "Восстановлено." on a demo test, despite language 'en'; the full
// model, a vocabulary prompt and noise reduction are the fix (about 2x the
// transcription cost, still a fraction of a cent a minute).
export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
/** Words the transcriber should expect: the app's own vocabulary, in Australian English. */
export const TRANSCRIPTION_PROMPT =
  'A sales rep or manager talking to Nex in the Nex Order app, in Australian English: orders, customers, HoReCa, invoices, stock, reorder, targets, visits, follow-ups, cartons.'
/** Laptop and phone-at-arm's-length mics, which is how the sheet is used; near_field is for headsets. */
const NOISE_REDUCTION = 'far_field'

const CLIENT_SECRET_TTL_SECONDS = 120
const MAX_OUTPUT_TOKENS = 800
const SAFETY_IDENTIFIER_HEADER = 'OpenAI-Safety-Identifier'

export interface ClientSecretRequestInput {
  instructions: string
  tools: readonly VoiceToolSchema[]
  /** An opaque, stable per-user id (never an email or a name). */
  safetyIdentifier: string
}

export interface ClientSecretRequest {
  body: Record<string, unknown>
  headersExtra: Record<string, string>
}

function toRealtimeTool(tool: VoiceToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

/**
 * The POST body for /v1/realtime/client_secrets and the headers to add to it.
 *
 * The safety identifier travels as a header so the body stays exactly the
 * documented session shape.
 */
export function buildClientSecretRequest(input: ClientSecretRequestInput): ClientSecretRequest {
  const safetyIdentifier = input.safetyIdentifier.trim()
  if (safetyIdentifier === '') {
    throw new Error('buildClientSecretRequest: a safety identifier is required')
  }
  return {
    body: {
      expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: input.instructions,
        tools: input.tools.map(toRealtimeTool),
        tool_choice: 'auto',
        audio: {
          input: {
            transcription: { model: REALTIME_TRANSCRIPTION_MODEL, language: 'en', prompt: TRANSCRIPTION_PROMPT },
            noise_reduction: { type: NOISE_REDUCTION },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'auto',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: REALTIME_VOICE, speed: 1.0 },
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        truncation: 'auto',
      },
    },
    headersExtra: { [SAFETY_IDENTIFIER_HEADER]: safetyIdentifier },
  }
}
