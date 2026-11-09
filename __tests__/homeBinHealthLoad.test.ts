import { describe, it, expect } from 'vitest'
import { loadHomeBinHealth } from '../supabase/functions/_shared/homeBinHealthLoad'
import type { HomeBinFactsRow } from '../supabase/functions/_shared/wie/homeBinHealth'

// A stub covering exactly the reads loadHomeBinHealth makes: the facts rpc, the
// three slotting reads, the products brand read and product_suppliers.

const factsRow = (o: Partial<HomeBinFactsRow> = {}): HomeBinFactsRow => ({
  product_id: 1,
  sku: 'TST-HOME-200',
  bin_id: 20,
  bin_code: 'TST-A-01-1',
  bin_warehouse_id: 7,
  is_active: true,
  is_hold: false,
  level_role: 'pick',
  is_pick_zone: true,
  level_hu_types: ['carton'],
  allowed_level_roles: [],
  in_active_layout: true,
  has_dock_route: true,
  zone_allowed_categories: null,
  category: 'Dry',
  capacity_slots: 10,
  used_slots: 2,
  pending_slots: 0,
  size_factor: 1,
  max_qty: null,
  on_hand_at_home: 2,
  pending_qty: 0,
  ...o,
})

const ruleRow = (o: Record<string, unknown> = {}) => ({
  id: 1, name: 'Test rule', specificity: 1, match_product_id: null, match_brand: null,
  match_category: null, match_supplier_id: null, enforcement: 'hard', reserve_empty: false,
  slotting_rule_blocks: [{ block_id: 10, rank: 1 }], ...o,
})

interface StubOpts {
  facts?: HomeBinFactsRow[]
  factsError?: string
  rules?: Array<Record<string, unknown>>
  ruleError?: string
  /** location_id -> block ids, as v_slotting_block_bins expands them. */
  blockBins?: Array<{ block_id: number; location_id: number }>
  brands?: Record<number, string | null>
}

function makeAdmin(o: StubOpts) {
  const reads: string[] = []
  const rowsFor = (table: string): { rows: unknown[]; error: string | null } => {
    switch (table) {
      case 'slotting_rules': return { rows: o.rules ?? [], error: o.ruleError ?? null }
      case 'slotting_blocks': return { rows: [{ id: 10, name: 'Block A' }, { id: 11, name: 'Block B' }], error: null }
      case 'v_slotting_block_bins': return { rows: o.blockBins ?? [], error: null }
      case 'products':
        return { rows: Object.entries(o.brands ?? {}).map(([id, brand]) => ({ id: Number(id), brand })), error: null }
      default: return { rows: [], error: null }
    }
  }
  const from = (table: string) => {
    reads.push(table)
    const { rows, error } = rowsFor(table)
    const b = {
      select: () => b,
      eq: () => b,
      in: () => b,
      then: (res: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
        Promise.resolve({ data: error ? null : rows, error: error ? { message: error } : null }).then(res),
    }
    return b
  }
  const rpc = async (name: string) => {
    reads.push(`rpc:${name}`)
    return o.factsError
      ? { data: null, error: { message: o.factsError } }
      : { data: o.facts ?? [], error: null }
  }
  return { admin: { from, rpc } as never, reads }
}

describe('loadHomeBinHealth', () => {
  it('judges every home and keeps the ones with problems', async () => {
    const { admin } = makeAdmin({
      facts: [
        factsRow(),
        factsRow({ product_id: 2, sku: 'TST-HOME-201', bin_id: 21, bin_code: 'TST-A-01-2', is_active: false }),
      ],
    })
    const report = await loadHomeBinHealth(admin, 7)
    expect(report.warehouseId).toBe(7)
    expect(report.checked).toBe(2)
    expect(report.rows.map((r) => [r.sku, r.problems.map((p) => p.code)])).toEqual([
      ['TST-HOME-201', ['inactive']],
    ])
  })

  it('reads nothing about products when the site has no slotting rules', async () => {
    const { admin, reads } = makeAdmin({ facts: [factsRow()], rules: [] })
    await loadHomeBinHealth(admin, 7)
    expect(reads).toEqual(['rpc:wie_home_bin_facts', 'slotting_rules'])
  })

  it('reports a home that a hard slotting rule excludes', async () => {
    const { admin } = makeAdmin({
      facts: [factsRow()],
      rules: [ruleRow({ match_product_id: 1 })],
      blockBins: [{ block_id: 11, location_id: 20 }],
    })
    const report = await loadHomeBinHealth(admin, 7)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].problems.map((p) => p.code)).toEqual(['slotting_refused'])
    expect(report.rows[0].problems[0].message).toContain('Block A')
  })

  it('does not report a home inside the rule\'s own block', async () => {
    const { admin } = makeAdmin({
      facts: [factsRow()],
      rules: [ruleRow({ match_product_id: 1 })],
      blockBins: [{ block_id: 10, location_id: 20 }],
    })
    expect((await loadHomeBinHealth(admin, 7)).rows).toEqual([])
  })

  it('matches a brand rule on the brand read from products', async () => {
    const rules = [ruleRow({ match_brand: 'Acme' })]
    const blockBins = [{ block_id: 11, location_id: 20 }]

    const acme = makeAdmin({ facts: [factsRow()], rules, blockBins, brands: { 1: 'Acme' } })
    expect((await loadHomeBinHealth(acme.admin, 7)).rows).toHaveLength(1)

    const other = makeAdmin({ facts: [factsRow()], rules, blockBins, brands: { 1: 'Other' } })
    expect((await loadHomeBinHealth(other.admin, 7)).rows).toEqual([])
  })

  it('never reports slotting for a home in a hold zone', async () => {
    const { admin } = makeAdmin({
      facts: [factsRow({ is_hold: true })],
      rules: [ruleRow({ match_product_id: 1 })],
      blockBins: [{ block_id: 11, location_id: 20 }],
    })
    const report = await loadHomeBinHealth(admin, 7)
    expect(report.rows[0].problems.map((p) => p.code)).toEqual(['hold_zone'])
  })

  it('throws when the facts cannot be read', async () => {
    const { admin } = makeAdmin({ factsError: 'boom' })
    await expect(loadHomeBinHealth(admin, 7)).rejects.toThrow('home bin facts load failed: boom')
  })

  it('fails closed when the slotting rules cannot be read', async () => {
    const { admin } = makeAdmin({ facts: [factsRow()], ruleError: 'boom' })
    await expect(loadHomeBinHealth(admin, 7)).rejects.toThrow('slotting rule load failed: boom')
  })
})
