import { describe, it, expect } from 'vitest'

import { evaluateMetric } from '../lib/semantic/evaluate'
import { METRICS, getMetric, listMetrics } from '../lib/semantic/registry'
import type { MetricContext } from '../lib/semantic/types'

// A registry whose entries are not self-describing is just a lookup table. These
// invariants are what make it a semantic layer: every metric states what it
// means, in what unit, and what data it needs.

const UNITS = ['currency', 'count', 'ratio', 'quantity']
const SHAPES = ['scalar', 'series', 'rows', 'breakdown']

describe('registry invariants', () => {
  it('is not empty', () => {
    expect(listMetrics().length).toBeGreaterThan(0)
  })

  it('keys the map by each metric own id', () => {
    for (const [key, def] of Object.entries(METRICS)) {
      expect(def.id).toBe(key)
    }
  })

  it('namespaces every id as <domain>.<name>', () => {
    for (const def of listMetrics()) {
      expect(def.id).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
    }
  })

  it('gives every metric a label, a real description and a known unit', () => {
    for (const def of listMetrics()) {
      expect(def.label.trim().length, `${def.id} label`).toBeGreaterThan(0)
      // 40 chars is not arbitrary: a one-word description ("Revenue") tells a
      // reader nothing about what is counted, which is the whole point.
      expect(def.description.trim().length, `${def.id} description`).toBeGreaterThan(40)
      expect(UNITS, `${def.id} unit`).toContain(def.unit)
      expect(SHAPES, `${def.id} shape`).toContain(def.shape)
    }
  })

  it('returns the shape it declares', () => {
    const ctx: MetricContext = {
      orders: [],
      products: [],
      settings: { lowStockThreshold: 10 },
      now: new Date('2026-07-20T00:00:00.000Z'),
    }
    for (const def of listMetrics()) {
      const value = evaluateMetric(def.id, ctx, {})
      if (def.shape === 'scalar') {
        expect(typeof value, `${def.id}`).toBe('number')
      } else if (def.shape === 'series' || def.shape === 'rows') {
        expect(Array.isArray(value), `${def.id}`).toBe(true)
      } else {
        expect(typeof value, `${def.id}`).toBe('object')
        expect(Array.isArray(value), `${def.id}`).toBe(false)
      }
    }
  })

  it('declares the context slices it reads', () => {
    for (const def of listMetrics()) {
      expect(def.requires.length, `${def.id} requires`).toBeGreaterThan(0)
      for (const key of def.requires) {
        expect(['orders', 'products', 'settings', 'now']).toContain(key)
      }
    }
  })

  it('resolves a known id and rejects an unknown one', () => {
    expect(getMetric('sales.revenue').id).toBe('sales.revenue')
    expect(() => getMetric('sales.nope')).toThrow(/unknown metric/i)
  })
})

describe('every metric is total over an empty context', () => {
  const empty: MetricContext = {
    orders: [],
    products: [],
    settings: { lowStockThreshold: 10 },
    now: new Date('2026-07-20T00:00:00.000Z'),
  }

  it('never throws and never returns NaN or undefined', () => {
    for (const def of listMetrics()) {
      const value = evaluateMetric(def.id, empty, {})
      expect(value, `${def.id}`).toBeDefined()
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${def.id} returned ${value}`).toBe(true)
      }
    }
  })
})

describe('line-scope declaration', () => {
  const ctx: MetricContext = {
    orders: [],
    products: [],
    settings: { lowStockThreshold: 10 },
    now: new Date('2026-07-20T00:00:00.000Z'),
  }

  it('throws for every metric that does not support a category scope', () => {
    for (const def of listMetrics()) {
      if (def.supportsLineScope) continue
      expect(
        () => evaluateMetric(def.id, ctx, { category: 'Dry Goods' }),
        `${def.id} should refuse a line-level scope`,
      ).toThrow()
    }
  })
})
