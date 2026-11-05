// One row of a QuickBooks invoice export, after the file has been parsed.
//
// The parser (a later change) produces these; `classifyInvoices` consumes them.
// No imports and no runtime code, so both the Deno functions and the Vitest
// suite can load it.

export interface QbLine {
  invoiceNumber: string
  invoiceDate: string
  customerName: string
  qbProductName: string
  quantity: number
  unitPrice: number
  rowNumber: number
}
