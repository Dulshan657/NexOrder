import { describe, it, expect } from 'vitest'
import { toOrder, toOrders } from '@/lib/adapters'
import { uuidToNumericId } from '@/lib/userIdMap'

const UUID = '11111111-2222-3333-4444-555555555555'

const hoReCas = [{ id: 1, name: 'Cafe One', address: 'x' }, { id: 2, name: 'Hotel Two', address: 'y' }] as never[]
const users = [{ id: uuidToNumericId(UUID), name: 'Rep', email: 'r@x', role: 'Admin' }] as never[]
const products = [
    { id: 10, sku: 'A', name: 'Apple', price: 1, category: 'Other', inventory: 5, unit: 'kg', cartonSize: 1, supplierId: 1 },
    { id: 11, sku: 'B', name: 'Bean', price: 2, category: 'Other', inventory: 5, unit: 'kg', cartonSize: 1, supplierId: 1 },
] as never[]

function orderRow(id: string, horeca_id: number, productIds: number[]) {
    return {
        id,
        horeca_id,
        submitted_by: UUID,
        order_date: '2026-09-01T00:00:00Z',
        status: 'pending',
        total: 10,
        order_items: productIds.map((product_id, i) => ({
            id: i + 1,
            order_id: id,
            product_id,
            product_name: `P${product_id}`,
            product_sku: `S${product_id}`,
            quantity: 2,
            pack_size: null,
            unit_price: 3,
        })),
    } as never
}

describe('toOrders', () => {
    it('matches toOrder row for row', () => {
        const rows = [orderRow('o1', 1, [10, 11]), orderRow('o2', 2, [11]), orderRow('o3', 99, [404])]
        expect(toOrders(rows, hoReCas, users, products)).toEqual(
            rows.map((r) => toOrder(r, hoReCas, users, products)),
        )
    })

    it('resolves customers, submitters and products, with fallbacks for unknowns', () => {
        const [known, unknown] = toOrders(
            [orderRow('o1', 1, [10]), orderRow('o2', 99, [404])],
            hoReCas, users, products,
        )
        expect(known.hoReCa.name).toBe('Cafe One')
        expect(known.submittedBy.name).toBe('Rep')
        expect(known.items[0].name).toBe('Apple')
        expect(known.items[0].price).toBe(3)

        expect(unknown.hoReCa.name).toBe('Unknown')
        expect(unknown.items[0].name).toBe('P404')
    })

    it('does not scan the product list once per line', () => {
        let reads = 0
        const counted = new Proxy(products as unknown as object[], {
            get(target, prop, receiver) {
                if (prop === 'find') reads++
                return Reflect.get(target, prop, receiver)
            },
        })
        const rows = Array.from({ length: 50 }, (_, i) => orderRow(`o${i}`, 1, [10, 11, 10, 11]))
        toOrders(rows, hoReCas, users, counted as never)
        expect(reads).toBe(0)
    })
})
