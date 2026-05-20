import { describe, it, expect } from 'vitest'

import {
  filterCustomerAliases,
  filterProductAliases,
} from '../components/admin/POAliasesTab'
import type {
  CustomerAliasRow,
  ProductAliasRow,
} from '../services/supabase/poInboxService'
import type { HoReCa, Product } from '../types'

const mkHoReCa = (id: number, name: string): HoReCa => ({
  id,
  name,
  address: 'somewhere',
})

const mkProduct = (id: number, sku: string, name: string): Product => ({
  id,
  sku,
  name,
  description: '',
  price: 0,
  category: 'Other',
  inventory: 0,
  unit: 'unit',
  cartonSize: 1,
  supplierId: 1,
})

const customerRows: CustomerAliasRow[] = [
  {
    id: 'a1',
    source_type: 'sender_email',
    source_value: 'orders@acme.com',
    horeca_id: 1,
    confidence_at_creation: 1,
    created_by: null,
    created_at: '2026-05-18T10:00:00Z',
    pending_po_id: null,
    origin_sender_email: null,
    origin_received_at: null,
  },
  {
    id: 'a2',
    source_type: 'sender_domain',
    source_value: 'biggrocer.com',
    horeca_id: 2,
    confidence_at_creation: 0.95,
    created_by: 'user-1',
    created_at: '2026-05-18T10:30:00Z',
    pending_po_id: null,
    origin_sender_email: null,
    origin_received_at: null,
  },
]

const horecaById = new Map<number, HoReCa>([
  [1, mkHoReCa(1, 'Acme Foods')],
  [2, mkHoReCa(2, 'Big Grocer')],
])

describe('filterCustomerAliases', () => {
  it('returns all rows when query is empty', () => {
    expect(filterCustomerAliases(customerRows, horecaById, '').length).toBe(2)
    expect(filterCustomerAliases(customerRows, horecaById, '   ').length).toBe(2)
  })

  it('matches on source_value (case-insensitive)', () => {
    expect(filterCustomerAliases(customerRows, horecaById, 'ACME').map(r => r.id)).toEqual(['a1'])
  })

  it('matches on customer name', () => {
    expect(filterCustomerAliases(customerRows, horecaById, 'big').map(r => r.id)).toEqual(['a2'])
  })

  it('matches on source_type', () => {
    expect(filterCustomerAliases(customerRows, horecaById, 'sender_email').map(r => r.id)).toEqual(['a1'])
  })

  it('returns empty when nothing matches', () => {
    expect(filterCustomerAliases(customerRows, horecaById, 'nope')).toEqual([])
  })
})

const productRows: ProductAliasRow[] = [
  {
    id: 'p1',
    horeca_id: 1,
    source_code: '402',
    source_description: 'tomato sauce',
    product_id: 11,
    default_pack_size: 12,
    confidence_at_creation: 1,
    created_by: null,
    created_at: '2026-05-18T10:00:00Z',
    pending_po_id: null,
    origin_sender_email: null,
    origin_received_at: null,
  },
  {
    id: 'p2',
    horeca_id: 2,
    source_code: null,
    source_description: 'chilli sauce 500ml',
    product_id: 22,
    default_pack_size: null,
    confidence_at_creation: 0.95,
    created_by: 'user-1',
    created_at: '2026-05-18T10:30:00Z',
    pending_po_id: null,
    origin_sender_email: null,
    origin_received_at: null,
  },
]

const productById = new Map<number, Product>([
  [11, mkProduct(11, 'SKU-RED-TOM', 'Red Tomato Sauce')],
  [22, mkProduct(22, 'SKU-CHILLI', 'Hot Chilli Sauce')],
])

describe('filterProductAliases', () => {
  it('returns all rows when query is empty', () => {
    expect(filterProductAliases(productRows, horecaById, productById, '').length).toBe(2)
  })

  it('matches on source_code', () => {
    expect(filterProductAliases(productRows, horecaById, productById, '402').map(r => r.id)).toEqual(['p1'])
  })

  it('matches on source_description (case-insensitive)', () => {
    expect(filterProductAliases(productRows, horecaById, productById, 'CHILLI').map(r => r.id)).toEqual(['p2'])
  })

  it('matches on resolved product sku', () => {
    expect(filterProductAliases(productRows, horecaById, productById, 'RED-TOM').map(r => r.id)).toEqual(['p1'])
  })

  it('matches on resolved product name', () => {
    expect(filterProductAliases(productRows, horecaById, productById, 'hot chilli').map(r => r.id)).toEqual(['p2'])
  })

  it('matches on customer name', () => {
    expect(filterProductAliases(productRows, horecaById, productById, 'Acme').map(r => r.id)).toEqual(['p1'])
  })

  it('returns empty when nothing matches', () => {
    expect(filterProductAliases(productRows, horecaById, productById, 'zzzz')).toEqual([])
  })
})
