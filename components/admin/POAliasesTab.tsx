// POAliasesTab — viewer + light editor for the alias tables that drive
// deterministic customer / product matching in the PO Inbox pipeline.
//
// Aliases are auto-populated by extract-po (>= 0.9 AI confidence) and
// approve-po (operator approval write-back). This tab exposes the same
// table with Edit / Delete row actions and a "+ New alias" button so a
// wrong learned alias can be fixed in-app instead of via SQL. Every
// mutation routes through the mutate-po-alias Edge Function and lands in
// audit_events.

import React, { Suspense, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { lazyWithRetry } from '../../lib/lazyWithRetry'
import { useCustomerAliases, useProductAliases } from '@/hooks/queries/usePendingPos'
import {
  useDeleteCustomerAlias,
  useDeleteProductAlias,
} from '@/hooks/queries/usePoAliasMutations'
import type {
  CustomerAliasRow,
  ProductAliasRow,
} from '@/services/supabase/poInboxService'
import type { HoReCa, Product } from '../../types'
import type { AliasModalMode } from './POAliasEditModal'

const POAliasEditModal = lazyWithRetry(() => import('./POAliasEditModal'))

interface POAliasesTabProps {
  hoReCas: HoReCa[]
  products: Product[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /**
   * Click handler for the "View source PO" link in the Origin column.
   * Receives the pending_po_id, switches to the Queue sub-tab, and primes
   * the detail modal with that PO.
   */
  onViewSourcePo?: (pendingPoId: string) => void
}

const POAliasesTab: React.FC<POAliasesTabProps> = ({
  hoReCas,
  products,
  addToast,
  onViewSourcePo,
}) => {
  const [active, setActive] = useState<'customer' | 'product'>('customer')
  const [query, setQuery] = useState<string>('')
  const [modalMode, setModalMode] = useState<AliasModalMode | null>(null)

  const customerQuery = useCustomerAliases()
  const productQuery = useProductAliases()

  const deleteCustomer = useDeleteCustomerAlias()
  const deleteProduct = useDeleteProductAlias()

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

  function handleNew(): void {
    setModalMode({ kind: active, action: 'create' })
  }

  function handleEditCustomer(row: CustomerAliasRow): void {
    setModalMode({ kind: 'customer', action: 'edit', initial: row })
  }

  function handleEditProduct(row: ProductAliasRow): void {
    setModalMode({ kind: 'product', action: 'edit', initial: row })
  }

  async function handleDeleteCustomer(row: CustomerAliasRow): Promise<void> {
    if (!window.confirm(`Delete alias for "${row.source_value}"?`)) return
    try {
      await deleteCustomer.mutateAsync(row.id)
      addToast?.('Alias deleted.', 'success')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Delete failed: ${message}`, 'error')
    }
  }

  async function handleDeleteProduct(row: ProductAliasRow): Promise<void> {
    const label = row.source_code || row.source_description || row.id
    if (!window.confirm(`Delete alias for "${label}"?`)) return
    try {
      await deleteProduct.mutateAsync(row.id)
      addToast?.('Alias deleted.', 'success')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Delete failed: ${message}`, 'error')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-stone-200/70">
        <nav className="flex items-center gap-6 -mb-px" aria-label="Alias kind">
          <ToggleTab active={active === 'customer'} onClick={() => setActive('customer')}>
            Customer
            <span className="ml-2 font-mono text-stone-500">
              {customerQuery.data?.length ?? 0}
            </span>
          </ToggleTab>
          <ToggleTab active={active === 'product'} onClick={() => setActive('product')}>
            Product
            <span className="ml-2 font-mono text-stone-500">
              {productQuery.data?.length ?? 0}
            </span>
          </ToggleTab>
        </nav>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-nexgen-blue hover:text-nexgen-blue/80 btn-press pb-2"
        >
          <Plus className="w-4 h-4" />
          New {active === 'customer' ? 'customer' : 'product'} alias
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="relative w-full max-w-sm">
          <Search className="absolute left-1 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
          <input
            type="search"
            placeholder="Filter…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-transparent pl-7 pr-2 py-1 text-sm border-b border-stone-200 focus:outline-none focus:border-stone-500 placeholder:text-stone-500"
          />
        </label>
      </div>

      <div className="mt-2">
        {active === 'customer' ? (
          <CustomerAliasTable
            rows={customerQuery.data ?? []}
            horecaById={horecaById}
            isLoading={customerQuery.isLoading}
            query={query}
            onEdit={handleEditCustomer}
            onDelete={handleDeleteCustomer}
            onViewSourcePo={onViewSourcePo}
          />
        ) : (
          <ProductAliasTable
            rows={productQuery.data ?? []}
            horecaById={horecaById}
            productById={productById}
            isLoading={productQuery.isLoading}
            query={query}
            onEdit={handleEditProduct}
            onDelete={handleDeleteProduct}
            onViewSourcePo={onViewSourcePo}
          />
        )}
      </div>

      {modalMode && (
        <Suspense fallback={null}>
          <POAliasEditModal
            mode={modalMode}
            hoReCas={hoReCas}
            products={products}
            onClose={() => setModalMode(null)}
            onSaved={() => addToast?.('Alias saved.', 'success')}
          />
        </Suspense>
      )}
    </div>
  )
}

const ToggleTab: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`py-2.5 text-sm transition-colors border-b-2 ${
      active
        ? 'border-stone-900 text-stone-900 font-medium'
        : 'border-transparent text-stone-500 hover:text-stone-800'
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
  onEdit: (row: CustomerAliasRow) => void
  onDelete: (row: CustomerAliasRow) => void
  onViewSourcePo?: (pendingPoId: string) => void
}

const CustomerAliasTable: React.FC<CustomerAliasTableProps> = ({
  rows,
  horecaById,
  isLoading,
  query,
  onEdit,
  onDelete,
  onViewSourcePo,
}) => {
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-stone-300/70 text-stone-500">
            <Th>Source</Th>
            <Th>Customer</Th>
            <Th>Provenance</Th>
            <Th className="w-20 text-right">{/* Actions, label hidden */}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200/70">
          {filtered.map(row => (
            <tr key={row.id} className="group hover:bg-stone-50">
              <Td>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] uppercase text-stone-500">
                    {row.source_type.replace('_', ' ')}
                  </span>
                </div>
                <div className="truncate max-w-[18rem] text-stone-900">{row.source_value}</div>
              </Td>
              <Td>{horecaById.get(row.horeca_id)?.name ?? `#${row.horeca_id}`}</Td>
              <Td>
                <ProvenanceCell row={row} onViewSourcePo={onViewSourcePo} />
              </Td>
              <Td className="text-right">
                <RowActions onEdit={() => onEdit(row)} onDelete={() => onDelete(row)} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ProductAliasTableProps {
  rows: ProductAliasRow[]
  horecaById: Map<number, HoReCa>
  productById: Map<number, Product>
  isLoading: boolean
  query: string
  onEdit: (row: ProductAliasRow) => void
  onDelete: (row: ProductAliasRow) => void
  onViewSourcePo?: (pendingPoId: string) => void
}

const ProductAliasTable: React.FC<ProductAliasTableProps> = ({
  rows,
  horecaById,
  productById,
  isLoading,
  query,
  onEdit,
  onDelete,
  onViewSourcePo,
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-stone-300/70 text-stone-500">
            <Th>Customer</Th>
            <Th>Maps from</Th>
            <Th>Product</Th>
            <Th>Provenance</Th>
            <Th className="w-20 text-right">{/* Actions */}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200/70">
          {filtered.map(row => {
            const product = productById.get(row.product_id)
            return (
              <tr key={row.id} className="group hover:bg-stone-50">
                <Td>{horecaById.get(row.horeca_id)?.name ?? `#${row.horeca_id}`}</Td>
                <Td>
                  {row.source_code && (
                    <div className="font-mono text-xs text-stone-700">{row.source_code}</div>
                  )}
                  {row.source_description && (
                    <div className="truncate max-w-[16rem] text-stone-900">
                      {row.source_description}
                    </div>
                  )}
                  {!row.source_code && !row.source_description && (
                    <span className="text-stone-500">—</span>
                  )}
                </Td>
                <Td>
                  {product ? (
                    <>
                      <div className="font-mono text-xs text-stone-500">{product.sku}</div>
                      <div className="text-stone-900">{product.name}</div>
                    </>
                  ) : (
                    <span className="text-stone-500">#{row.product_id}</span>
                  )}
                </Td>
                <Td>
                  <ProvenanceCell row={row} onViewSourcePo={onViewSourcePo} />
                </Td>
                <Td className="text-right">
                  <RowActions onEdit={() => onEdit(row)} onDelete={() => onDelete(row)} />
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface ProvenanceCellProps {
  row: {
    created_by: string | null
    created_at: string
    pending_po_id: string | null
    origin_sender_email: string | null
    origin_received_at: string | null
  }
  onViewSourcePo?: (pendingPoId: string) => void
}

// Single cell merging the old Source (Operator/AI) + Origin (sender +
// received) + Created (date) columns. Clickable when the row knows its
// originating pending_pos.
const ProvenanceCell: React.FC<ProvenanceCellProps> = ({ row, onViewSourcePo }) => {
  const isOperator = !!row.created_by
  const author = isOperator ? 'Operator' : 'AI'
  const authorTone = isOperator ? 'text-stone-700' : 'text-stone-500'
  const dateText = new Date(row.created_at).toLocaleDateString()

  if (row.pending_po_id && row.origin_sender_email) {
    return (
      <button
        type="button"
        onClick={() => onViewSourcePo?.(row.pending_po_id!)}
        className="text-left max-w-[18rem] group/origin"
        disabled={!onViewSourcePo}
        title="View source PO"
      >
        <div className="text-xs text-stone-500">
          <span className={authorTone}>{author}</span>
          <span aria-hidden> · </span>
          <span>{dateText}</span>
        </div>
        <div className="text-sm text-stone-800 truncate group-hover/origin:text-nexgen-blue group-hover/origin:underline underline-offset-4">
          {row.origin_sender_email}
        </div>
      </button>
    )
  }
  return (
    <div className="text-xs text-stone-500">
      <span className={authorTone}>{author}</span>
      <span aria-hidden> · </span>
      <span>{dateText}</span>
    </div>
  )
}

// Row actions only appear when the row is hovered or focus-within keeps them
// reachable via keyboard. Reduces visual chatter at rest.
const RowActions: React.FC<{ onEdit: () => void; onDelete: () => void }> = ({ onEdit, onDelete }) => (
  <span className="inline-flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
    <button
      type="button"
      onClick={onEdit}
      className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
      aria-label="Edit alias"
      title="Edit"
    >
      <Pencil className="w-4 h-4" />
    </button>
    <button
      type="button"
      onClick={onDelete}
      className="rounded p-1 text-stone-500 hover:bg-rose-50 hover:text-rose-700"
      aria-label="Delete alias"
      title="Delete"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </span>
)

const Th: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <th className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide ${className}`}>{children}</th>
)
const Td: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-3 py-3 align-top ${className}`}>{children}</td>
)

const EmptyAliases: React.FC = () => (
  <div className="py-16 text-center text-sm text-stone-500">
    No aliases yet. Approve a PO from the PO Inbox to teach the system — or create one manually
    above.
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
