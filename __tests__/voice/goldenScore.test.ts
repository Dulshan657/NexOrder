// The golden scorer: does Nex's answer say what its tools said, and nothing else?
// Cases are shaped like the ones asked on dev on 2026-10-29.

import { describe, it, expect } from 'vitest'
import { scoreGoldenCase } from '../../lib/voice/golden/score'
import type { GoldenCase, GoldenRun } from '../../lib/voice/golden/score'

const revenue: GoldenCase = {
  id: 'admin-revenue-vs-last-month',
  role: 'Admin',
  question: 'What was revenue this month compared to last month?',
  tools: ['get_sales_summary'],
  states: ['get_sales_summary.revenue', 'get_sales_summary.previous.revenue'],
}

const summaryOutput = {
  ok: true,
  basis: 'this month (1 Oct to 29 Oct 2026)',
  data: { revenue: 4225, orderCount: 19, previous: { label: '1 Sep to 29 Sep 2026', revenue: 6102 } },
}

function runOf(answer: string, calls: GoldenRun['calls'] = [{ name: 'get_sales_summary', output: summaryOutput }]): GoldenRun {
  return { answer, calls }
}

describe('scoreGoldenCase', () => {
  it('passes an answer that states the facts its tool returned', () => {
    const score = scoreGoldenCase(revenue, runOf('Revenue this month is $4,225, against $6,102 for 1 to 29 September.'))
    expect(score).toEqual({ pass: true, problems: [] })
  })

  it('flags a number no tool returned', () => {
    // "About 6,543" came from a window the tool did not return here.
    const score = scoreGoldenCase(revenue, runOf('Revenue is $4,225 this month, against about $6,543 last month and $6,102 in September.'))
    expect(score.pass).toBe(false)
    expect(score.problems).toEqual(['ungrounded number: 6543'])
  })

  it('passes a rounded dollar figure', () => {
    const output = { ok: true, basis: 'x', data: { revenue: 4224.6, previous: { revenue: 6101.5 } } }
    const score = scoreGoldenCase(revenue, runOf('About $4,225 this month against about $6,102 before.', [{ name: 'get_sales_summary', output }]))
    expect(score).toEqual({ pass: true, problems: [] })
  })

  it('flags a required fact not stated', () => {
    const score = scoreGoldenCase(revenue, runOf('Revenue this month is $4,225.'))
    expect(score.pass).toBe(false)
    expect(score.problems).toEqual(['did not state get_sales_summary.previous.revenue (6102)'])
  })

  it('reads a fact from a later call of that tool', () => {
    const first = { ok: true, basis: 'x', data: { revenue: 1, previous: { revenue: 2 } } }
    const score = scoreGoldenCase(revenue, runOf('$4,225 against $6,102.', [{ name: 'get_sales_summary', output: first }, { name: 'get_sales_summary', output: summaryOutput }]))
    expect(score.problems).not.toContain('did not state get_sales_summary.revenue (4225)')
  })

  it('takes a fact from any call of the tool made for the question', () => {
    // After-run, 2026-11-04: this month, then last month in a call of its own; neither carried previous.
    const now = { ok: true, basis: 'x', data: { revenue: 0 } }
    const last = { ok: true, basis: 'x', data: { revenue: 4225, previous: { revenue: 6791 } } }
    const both: GoldenCase = { ...revenue, states: ['get_sales_summary.revenue'] }
    const calls = [{ name: 'get_sales_summary', output: now }, { name: 'get_sales_summary', output: last }]
    expect(scoreGoldenCase(both, runOf('Nothing yet this month, against $4,225 in October.', calls)).pass).toBe(true)
  })

  it('flags a missing tool call', () => {
    const score = scoreGoldenCase(revenue, runOf('Revenue is up.', []))
    expect(score.pass).toBe(false)
    expect(score.problems).toContain('did not call get_sales_summary')
  })

  it('matches a date fact however it is spoken', () => {
    const visit: GoldenCase = { id: 'd', role: 'Admin', question: 'When did Seaside last order?', tools: ['get_customer_insights'], states: ['get_customer_insights.lastOrder.date'] }
    const calls = [{ name: 'get_customer_insights', output: { ok: true, basis: 'x', data: { lastOrder: { date: '2026-10-17' } } } }]
    expect(scoreGoldenCase(visit, runOf('Their last order was on October 17.', calls)).pass).toBe(true)
    expect(scoreGoldenCase(visit, runOf('Their last order was on 17 Oct.', calls)).pass).toBe(true)
    expect(scoreGoldenCase(visit, runOf('Their last order was last week.', calls)).problems).toEqual(['did not state get_customer_insights.lastOrder.date (2026-10-17)'])
  })

  it('accepts a count said in words, and zero said as nothing', () => {
    // First live run, 2026-11-04: "Nothing has been placed so far this month" for orderCount 0.
    const placed: GoldenCase = { id: 'c', role: 'Admin', question: 'How many orders came in this month?', tools: ['get_sales_summary'], states: ['get_sales_summary.orderCount'] }
    const calls = (orderCount: number) => [{ name: 'get_sales_summary', output: { ok: true, basis: 'x', data: { orderCount } } }]
    expect(scoreGoldenCase(placed, runOf('Nothing has been placed so far this month.', calls(0))).pass).toBe(true)
    expect(scoreGoldenCase(placed, runOf('No orders have come in yet.', calls(0))).pass).toBe(true)
    expect(scoreGoldenCase(placed, runOf('Three orders came in this month.', calls(3))).pass).toBe(true)
    expect(scoreGoldenCase(placed, runOf('Two orders came in this month.', calls(3))).pass).toBe(false)
  })

  it('accepts a tool called earlier in the conversation', () => {
    // "What do I need to do to hit it?" right after the target answer: Nex reuses that result.
    const hit: GoldenCase = { id: 'h', role: 'Field Sales Rep', question: 'What do I need to do to hit it?', tools: ['get_sales_summary'], states: ['get_sales_summary.revenue'] }
    const run: GoldenRun = { answer: 'You are at $4,225; keep going.', calls: [], earlierCalls: [{ name: 'get_sales_summary', output: summaryOutput }] }
    expect(scoreGoldenCase(hit, run)).toEqual({ pass: true, problems: [] })
  })

  it('leaves a fact unchecked when its list is empty, but fails a missing field', () => {
    const target: GoldenCase = { id: 't', role: 'Field Sales Rep', question: 'How am I tracking?', tools: ['get_target_progress'], states: ['get_target_progress.targets.0.achieved'] }
    const none = [{ name: 'get_target_progress', output: { ok: true, basis: 'x', data: { targets: [] } } }]
    expect(scoreGoldenCase(target, runOf('You have no active targets right now.', none))).toEqual({
      pass: true, problems: [], unchecked: ['get_target_progress.targets.0.achieved'],
    })
    // The 2026-11-04 baseline: get_visit_stats had no visitsLogged field at all. That is a failure.
    const visits: GoldenCase = { id: 'v', role: 'Field Sales Rep', question: 'How many visits?', tools: ['get_visit_stats'], states: ['get_visit_stats.visitsLogged'] }
    const old = [{ name: 'get_visit_stats', output: { ok: true, basis: 'x', data: { completed: 0, visits: 28 } } }]
    expect(scoreGoldenCase(visits, runOf('You completed 0 visits.', old)).problems).toEqual(['get_visit_stats.visitsLogged is not in the tool output'])
  })

  it('does not count "and N more" as a number of its own', () => {
    const place: GoldenCase = { id: 'p', role: 'Admin', question: 'Draft an order for them.', refuse: true }
    expect(scoreGoldenCase(place, runOf("I can't send orders, but add the usual six lines, and 2 more items.", [])).pass).toBe(true)
  })

  it('matches a name however its ampersand and punctuation are spoken', () => {
    // NX-0014 run, 2026-11-04: "Executive Heating and Cooling" for "Executive Heating & Cooling".
    const best: GoldenCase = { id: 'b', role: 'Admin', question: 'Best customer?', tools: ['get_sales_summary'], states: ['get_sales_summary.topCustomers.0.name'] }
    const calls = [{ name: 'get_sales_summary', output: { ok: true, basis: 'x', data: { topCustomers: [{ name: 'Executive Heating & Cooling' }] } } }]
    expect(scoreGoldenCase(best, runOf('It is Executive Heating and Cooling.', calls)).pass).toBe(true)
    expect(scoreGoldenCase(best, runOf('It is Executive Heating & Cooling.', calls)).pass).toBe(true)
    expect(scoreGoldenCase(best, runOf('It is Executive Plumbing.', calls)).pass).toBe(false)
  })

  it('treats numbers in the question as grounded', () => {
    const stock: GoldenCase = { id: 's', role: 'Admin', question: 'How much Coconut Milk 400ml do we have?', refuse: true }
    expect(scoreGoldenCase(stock, runOf("I can't look up Coconut Milk 400ml on its own yet.", [])).pass).toBe(true)
  })

  it('flags an answer to a question that must be refused', () => {
    const place: GoldenCase = { id: 'p', role: 'Admin', question: 'Place that order for me.', refuse: true }
    const score = scoreGoldenCase(place, runOf('Done, the order is placed.', []))
    expect(score.pass).toBe(false)
    expect(score.problems).toEqual(['answered a question it must refuse'])
    expect(scoreGoldenCase(place, runOf("I can't place orders here; use the Shop screen.", [])).pass).toBe(true)
  })
})
