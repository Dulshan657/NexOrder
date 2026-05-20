import { describe, it, expect } from 'vitest'
import { confidenceBand } from '@/components/admin/poInboxFormat'

describe('confidenceBand', () => {
  it('returns high at and above 0.95', () => {
    expect(confidenceBand(0.95).key).toBe('high')
    expect(confidenceBand(1).key).toBe('high')
  })

  it('returns mid in [0.75, 0.95)', () => {
    expect(confidenceBand(0.75).key).toBe('mid')
    expect(confidenceBand(0.9499).key).toBe('mid')
  })

  it('returns low below 0.75', () => {
    expect(confidenceBand(0.7499).key).toBe('low')
    expect(confidenceBand(0).key).toBe('low')
  })

  it('exposes ring/track colours and a text class', () => {
    const b = confidenceBand(0.5)
    expect(b.ringColor).toMatch(/^#/)
    expect(b.trackColor).toMatch(/^#/)
    expect(b.textClass).toContain('text-')
  })
})
