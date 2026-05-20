import { describe, it, expect } from 'vitest'
import { summarizeMailboxHealth, formatRelative } from '@/components/admin/emailAccountFormat'

const acct = (status: 'active' | 'paused' | 'error') => ({ status })

describe('summarizeMailboxHealth', () => {
  it('reports ok when all active', () => {
    const h = summarizeMailboxHealth([acct('active'), acct('active')])
    expect(h.tone).toBe('ok')
    expect(h.count).toBe(2)
    expect(h.erroredCount).toBe(0)
  })

  it('reports paused when one paused and none errored', () => {
    const h = summarizeMailboxHealth([acct('active'), acct('paused')])
    expect(h.tone).toBe('paused')
    expect(h.pausedCount).toBe(1)
  })

  it('reports error when any errored (error wins over paused)', () => {
    const h = summarizeMailboxHealth([acct('paused'), acct('error')])
    expect(h.tone).toBe('error')
    expect(h.erroredCount).toBe(1)
  })

  it('handles empty list', () => {
    const h = summarizeMailboxHealth([])
    expect(h).toEqual({ count: 0, erroredCount: 0, pausedCount: 0, tone: 'ok' })
  })
})

describe('formatRelative (moved)', () => {
  it('still formats minutes', () => {
    const now = Date.now()
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago')
  })
})
