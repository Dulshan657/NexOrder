import { describe, it, expect } from 'vitest'
import { resolvePantryUpdate, upsertPantryRow, removePantryRow } from '@/lib/pantryCache'

const row = (product_id: number, default_quantity = 2, preferred_pack_size: number | null = null) => ({
    horeca_id: 7,
    product_id,
    preferred_pack_size,
    default_quantity,
    products: { name: `P${product_id}` },
})

describe('resolvePantryUpdate', () => {
    it('applies a quantity delta to the existing quantity', () => {
        expect(resolvePantryUpdate(row(1, 2), { quantityDelta: 1 }).default_quantity).toBe(3)
    })

    it('three successive +1 deltas accumulate (the lost-update bug)', () => {
        let rows = [row(1, 2)]
        for (let i = 0; i < 3; i++) {
            const next = resolvePantryUpdate(rows[0], { quantityDelta: 1 })
            rows = upsertPantryRow(rows, { horeca_id: 7, product_id: 1, ...next })
        }
        expect(rows[0].default_quantity).toBe(5)
    })

    it('never goes below 1', () => {
        expect(resolvePantryUpdate(row(1, 1), { quantityDelta: -1 }).default_quantity).toBe(1)
        expect(resolvePantryUpdate(row(1, 3), { defaultQuantity: 0 }).default_quantity).toBe(1)
    })

    it('sets an absolute quantity', () => {
        expect(resolvePantryUpdate(row(1, 2), { defaultQuantity: 9 }).default_quantity).toBe(9)
    })

    it('keeps the pack size unless the update names it, and clears it on explicit undefined', () => {
        expect(resolvePantryUpdate(row(1, 2, 12), { quantityDelta: 1 }).preferred_pack_size).toBe(12)
        expect(resolvePantryUpdate(row(1, 2, 12), { preferredPackSize: undefined }).preferred_pack_size).toBeNull()
        expect(resolvePantryUpdate(row(1, 2), { preferredPackSize: 6 }).preferred_pack_size).toBe(6)
    })
})

describe('upsertPantryRow / removePantryRow', () => {
    it('replaces in place and keeps joined fields', () => {
        const rows = [row(1), row(2)]
        const out = upsertPantryRow(rows, { horeca_id: 7, product_id: 2, preferred_pack_size: null, default_quantity: 8 })
        expect(out.map((r) => r.product_id)).toEqual([1, 2])
        expect(out[1].default_quantity).toBe(8)
        expect(out[1].products).toEqual({ name: 'P2' })
    })

    it('appends a new product without mutating the input', () => {
        const rows = [row(1)]
        const out = upsertPantryRow(rows, { horeca_id: 7, product_id: 3, preferred_pack_size: null, default_quantity: 1 })
        expect(out).toHaveLength(2)
        expect(rows).toHaveLength(1)
    })

    it('removes by product id', () => {
        expect(removePantryRow([row(1), row(2)], 1).map((r) => r.product_id)).toEqual([2])
    })
})
