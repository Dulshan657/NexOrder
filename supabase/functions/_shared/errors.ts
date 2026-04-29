// Shared error envelope helpers for Edge Functions.
//
// All Edge Functions return errors in a consistent shape:
//   { "error": { "code": <ErrorCode>, "message": <string>, "details"?: <unknown> } }
//
// Use `errorResponse(code, message, details?, status?)` for ad-hoc errors and
// throw `EdgeFunctionError` from helpers to bubble structured errors up to a
// single try/catch in the request handler.

import { corsHeaders } from './cors.ts'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL'

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
  status?: number,
): Response {
  const body: ErrorEnvelope = {
    error: details === undefined ? { code, message } : { code, message, details },
  }
  return new Response(JSON.stringify(body), {
    status: status ?? DEFAULT_STATUS[code],
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export class EdgeFunctionError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown, status?: number) {
    super(message)
    this.name = 'EdgeFunctionError'
    this.code = code
    this.status = status ?? DEFAULT_STATUS[code]
    this.details = details
  }

  toResponse(): Response {
    return errorResponse(this.code, this.message, this.details, this.status)
  }
}

// Type-narrowing helper for catch blocks.
export function isEdgeFunctionError(err: unknown): err is EdgeFunctionError {
  return err instanceof EdgeFunctionError
}
