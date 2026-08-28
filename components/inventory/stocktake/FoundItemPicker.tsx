// "There is something here the system doesn't know about."
//
// Scan the carton, or search the catalogue when the label is unreadable. The
// chosen product joins the sheet as a line with a system quantity of 0, so the
// count the operator types becomes a positive variance through exactly the same
// path as every other line.
//
// Uses lib/scan/resolveScan, which checks every namespace rather than stopping
// at the first hit — a string that could be both a bin code and a SKU comes back
// `ambiguous` and is resolved here by keeping only the product candidates. It
// never guesses across kinds.

import React, { useMemo, useState } from 'react'
import { PackagePlus, Plus } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { buildScanIndex, resolveScan, type ScanMatch } from '@/lib/scan/resolveScan'
import type { Product } from '@/types'

interface FoundItemPickerProps {
  products: Product[]
  /** Products already on the sheet — offering one again would create a second
   *  line for the same SKU, and the server rejects a duplicated product. */
  excludeProductIds: ReadonlySet<number>
  onAdd: (product: Product) => void
  disabled?: boolean
}

const MAX_SUGGESTIONS = 6

export const FoundItemPicker: React.FC<FoundItemPickerProps> = ({
  products,
  excludeProductIds,
  onAdd,
  disabled,
}) => {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const available = useMemo(
    () => products.filter((p) => !excludeProductIds.has(p.id)),
    [products, excludeProductIds],
  )

  const index = useMemo(
    () =>
      buildScanIndex({
        products: available.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode ?? null,
        })),
      }),
    [available],
  )

  // Type-to-search over SKU and name. Only runs on free text — a scanned code
  // goes through resolveScan, which is stricter and folds barcode variants.
  const suggestions = useMemo(() => {
    const q = code.trim().toLowerCase()
    if (q.length < 2) return []
    return available
      .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [code, available])

  const accept = (product: Product) => {
    onAdd(product)
    setCode('')
    setNote(null)
    setOpen(false)
  }

  const handleScan = (raw: string) => {
    const result = resolveScan(raw, index)
    if (result.kind === 'empty') return

    if (result.kind === 'unknown') {
      setNote(`Nothing in the catalogue matches ${result.normalized}. Search by name instead.`)
      return
    }

    const candidates: ScanMatch[] = result.kind === 'ambiguous' ? result.candidates : [result]
    const productMatches = candidates.filter((c) => c.kind === 'product')

    if (productMatches.length === 0) {
      setNote(`That code names a location or a pallet, not a product.`)
      return
    }
    if (productMatches.length > 1) {
      // resolveScan contributes at most one product candidate, so this is
      // unreachable today — kept because "several products" is a real answer
      // the resolver could start returning, and guessing would be a mis-scan.
      setNote('That code matches more than one product. Search by name instead.')
      return
    }

    const match = productMatches[0]
    if (match.kind !== 'product') return
    const product = available.find((p) => p.id === match.product.id)
    if (!product) {
      setNote('That product is already on this sheet.')
      return
    }
    accept(product)
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 px-3 py-3 text-sm font-medium text-stone-600 btn-press hover:border-nexgen-blue hover:text-nexgen-blue disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Add an item found here
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-stone-600">
        <PackagePlus className="h-4 w-4 text-nexgen-blue" aria-hidden="true" />
        Found in this location
      </div>

      <ScanField
        label="Scan the carton, or type a SKU or name"
        value={code}
        onChange={(v) => { setCode(v); if (note) setNote(null) }}
        onScan={handleScan}
        placeholder="A SKU, a barcode, or part of a name"
        cameraTitle="Scan the item you found"
        autoFocus
      />

      {note && <p className="mt-1.5 text-xs text-amber-600" role="status">{note}</p>}

      {suggestions.length > 0 && (
        <ul className="mt-2 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {suggestions.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => accept(p)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50 btn-press"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-800">{p.name}</span>
                  <span className="block font-mono text-[11px] text-stone-500">{p.sku}</span>
                </span>
                <Plus className="h-4 w-4 shrink-0 text-nexgen-blue" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => { setOpen(false); setCode(''); setNote(null) }}
        className="mt-2 text-xs text-stone-500 hover:text-stone-700"
      >
        Cancel
      </button>
    </div>
  )
}
