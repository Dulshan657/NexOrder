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
    po_number: {
      type: ['string', 'null'],
      maxLength: MAX_FIELD_CHARS,
      description:
        'The buyer\'s purchase-order number, taken from the value printed against a ' +
        '"Purchase Order No" / "PO Number" / "Order No" label. Never a telephone, fax, ' +
        'ABN, account, invoice or quote number.',
    },
    customer_name_raw: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
    customer_id_guess: { type: ['string', 'null'], maxLength: MAX_FIELD_CHARS },
    builder: {
      type: ['string', 'null'],
      maxLength: MAX_FIELD_CHARS,
      description:
        'Home builder / head contractor the job is for, verbatim; null if the document names none.',
    },
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
            name: {
              type: ['string', 'null'],
              maxLength: MAX_FIELD_CHARS,
              description: 'Recipient named on the delivery address, if one is printed.',
            },
            street: {
              type: ['string', 'null'],
              maxLength: MAX_FIELD_CHARS,
              description: 'Street line of the DELIVERY address, not the supplier\'s.',
            },
            city: {
              type: ['string', 'null'],
              maxLength: MAX_FIELD_CHARS,
              description: 'Suburb/city (and state/postcode) of the delivery address.',
            },
          },
          required: ['name', 'street', 'city'],
        },
        { type: 'null' },
      ],
    },
    notes: {
      type: ['string', 'null'],
      maxLength: MAX_NOTES_CHARS,
      description:
        'Whole-document notes, verbatim — the block labelled "Notes" that applies to the ' +
        'order as a whole. Not the per-line notes below.',
    },
    delivery_instructions: {
      type: ['string', 'null'],
      maxLength: MAX_NOTES_CHARS,
      description:
        'Whole-document delivery instructions, verbatim — the block labelled ' +
        '"Delivery Instructions". Separate from notes; null when the document has no ' +
        'such block.',
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
  // Every property must be listed here: the schema is sent with strict:true and
  // additionalProperties:false, under which OpenAI rejects the request outright
  // (400 invalid_schema) if a declared property is missing from `required`.
  // Optionality is expressed by the ['string','null'] type, not by omission.
  required: [
    'po_number',
    'customer_name_raw',
    'customer_id_guess',
    'builder',
    'order_date',
    'requested_date',
    'ship_to',
    'notes',
    'delivery_instructions',
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
  /** Home builder / head contractor the job is for. Informational only — it does
   *  not participate in customer matching or the auto-approval gates, which is
   *  why (like customer_id_guess) it has no `confidence` sibling. */
  builder: string | null
  order_date: string | null
  requested_date: string | null
  ship_to: ExtractedShipTo | null
  /** Whole-document "Notes" block, verbatim. Distinct from ExtractedLine.notes,
   *  which is per-line. Like builder, informational and without a `confidence`
   *  sibling — it gates nothing. */
  notes: string | null
  /** Whole-document "Delivery Instructions" block, verbatim. Kept separate from
   *  `notes`: one is a fulfilment caveat, the other is how to deliver. */
  delivery_instructions: string | null
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
* Bind every value to its printed LABEL, never to whichever text happens to
  sit nearest it. These documents are laid out in columns, so a label and its
  value are routinely separated by several unrelated lines, and a run of
  labels ("Issue Date:", "Purchase Order No:", "Tel:", "Fax:") is often
  followed by a run of values in a different order. Read the label, then find
  the value that belongs to it. If you cannot tell which value belongs to a
  label, return null for that field and give it a LOW confidence rather than
  taking the closest candidate.
* po_number is the buyer's purchase-order number, printed against a
  "Purchase Order No" / "PO Number" / "Order No" label. It is never a
  telephone number, a fax number, an ABN, an account number, an invoice
  number or a quote number. If the only candidate you can see is also printed
  against a "Tel" or "Fax" label, that is the wrong value: return null and
  set confidence.po_number low.
* ship_to is the DELIVERY address — the block labelled "Deliver To", "Ship
  To" or "Delivery Address". It is NOT the "Supplier" block (the business the
  order is being sent TO, i.e. whoever is being asked to supply the goods),
  and it is NOT the buyer's own letterhead or postal address.
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
* builder is the home builder / head contractor the job is being carried out
  for, when the document names one — usually a labelled "Builder:" field in
  the lower half of the page, near a job or site address. It is NOT the
  supplier, NOT the customer placing the order, and NOT the delivery
  recipient. Copy the name verbatim as printed. Null when absent or blank.
* The top-level notes and delivery_instructions are WHOLE-DOCUMENT blocks,
  usually printed near the bottom under headings of those names. Copy each
  verbatim, including any part numbers listed beneath it. They are separate
  from each other, and both are separate from the per-line notes inside
  lines[] — never move text between the three. Null when a block is absent
  or empty.
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
