// OpenAI client wrapper for the PO Inbox pipeline.
//
// Goals:
//   * Single place that talks to OpenAI — every other helper invokes this.
//   * Retry with exponential backoff on transient failures (429, 5xx).
//   * Audit row written to po_extraction_audit for every call (success or
//     failure) — never blocks the main flow if the audit insert errors.
//   * Cost calculated at write time using openaiCost.ts.
//   * Structured-output mode is the default for extraction: caller passes a
//     JSON schema and gets back a parsed, typed result. Free-form mode is
//     also supported for the lightweight classifier.
//
// The Supabase client is passed in (rather than created here) so the file
// is decoupled from supabase-js. That keeps the dependency graph thin and
// lets future tests stub the DB without intercepting URL imports.

import { readEnv } from './env.ts'
import { computeCostUsd, promptHash } from './openaiCost.ts'

const OPENAI_BASE = 'https://api.openai.com/v1'
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_ATTEMPTS_CAP = 5
const DEFAULT_BACKOFF_MS = 500
const FETCH_TIMEOUT_MS = 30_000
const MAX_AUDIT_ERROR_LEN = 1000

// Structural interface — avoids importing supabase-js into this file so
// pure logic stays import-light. Callers pass any object that matches.
export interface AuditWriter {
  from(table: 'po_extraction_audit'): {
    insert(row: Record<string, unknown>): Promise<{ error: unknown }>
  }
}

export type ExtractionPurpose =
  | 'classify_is_po'
  | 'extract_text'
  | 'extract_pdf'
  | 'extract_docx'
  | 'extract_image'
  | 'customer_match'
  | 'product_match'

export interface ChatMessagePart {
  type: 'text' | 'image_url' | 'file'
  text?: string
  image_url?: { url: string }
  // Inline PDF (or other supported document) sent via the Chat Completions
  // API. `file_data` is a data URL (data:<mime>;base64,<b64>); `filename`
  // is required by the API even though the content is inline.
  file?: { filename: string; file_data: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatMessagePart[]
}

export interface OpenAIBaseParams {
  audit: AuditWriter
  inboundMessageId?: string | null
  edgeFunction: string
  purpose: ExtractionPurpose
  model: 'gpt-4o-mini' | 'gpt-4o'
  messages: ChatMessage[]
  maxAttempts?: number
}

export interface JsonModeParams<TSchema> extends OpenAIBaseParams {
  jsonSchema: {
    name: string
    schema: TSchema
    strict?: boolean
  }
}

export interface OpenAICallResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number | null
  model: string
}

export class OpenAIError extends Error {
  readonly httpStatus: number
  readonly retryable: boolean
  constructor(message: string, httpStatus: number, retryable: boolean) {
    super(message)
    this.name = 'OpenAIError'
    this.httpStatus = httpStatus
    this.retryable = retryable
  }

  /**
   * Convert to the standard NexOrder Edge Function error envelope so
   * callers can `catch` the same way they catch EdgeFunctionError.
   * The wrapped status is always 500 — OpenAI's 401/429/etc. are
   * upstream issues, not the client's fault, so the user-facing
   * response code stays generic.
   */
  toEdgeResponseBody(): { code: 'INTERNAL'; message: string; status: number } {
    return { code: 'INTERNAL', message: `openai: ${this.message}`, status: 500 }
  }
}

function readApiKey(): string {
  const key = readEnv('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY is not configured')
  return key
}

async function writeAudit(
  params: {
    audit: AuditWriter
    inboundMessageId: string | null
    edgeFunction: string
    purpose: ExtractionPurpose
    model: string
    promptHash: string
    inputTokens: number | null
    outputTokens: number | null
    latencyMs: number
    costUsd: number | null
    success: boolean
    errorMessage: string | null
  },
): Promise<void> {
  try {
    const { error } = await params.audit.from('po_extraction_audit').insert({
      inbound_message_id: params.inboundMessageId,
      edge_function: params.edgeFunction,
      purpose: params.purpose,
      model: params.model,
      prompt_hash: params.promptHash || null,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      latency_ms: params.latencyMs,
      cost_usd: params.costUsd,
      success: params.success,
      error_message: params.errorMessage,
    })
    if (error) {
      console.warn('[openai] po_extraction_audit insert failed:', error)
    }
  } catch (err) {
    // Audit failures must never block the caller.
    console.warn('[openai] po_extraction_audit insert threw:', err)
  }
}

async function backoffDelay(attempt: number, baseMs: number): Promise<void> {
  // Exponential backoff with jitter: 500ms, 1000ms, 2000ms ± 25%
  const factor = 2 ** (attempt - 1)
  const jitter = 0.75 + Math.random() * 0.5
  const ms = Math.round(baseMs * factor * jitter)
  await new Promise(resolve => setTimeout(resolve, ms))
}

interface OpenAIRequestBody {
  model: string
  messages: ChatMessage[]
  response_format?: {
    type: 'json_schema'
    json_schema: {
      name: string
      schema: unknown
      strict?: boolean
    }
  }
}

async function callOnce(
  body: OpenAIRequestBody,
  apiKey: string,
): Promise<{
  status: number
  json: Record<string, unknown> | null
  raw: string
}> {
  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const raw = await response.text()
  let json: Record<string, unknown> | null = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = null
  }
  return { status: response.status, json, raw }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

interface ParsedResponse {
  content: string
  inputTokens: number
  outputTokens: number
}

function parseSuccessfulResponse(json: Record<string, unknown> | null): ParsedResponse {
  if (!json) throw new OpenAIError('OpenAI returned empty body', 200, false)
  const choices = json.choices as Array<Record<string, unknown>> | undefined
  const message = choices?.[0]?.message as { content?: unknown } | undefined
  const rawContent = message?.content
  const content = typeof rawContent === 'string' ? rawContent : ''
  if (!content) {
    throw new OpenAIError('OpenAI response had empty content', 200, false)
  }
  const usage = json.usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined
  return {
    content,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  }
}

/**
 * Free-form chat completion. Used for the cheap classification step.
 * The model's text reply is returned verbatim.
 */
export async function chatCompletion(
  params: OpenAIBaseParams,
): Promise<OpenAICallResult<string>> {
  return await callWithAudit(params, undefined, raw => raw)
}

/**
 * Structured-output mode: the response is constrained to the supplied
 * JSON schema and parsed before returning. The model must be a current
 * OpenAI model that supports response_format.json_schema (gpt-4o family).
 */
export async function extractStructured<T>(
  params: JsonModeParams<unknown>,
): Promise<OpenAICallResult<T>> {
  const responseFormat: OpenAIRequestBody['response_format'] = {
    type: 'json_schema',
    json_schema: {
      name: params.jsonSchema.name,
      schema: params.jsonSchema.schema,
      strict: params.jsonSchema.strict ?? true,
    },
  }
  return await callWithAudit(params, responseFormat, raw => {
    try {
      return JSON.parse(raw) as T
    } catch {
      // Deliberately generic: the parse-error message can include the
      // model's reply prefix, which may echo PII from the prompt.
      throw new OpenAIError(
        'extractStructured: model returned non-JSON content',
        200,
        false,
      )
    }
  })
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

async function callWithAudit<T>(
  params: OpenAIBaseParams,
  responseFormat: OpenAIRequestBody['response_format'] | undefined,
  decode: (raw: string) => T,
): Promise<OpenAICallResult<T>> {
  const requestedAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const maxAttempts = Math.min(Math.max(1, requestedAttempts), MAX_ATTEMPTS_CAP)
  const apiKey = readApiKey()                                           // hoisted: read once per call
  const hashInput = JSON.stringify({ messages: params.messages, responseFormat })
  const hash = await promptHash(hashInput)
  const startedAt = Date.now()
  let lastError: Error | null = null
  let inputTokens = 0
  let outputTokens = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { status, json, raw } = await callOnce(
        {
          model: params.model,
          messages: params.messages,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
        apiKey,
      )

      if (status >= 200 && status < 300) {
        const parsed = parseSuccessfulResponse(json)
        inputTokens = parsed.inputTokens
        outputTokens = parsed.outputTokens
        const data = decode(parsed.content)
        const latencyMs = Date.now() - startedAt
        const costUsd = computeCostUsd(params.model, inputTokens, outputTokens)
        await writeAudit({
          audit: params.audit,
          inboundMessageId: params.inboundMessageId ?? null,
          edgeFunction: params.edgeFunction,
          purpose: params.purpose,
          model: params.model,
          promptHash: hash,
          inputTokens,
          outputTokens,
          latencyMs,
          costUsd,
          success: true,
          errorMessage: null,
        })
        return { data, inputTokens, outputTokens, latencyMs, costUsd, model: params.model }
      }

      const errorMsgRaw = typeof json?.error === 'object'
        ? JSON.stringify((json as { error: unknown }).error)
        : raw
      const errorMsg = truncate(errorMsgRaw ?? '', MAX_AUDIT_ERROR_LEN)
      lastError = new OpenAIError(
        `OpenAI ${status}: ${errorMsg}`,
        status,
        isRetryableStatus(status),
      )
      if (!isRetryableStatus(status) || attempt === maxAttempts) {
        throw lastError
      }
      await backoffDelay(attempt, DEFAULT_BACKOFF_MS)
    } catch (err) {
      if (err instanceof OpenAIError && !err.retryable) {
        lastError = err
        break
      }
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === maxAttempts) break
      await backoffDelay(attempt, DEFAULT_BACKOFF_MS)
    }
  }

  const latencyMs = Date.now() - startedAt
  await writeAudit({
    audit: params.audit,
    inboundMessageId: params.inboundMessageId ?? null,
    edgeFunction: params.edgeFunction,
    purpose: params.purpose,
    model: params.model,
    promptHash: hash,
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    latencyMs,
    costUsd: null,
    success: false,
    errorMessage: truncate(lastError?.message ?? 'unknown error', MAX_AUDIT_ERROR_LEN),
  })
  throw lastError ?? new Error('chat completion failed without diagnostic')
}
