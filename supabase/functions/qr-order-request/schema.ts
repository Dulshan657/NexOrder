// The wire contract of `qr-order-request`: what each action accepts. Pure
// declarations, so the handler and the two action modules share one definition.

import { z } from 'https://esm.sh/zod@3.23.8'
import { QR_MAX_LINES, QR_MAX_LINE_QUANTITY } from '../_shared/qrRequestItems.ts'

/** `orders.delivery_time_slot` is a CHECK over exactly these (mig 00001, mirrored by 00130). */
const DELIVERY_SLOTS = ['Morning (8am-12pm)', 'Afternoon (12pm-4pm)', 'Evening (4pm-8pm)'] as const

const REJECT_REASON_MIN = 3
const REJECT_REASON_MAX = 500

// `.nullish()`, never `.optional()`, on anything the client may send as null: with
// `strict` off nothing else notices that `.optional()` rejects null.
export const lineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(QR_MAX_LINE_QUANTITY),
  packSize: z.number().positive().nullish(),
  uomId: z.number().int().positive().nullish(),
})
const linesSchema = z.array(lineSchema).min(1).max(QR_MAX_LINES)

const notesSchema = z.string().max(1000).nullish()

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const deliveryAddressSchema = z.object({
  street: z.string().trim().min(1).max(200),
  city: z.string().trim().max(100).nullish(),
  postcode: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(100).nullish(),
  recipient_name: z.string().trim().max(100).nullish(),
})

const requestId = z.string().uuid()

export const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit'),
    items: linesSchema,
    notes: notesSchema,
    deliveryDate: z.string().refine(isRealDate, 'deliveryDate must be a real YYYY-MM-DD date').nullish(),
    deliveryTimeSlot: z.enum(DELIVERY_SLOTS).nullish(),
    deliveryAddress: deliveryAddressSchema.nullish(),
  }),
  z.object({ action: z.literal('cancel'), requestId }),
  z.object({ action: z.literal('preview'), requestId, items: linesSchema.optional() }),
  z.object({ action: z.literal('approve'), requestId, items: linesSchema.optional(), notes: notesSchema }),
  z.object({
    action: z.literal('reject'),
    requestId,
    reason: z.string().trim().min(REJECT_REASON_MIN).max(REJECT_REASON_MAX),
  }),
])

export type Input = z.infer<typeof inputSchema>
export type SubmitInput = Extract<Input, { action: 'submit' }>

/** `error.flatten()` collapses a nested payload to its top-level key; the paths are what a developer needs. */
export function validationIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
}

export type LineInput = z.infer<typeof lineSchema>
