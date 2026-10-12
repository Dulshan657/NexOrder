// Shared error envelope helpers for Edge Functions.
//
// All Edge Functions return errors in a consistent shape:
//   { "error": { "code": <ErrorCode>, "message": <string>, "details"?: <unknown> } }
//
// Use `errorResponse(code, message, details?, status?)` for ad-hoc errors and
// throw `EdgeFunctionError` from helpers to bubble structured errors up to a
// single try/catch in the request handler.

import { corsHeaders, corsHeadersFor } from './cors.ts'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL'
  // Order placement (`placeOrderCore.ts`). These are place-order's own wire
  // codes, which the frontend reads and which predate this union; they live
  // here so the core can throw an EdgeFunctionError instead of building a
  // Response, and so every wrapper around it answers identically.
  | 'HORECA_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'STOCK_RACE'
  | 'BELOW_MINIMUM'
  | 'CREDIT_EXCEEDED'
  | 'DB_ORDER_INSERT_FAILED'
  | 'DB_ITEMS_INSERT_FAILED'

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  HORECA_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409,
  STOCK_RACE: 409,
  BELOW_MINIMUM: 422,
  CREDIT_EXCEEDED: 422,
  DB_ORDER_INSERT_FAILED: 500,
  DB_ITEMS_INSERT_FAILED: 500,
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
  req?: Request,
): Response {
  const body: ErrorEnvelope = {
    error: details === undefined ? { code, message } : { code, message, details },
  }
  const headers = req ? corsHeadersFor(req) : corsHeaders
  return new Response(JSON.stringify(body), {
    status: status ?? DEFAULT_STATUS[code],
    headers: { ...headers, 'Content-Type': 'application/json' },
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

  toResponse(req?: Request): Response {
    return errorResponse(this.code, this.message, this.details, this.status, req)
  }
}

// Type-narrowing helper for catch blocks.
export function isEdgeFunctionError(err: unknown): err is EdgeFunctionError {
  return err instanceof EdgeFunctionError
}
