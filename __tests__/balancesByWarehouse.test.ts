import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every query: table, select, and the filters applied, and answers
// from `responses` by a key the test chooses.
type Call = { table: string; select?: string; filters: Array<[string, ...unknown[]]> }
const calls: Call[] = []
let respond: (c: Call) => { data: unknown; error: unknown } = () => ({ data: [], error: null })

function builder(table: string) {
    const call: Call = { table, filters: [] }
    calls.push(call)
    const b: Record<string, unknown> = {}
    const chain = (name: string) => (...args: unknown[]) => { call.filters.push([name, ...args]); return b }
    b.select = (s: string) => { call.select = s; return b }
    for (const f of ['eq', 'like', 'in', 'order']) b[f] = chain(f)
    b.single = () => Promise.resolve(respond(call))
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(res, rej)
    return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const { getBalancesByWarehouse } = await import('@/services/supabase/inventoryService')

const row = (location_id: number, product_id: number) => ({
    location_id, product_id, on_hand: 5, allocated: 1, handling_unit_id: null,
    products: { name: `P${product_id}`, size_factor: 1 }, handling_units: null,
})

beforeEach(() => {
    calls.length = 0
    respond = (c) => {
        if (c.table === 'locations') return { data: { materialized_path: 'MAIN_1' }, error: null }
        const isRoot = c.filters.some(([f, col]) => f === 'eq' && col === 'location_id')
        return { data: isRoot ? [row(7, 1)] : [row(70, 2), row(71, 3)], error: null }
    }
})

describe('getBalancesByWarehouse', () => {
    it('returns root stock plus every descendant bin', async () => {
        const out = await getBalancesByWarehouse(7)
        expect(out.map((b) => b.locationId).sort()).toEqual([7, 70, 71])
    })

    it('never sends an IN list of location ids (it grew with every bin)', async () => {
        await getBalancesByWarehouse(7)
        const balanceCalls = calls.filter((c) => c.table === 'inventory_balances')
        expect(balanceCalls.flatMap((c) => c.filters).some(([f]) => f === 'in')).toBe(false)
    })

    it('makes no separate descendant-location query', async () => {
        await getBalancesByWarehouse(7)
        expect(calls.filter((c) => c.table === 'locations')).toHaveLength(1)
    })

    it('scopes descendants by the escaped path through the joined location', async () => {
        await getBalancesByWarehouse(7)
        const desc = calls.find((c) => c.table === 'inventory_balances' && c.filters.some(([f]) => f === 'like'))!
        expect(desc.select).toMatch(/locations!inner\(/)
        expect(desc.filters).toContainEqual(['like', 'locations.materialized_path', 'MAIN\\_1/%'])
    })

    it('returns nothing for a location with no path', async () => {
        respond = (c) => (c.table === 'locations' ? { data: { materialized_path: null }, error: null } : { data: [row(1, 1)], error: null })
        expect(await getBalancesByWarehouse(7)).toEqual([])
    })
})
