// POAliasesTab — read-only view of the alias tables that drive
// deterministic customer / product matching in the PO Inbox pipeline.
//
// Aliases are written automatically:
//   * extract-po inserts them when AI fuzzy match is ≥0.9 confidence
//   * approve-po inserts them when an operator approves a PO
//
// MVP scope: this tab is read-only. Manual edit / delete are deferred
// to Phase 2 (they need a mutate-po-alias Edge Function plus a small UI
// for the (rare) case where a wrong alias gets stuck). Today operators
// can override the AI on individual POs from the inbox modal.

import React, { useMemo, useState } from 'react'
import { BookOpen, Loader2, Search } from 'lucide-react'
import { useCustomerAliases, useProductAliases } from '@/hooks/queries/usePendingPos'
import type { CustomerAliasRow, ProductAliasRow } from '@/services/supabase/poInboxService'
import type { HoReCa, Product } from '../../types'

interface POAliasesTabProps {
  hoReCas: HoReCa[]
  products: Product[]
}

const POAliasesTab: React.FC<POAliasesTabProps> = ({ hoReCas, products }) => {
  const [active, setActive] = useState<'customer' | 'product'>('customer')
  const [query, setQuery] = useState<string>('')

  const customerQuery = useCustomerAliases()
  const productQuery = useProductAliases()

  const horecaById = useMemo(() => {
    const m = new Map<number, HoReCa>()
    for (const h of hoReCas) m.set(h.id, h)
    return m
  }, [hoReCas])

  const productById = useMemo(() => {
    const m = new Map<number, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <header className="flex items-center gap-3">
        <BookOpen className="w-5 h-5 text-stone-700" />
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">PO Aliases</h1>
          <p className="text-sm text-stone-500">
            Deterministic sender / item mappings the PO Inbox uses to match emails to customers
            and products. Rows are added automatically when operators approve POs.
          </p>
        </div>
      </header>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2">
          <TabButton active={active === 'customer'} onClick={() => setActive('customer')}>
            Customer aliases ({customerQuery.data?.length ?? 0})
          </TabButton>
          <TabButton active={active === 'product'} onClick={() => setActive('product')}>
            Product aliases ({productQuery.data?.length ?? 0})
          </TabButton>
        </div>
        <label className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="search"
            placeholder="Filter…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full rounded-lg border border-stone-300 bg-white pl-8 pr-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white shadow-card overflow-hidden">
        {active === 'customer' ? (
          <CustomerAliasTable
            rows={customerQuery.data ?? []}
            horecaById={horecaById}
            isLoading={customerQuery.isLoading}
            query={query}
          />
        ) : (
          <ProductAliasTable
            rows={productQuery.data ?? []}
            horecaById={horecaById}
            productById={productById}
            isLoading={productQuery.isLoading}
            query={query}
          />
        )}
      </section>
    </div>
  )
}

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
      active
        ? 'bg-nexgen-blue text-white'
        : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50'
    }`}
  >
    {children}
  </button>
)

interface CustomerAliasTableProps {
  rows: CustomerAliasRow[]
  horecaById: Map<number, HoReCa>
  isLoading: boolean
  query: string
}

const CustomerAliasTable: React.FC<CustomerAliasTableProps> = ({ rows, horecaById, isLoading, query }) => {
  const filtered = useMemo(() => filterCustomerAliases(rows, horecaById, query), [rows, horecaById, query])
  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-stone-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Loading…
      </div>
    )
  }
  if (filtered.length === 0) {
    return <EmptyAliases />
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-stone-50 text-stone-600 text-left">
        <tr>
          <Th>Source type</Th>
          <Th>Source value</Th>
          <Th>Customer</Th>
          <Th>Source</Th>
          <Th>Created</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-200">
        {filtered.map(row => (
          <tr key={row.id} className="hover:bg-stone-50">
            <Td className="font-mono text-xs">{row.source_type}</Td>
            <Td className="truncate max-w-xs">{row.source_value}</Td>
            <Td>{horecaById.get(row.horeca_id)?.name ?? `#${row.horeca_id}`}</Td>
            <Td>{row.created_by ? 'Operator' : 'AI'}</Td>
            <Td className="text-stone-500">{new Date(row.created_at).toLocaleDateString()}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface ProductAliasTableProps {
  rows: ProductAliasRow[]
  horecaById: Map<number, HoReCa>
  productById: Map<number, Product>
  isLoading: boolean
  query: string
}

const ProductAliasTable: React.FC<ProductAliasTableProps> = ({
  rows,
  horecaById,
  productById,
  isLoading,
  query,
}) => {
  const filtered = useMemo(
    () => filterProductAliases(rows, horecaById, productById, query),
    [rows, horecaById, productById, query],
  )
  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-stone-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Loading…
      </div>
    )
  }
  if (filtered.length === 0) {
    return <EmptyAliases />
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-stone-50 text-stone-600 text-left">
        <tr>
          <Th>Customer</Th>
          <Th>Customer code</Th>
          <Th>Customer description</Th>
          <Th>Product</Th>
          <Th>Source</Th>
          <Th>Created</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-200">
        {filtered.map(row => {
          const product = productById.get(row.product_id)
          return (
            <tr key={row.id} className="hover:bg-stone-50">
              <Td>{horecaById.get(row.horeca_id)?.name ?? `#${row.horeca_id}`}</Td>
              <Td className="font-mono text-xs">{row.source_code ?? '—'}</Td>
              <Td className="truncate max-w-xs">{row.source_description ?? '—'}</Td>
              <Td>
                {product ? (
                  <span>
                    <span className="font-mono text-xs">{product.sku}</span> · {product.name}
                  </span>
                ) : (
                  `#${row.product_id}`
                )}
              </Td>
              <Td>{row.created_by ? 'Operator' : 'AI'}</Td>
              <Td className="text-stone-500">{new Date(row.created_at).toLocaleDateString()}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide">{children}</th>
)
const Td: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-3 py-2 align-top ${className}`}>{children}</td>
)

const EmptyAliases: React.FC = () => (
  <div className="p-10 text-center text-sm text-stone-500">
    No aliases yet. Approve a PO from the PO Inbox to teach the system.
  </div>
)

// Pure filter helpers — exported for vitest.

export function filterCustomerAliases(
  rows: CustomerAliasRow[],
  horecaById: Map<number, HoReCa>,
  query: string,
): CustomerAliasRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(row => {
    if (row.source_value.toLowerCase().includes(q)) return true
    if (row.source_type.includes(q)) return true
    const horeca = horecaById.get(row.horeca_id)
    return !!horeca && horeca.name.toLowerCase().includes(q)
  })
}

export function filterProductAliases(
  rows: ProductAliasRow[],
  horecaById: Map<number, HoReCa>,
  productById: Map<number, Product>,
  query: string,
): ProductAliasRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(row => {
    if (row.source_code?.toLowerCase().includes(q)) return true
    if (row.source_description?.toLowerCase().includes(q)) return true
    const horeca = horecaById.get(row.horeca_id)
    if (horeca && horeca.name.toLowerCase().includes(q)) return true
    const product = productById.get(row.product_id)
    if (product && (product.sku.toLowerCase().includes(q) || product.name.toLowerCase().includes(q))) {
      return true
    }
    return false
  })
}

export default POAliasesTab
