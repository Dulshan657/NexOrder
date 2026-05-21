import { describe, it, expect } from 'vitest'

import { computePoIssues, type PoIssueInputs } from '../components/admin/poInboxIssues'

const clean: PoIssueInputs = {
  hasCustomer: true,
  senderMismatch: null,
  lines: [{ resolved: true, inventory: 50, ordered: 2 }],
  lowThreshold: 10,
}

function kinds(input: PoIssueInputs): string[] {
  return computePoIssues(input).map(i => i.kind)
}

describe('computePoIssues', () => {
  it('returns no issues for a clean, fully-resolved, in-stock PO', () => {
    expect(computePoIssues(clean)).toEqual([])
  })

  it('flags no_customer when the PO has no matched customer', () => {
    expect(kinds({ ...clean, hasCustomer: false })).toContain('no_customer')
  })

  it('flags unresolved_lines when any line has no product', () => {
    const issues = computePoIssues({
      ...clean,
      lines: [
        { resolved: true, inventory: 50, ordered: 2 },
        { resolved: false, inventory: null, ordered: 5 },
      ],
    })
    expect(issues.map(i => i.kind)).toContain('unresolved_lines')
  })

  it('flags stock when any resolved line is out of stock, labelled "Out of stock"', () => {
    const issues = computePoIssues({
      ...clean,
      lines: [{ resolved: true, inventory: 0, ordered: 2 }],
    })
    const stock = issues.find(i => i.kind === 'stock')
    expect(stock).toBeTruthy()
    expect(stock?.label).toBe('Out of stock')
  })

  it('flags stock as "Short on stock" when a line is partially short (not zero)', () => {
    const issues = computePoIssues({
      ...clean,
      lines: [{ resolved: true, inventory: 5, ordered: 10 }],
    })
    const stock = issues.find(i => i.kind === 'stock')
    expect(stock?.label).toBe('Short on stock')
  })

  it('does NOT flag stock for a low-but-sufficient line (low-stock alone is not an issue here)', () => {
    // 8 in stock, 2 ordered, threshold 10 -> lineStockStatus is "low_stock"
    // but the order is fully fillable, so it should not raise a stock ISSUE.
    expect(kinds({ ...clean, lines: [{ resolved: true, inventory: 8, ordered: 2 }] })).not.toContain('stock')
  })

  it('ignores stock on unresolved lines (no product = no inventory to check)', () => {
    expect(kinds({ ...clean, lines: [{ resolved: false, inventory: null, ordered: 99 }] })).not.toContain('stock')
  })

  it('passes through sender_mismatch with the sender in the detail', () => {
    const issues = computePoIssues({ ...clean, senderMismatch: { sender: 'evil@x.com' } })
    const sm = issues.find(i => i.kind === 'sender_mismatch')
    expect(sm?.severity).toBe('error')
    expect(sm?.detail).toContain('evil@x.com')
  })

  it('reports multiple issues at once, error-first', () => {
    const issues = computePoIssues({
      hasCustomer: false,
      senderMismatch: { sender: 'evil@x.com' },
      lines: [{ resolved: false, inventory: null, ordered: 5 }],
      lowThreshold: 10,
    })
    const ks = issues.map(i => i.kind)
    expect(ks).toEqual(expect.arrayContaining(['sender_mismatch', 'no_customer', 'unresolved_lines']))
    // sender mismatch (error) should come before warn-level issues
    expect(ks.indexOf('sender_mismatch')).toBe(0)
  })
})
