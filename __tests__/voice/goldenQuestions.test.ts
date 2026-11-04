// The golden question set (__tests__/voice/golden/questions.json) is well formed:
// every case can actually be answered by the tools its role is offered on dev,
// so a failing live run means Nex chose badly, not that the case was impossible.

import { describe, it, expect } from 'vitest'
import { TARGETS } from '../../config/environments.mjs'
import { VOICE_ROLES, toolsForRole } from '../../supabase/functions/_shared/voice/toolSchemas'
import { parseGoldenCases } from '../../lib/voice/golden/score'
import questions from './golden/questions.json'

const cases = parseGoldenCases(questions)
const devModules: readonly string[] = TARGETS.dev.modules

describe('golden questions', () => {
  it('has at least 30 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })

  it('every case names a tool its role is offered', () => {
    for (const c of cases) {
      expect(VOICE_ROLES, c.id).toContain(c.role)
      const offered = toolsForRole(c.role, devModules).map((t) => t.name)
      if (c.refuse) continue
      expect(c.tools?.length ?? 0, `${c.id} names no tool`).toBeGreaterThan(0)
      for (const tool of c.tools ?? []) expect(offered, `${c.id}: ${tool}`).toContain(tool)
      for (const fact of c.states ?? []) expect(c.tools, `${c.id}: ${fact}`).toContain(fact.split('.')[0])
    }
  })

  it('covers the four answers that misled on 2026-10-29', () => {
    const ids = cases.map((c) => c.id)
    for (const id of ['rep-visits-this-month', 'admin-same-month-last-year', 'admin-seaside-last-order', 'admin-revenue-vs-last-month']) {
      expect(ids).toContain(id)
    }
  })

  it('answers what NX-0012 had to refuse', () => {
    // NX-0014 added the tools; each of these was a refuse case until then.
    const now = new Map(cases.map((c) => [c.id, c]))
    const expected: Array<[string, string]> = [
      ['admin-coconut-stock', 'get_product_summary'],
      ['rep-rice-noodles-available', 'get_product_summary'],
      ['admin-oyster-units', 'get_product_summary'],
      ['admin-best-category', 'get_sales_breakdown'],
      ['admin-top-rep-last-month', 'get_sales_breakdown'],
      ['admin-customers-drove-change', 'get_sales_breakdown'],
      ['admin-promotions', 'get_promotions'],
    ]
    for (const [id, tool] of expected) {
      const c = now.get(id)
      expect(c?.refuse, id).toBeFalsy()
      expect(c?.tools, id).toContain(tool)
      expect(c?.states?.length ?? 0, `${id} states no fact`).toBeGreaterThan(0)
    }
    // A rep may not rank reps; that stays a refusal.
    expect(now.get('rep-rep-ranking')?.refuse).toBe(true)
  })

  it('refuses malformed cases', () => {
    expect(() => parseGoldenCases([{ id: 'x', role: 'Admin', question: 'q' }])).toThrow(/x/)
    expect(() => parseGoldenCases([{ id: 'x', role: 'Admin', question: 'q', refuse: true, tools: ['a'] }])).toThrow(/x/)
    expect(() => parseGoldenCases({})).toThrow()
  })
})
