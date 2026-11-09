import { describe, it, expect } from 'vitest'
import {
  loadHomeBinChoices,
  loadHomeBinHealth,
  loadHomeChoiceRefusal,
} from '../supabase/functions/_shared/homeBinHealthLoad'
import type { HomeBinCandidateFactsRow, HomeBinFactsRow } from '../supabase/functions/_shared/wie/homeBinHealth'

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
  candidates?: HomeBinCandidateFactsRow[]
  factsError?: string
  rules?: Array<Record<string, unknown>>
  ruleError?: string
  /** location_id -> block ids, as v_slotting_block_bins expands them. */
  blockBins?: Array<{ block_id: number; location_id: number }>
  brands?: Record<number, string | null>
}

function makeAdmin(o: StubOpts) {
  const reads: string[] = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
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
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    reads.push(`rpc:${name}`)
    rpcCalls.push({ name, args })
    if (o.factsError) return { data: null, error: { message: o.factsError } }
    return { data: (name === 'wie_home_bin_candidate_facts' ? o.candidates : o.facts) ?? [], error: null }
  }
  return { admin: { from, rpc } as never, reads, rpcCalls }
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

const candidateRow = (o: Partial<HomeBinCandidateFactsRow> = {}): HomeBinCandidateFactsRow => ({
  ...factsRow({ sku: 'TST-WALK-100', bin_code: 'TST-WALK-B1' }),
  bin_name: null,
  other_home_skus: [],
  ...o,
})

describe('loadHomeBinChoices', () => {
  it('calls wie_home_bin_candidate_facts with the warehouse and product, and throws on a read error', async () => {
    const { admin, rpcCalls } = makeAdmin({ candidates: [candidateRow()] })
    await loadHomeBinChoices(admin, 7, 1)
    expect(rpcCalls).toEqual([{
      name: 'wie_home_bin_candidate_facts',
      args: { p_warehouse_id: 7, p_product_id: 1 },
    }])

    const failing = makeAdmin({ factsError: 'boom' })
    await expect(loadHomeBinChoices(failing.admin, 7, 1))
      .rejects.toThrow('home bin candidates load failed: boom')
  })

  it('gives the lines being placed their own space back: p_exclude_rec_ids goes through, and only when there are some', async () => {
    const withLines = makeAdmin({ candidates: [candidateRow()] })
    await loadHomeBinChoices(withLines.admin, 7, 1, [55, 56])
    expect(withLines.rpcCalls).toEqual([{
      name: 'wie_home_bin_candidate_facts',
      args: { p_warehouse_id: 7, p_product_id: 1, p_exclude_rec_ids: [55, 56] },
    }])

    const none = makeAdmin({ candidates: [candidateRow()] })
    await loadHomeBinChoices(none.admin, 7, 1, [])
    expect(none.rpcCalls[0].args).toEqual({ p_warehouse_id: 7, p_product_id: 1 })
  })

  it('returns the bins that qualify, by code, and drops the rest', async () => {
    const { admin } = makeAdmin({
      candidates: [
        candidateRow({ bin_id: 22, bin_code: 'TST-WALK-B2', bin_name: 'Bay two' }),
        candidateRow({ bin_id: 21, bin_code: 'TST-WALK-B1' }),
        candidateRow({ bin_id: 23, bin_code: 'TST-WALK-B3', is_active: false }),
        candidateRow({ bin_id: 24, bin_code: 'TST-WALK-B4', other_home_skus: ['TST-WALK-900'] }),
      ],
    })
    expect(await loadHomeBinChoices(admin, 7, 1)).toEqual([
      { binId: 21, binCode: 'TST-WALK-B1', binName: null },
      { binId: 22, binCode: 'TST-WALK-B2', binName: 'Bay two' },
    ])
  })

  it('fills in the slotting refusal, so a bin a hard rule excludes is not offered', async () => {
    const { admin } = makeAdmin({
      candidates: [
        candidateRow({ bin_id: 20, bin_code: 'TST-WALK-B1' }),
        candidateRow({ bin_id: 21, bin_code: 'TST-WALK-B2' }),
      ],
      rules: [ruleRow({ match_product_id: 1 })],
      blockBins: [{ block_id: 10, location_id: 21 }, { block_id: 11, location_id: 20 }],
    })
    expect((await loadHomeBinChoices(admin, 7, 1)).map((c) => c.binCode)).toEqual(['TST-WALK-B2'])
  })

  it('fails closed when the slotting rules cannot be read', async () => {
    const { admin } = makeAdmin({ candidates: [candidateRow()], ruleError: 'boom' })
    await expect(loadHomeBinChoices(admin, 7, 1)).rejects.toThrow('slotting rule load failed: boom')
  })
})

describe('loadHomeChoiceRefusal', () => {
  it('passes p_bin_id and returns the refusal for that one bin', async () => {
    const { admin, rpcCalls } = makeAdmin({
      candidates: [candidateRow({ bin_id: 21, bin_code: 'TST-WALK-B2', is_active: false })],
    })
    expect(await loadHomeChoiceRefusal(admin, 7, 1, 21))
      .toBe('Bin TST-WALK-B2 is inactive, so putaway never offers it.')
    expect(rpcCalls).toEqual([{
      name: 'wie_home_bin_candidate_facts',
      args: { p_warehouse_id: 7, p_product_id: 1, p_bin_id: 21 },
    }])
  })

  it('passes the lines being placed as p_exclude_rec_ids, with the bin', async () => {
    const { admin, rpcCalls } = makeAdmin({ candidates: [candidateRow({ bin_id: 21 })] })
    expect(await loadHomeChoiceRefusal(admin, 7, 1, 21, [55, 56])).toBeNull()
    expect(rpcCalls).toEqual([{
      name: 'wie_home_bin_candidate_facts',
      args: { p_warehouse_id: 7, p_product_id: 1, p_bin_id: 21, p_exclude_rec_ids: [55, 56] },
    }])
  })

  it('leaves p_exclude_rec_ids out when no line is named', async () => {
    const { admin, rpcCalls } = makeAdmin({ candidates: [candidateRow({ bin_id: 21 })] })
    await loadHomeChoiceRefusal(admin, 7, 1, 21, [])
    expect(rpcCalls[0].args).toEqual({ p_warehouse_id: 7, p_product_id: 1, p_bin_id: 21 })
  })

  it('names the other product when the bin is already somebody else\'s home', async () => {
    const { admin } = makeAdmin({
      candidates: [candidateRow({ bin_id: 21, bin_code: 'TST-WALK-B2', other_home_skus: ['TST-WALK-900'] })],
    })
    expect(await loadHomeChoiceRefusal(admin, 7, 1, 21))
      .toBe('TST-WALK-B2 is the home bin of TST-WALK-900; choose another bin.')
  })

  it('is null for a bin that can be the home', async () => {
    const { admin } = makeAdmin({ candidates: [candidateRow({ bin_id: 21 })] })
    expect(await loadHomeChoiceRefusal(admin, 7, 1, 21)).toBeNull()
  })

  it('refuses a location the function returns no row for, as not a bin of this warehouse', async () => {
    const { admin } = makeAdmin({ candidates: [] })
    expect(await loadHomeChoiceRefusal(admin, 7, 1, 99)).toBe('That location is not a bin in this warehouse.')
  })

  it('throws on a read error', async () => {
    const { admin } = makeAdmin({ factsError: 'boom' })
    await expect(loadHomeChoiceRefusal(admin, 7, 1, 21))
      .rejects.toThrow('home bin candidates load failed: boom')
  })

  it('applies a slotting refusal to the one bin', async () => {
    const { admin } = makeAdmin({
      candidates: [candidateRow({ bin_id: 20, bin_code: 'TST-WALK-B1' })],
      rules: [ruleRow({ match_product_id: 1 })],
      blockBins: [{ block_id: 11, location_id: 20 }],
    })
    const refusal = await loadHomeChoiceRefusal(admin, 7, 1, 20)
    expect(refusal).toContain('Slotting rules refuse bin TST-WALK-B1')
    expect(refusal).toContain('Block A')
  })
})
