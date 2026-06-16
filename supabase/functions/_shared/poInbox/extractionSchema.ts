// JSON-schema definitions for the extract-po Edge Function.
//
// Two schemas:
//   * IS_PO_SCHEMA          — gpt-4o-mini classifier (cheap, runs first)
//   * EXTRACT_PO_SCHEMA     — gpt-4o structured extractor (runs only on
//                              messages classified as POs)
//
// Both are exported as constants so the runtime sends a stable schema
// shape and prompt-hash collisions are meaningful for cache analysis.

export const IS_PO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_purchase_order: {
      type: 'boolean',
      description:
        'true when the email content is, or contains, a customer purchase order asking us to supply goods. false for newsletters, signatures, replies, marketing, internal notes, etc.',
    },
    classification_reason: {
      type: 'string',
      description: 'One short sentence describing why this was classified as PO or not. 200 chars max.',
    },
  },
  required: ['is_purchase_order', 'classification_reason'],
} as const

// Hard caps on extracted-string length. The model only sees content
// from a customer PO, which has no legitimate reason to fill any field
// with thousands of characters. Capping the schema closes a small
// prompt-injection surface: a malicious PO embedding a 10K-char string
// in customer_name_raw can't produce an oversized JSONB row.
const MAX_FIELD_CHARS = 500
const MAX_LINE_TEXT_CHARS = 300
const MAX_NOTES_CHARS = 1000
const MAX_LINES = 200

// Standardized PO JSON shape per MVP_PLAN.md. Keep the keys snake_case
// to match the rest of the system; the alias resolver consumes the
// same names. Confidence is per-field — the orchestrator min()s these
// to compute confidence_overall on the pending_pos row.
export const EXTRACT_PO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    po_number: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
    customer_name_raw: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
    customer_id_guess: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
    order_date: {
      type: ['string', 'null'],
      maxLength: 32,
      description: 'ISO yyyy-mm-dd when the PO was issued.',
    },
    requested_date: {
      type: ['string', 'null'],
      maxLength: 32,
      description: 'ISO yyyy-mm-dd when delivery is requested.',
    },
    ship_to: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
            street: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
            city: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
          },
          required: ['name', 'street', 'city'],
        },
        { type: 'null' },
      ],
    },
    lines: {
      type: 'array',
      maxItems: MAX_LINES,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          line_no: { type: 'integer', minimum: 1 },
          item_code_raw: { type: ['string', 'null'], maxLength: MAX_LINE_TEXT_CHARS },
          description_raw: { type: ['string', 'null'], maxLength: MAX_LINE_TEXT_CHARS },
          quantity: { type: 'number', minimum: 0 },
          uom: { type: ['string', 'null'], maxLength: 32 },
          pack_size_raw: { type: ['integer', 'null'], minimum: 1 },
          unit_price: {
            type: ['number', 'null'],
            minimum: 0,
            description: 'Per-unit price/cost printed for the line (ex-GST if both shown); null if absent.',
          },
          notes: { type: ['string', 'null'], maxLength: MAX_NOTES_CHARS },
        },
        required: [
          'line_no',
          'item_code_raw',
          'description_raw',
          'quantity',
          'uom',
          'pack_size_raw',
          'unit_price',
          'notes',
        ],
      },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        po_number: { type: 'number', minimum: 0, maximum: 1 },
        customer_name_raw: { type: 'number', minimum: 0, maximum: 1 },
        order_date: { type: 'number', minimum: 0, maximum: 1 },
        requested_date: { type: 'number', minimum: 0, maximum: 1 },
        ship_to: { type: 'number', minimum: 0, maximum: 1 },
        lines: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: [
        'po_number',
        'customer_name_raw',
        'order_date',
        'requested_date',
        'ship_to',
        'lines',
      ],
    },
  },
  required: [
    'po_number',
    'customer_name_raw',
    'customer_id_guess',
    'order_date',
    'requested_date',
    'ship_to',
    'lines',
    'confidence',
  ],
} as const

// TypeScript shapes that mirror the schemas. extract-po's result-parsing
// path narrows the unknown JSON into these.

export interface IsPoResult {
  is_purchase_order: boolean
  classification_reason: string
}

export interface ExtractedShipTo {
  name: string | null
  street: string | null
  city: string | null
}

export interface ExtractedLine {
  line_no: number
  item_code_raw: string | null
  description_raw: string | null
  quantity: number
  uom: string | null
  pack_size_raw: number | null
  unit_price: number | null
  notes: string | null
}

export interface ExtractedConfidence {
  po_number: number
  customer_name_raw: number
  order_date: number
  requested_date: number
  ship_to: number
  lines: number
}

export interface ExtractedPo {
  po_number: string | null
  customer_name_raw: string | null
  customer_id_guess: string | null
  order_date: string | null
  requested_date: string | null
  ship_to: ExtractedShipTo | null
  lines: ExtractedLine[]
  confidence: ExtractedConfidence
}

export const EXTRACT_PO_SYSTEM_PROMPT = `
You are an extraction engine for HORECA distributor purchase orders.

The user has sent you a customer purchase order in one of these formats:
PDF attachment, Word document, scanned image, or plain-text email body.
Extract the structured fields exactly as they appear on the document.

Rules:
* Set fields to null when the document does not contain them. Do not guess.
* Quantity must be a number; if the document says "two pallets" of an item,
  quantity=2 and uom="Pallet".
* item_code_raw is the customer's product code as printed (e.g., "402",
  "SKU-12"). description_raw is the free-text product name.
* pack_size_raw is the customer's specified pack size when it's clearly
  stated (e.g., "case of 12"); otherwise null.
* unit_price is the per-unit price/cost printed for the line. If both
  ex-GST and inc-GST prices are shown, use the ex-GST figure. Do not
  divide an extended/line total by quantity — only report a price the
  document states per unit. Null when no per-unit price is printed.
* Dates: ISO yyyy-mm-dd. Resolve ambiguous formats by preferring the
  newer date in the document (PO date is usually printed before
  requested-delivery date).
* confidence values are 0..1 estimates of how certain you are that each
  field was extracted correctly. 1.0 only when the field is unambiguously
  present and machine-readable. Lower for handwritten text, poor OCR,
  partial information, or unclear formatting. When a field is legitimately
  ABSENT from the document, set it null and keep its confidence HIGH — you
  are certain it is absent. Do not lower confidence merely because a field
  is null.
* Output strictly matches the JSON schema. No prose, no markdown.
`.trim()
