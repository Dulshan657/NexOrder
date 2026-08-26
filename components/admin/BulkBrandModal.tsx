// Set one brand across a selection of products (mig 00114).
//
// WHY THIS EXISTS RATHER THAN "edit them one at a time". Brand arrived after the
// catalogue did, so on any existing tenant every product starts unbranded and
// the first job is always the same shape: sixty coconut products are all Chang
// Foods. The CSV importer covers a fresh load; this covers the catalogue that is
// already in.
//
// CLEARING IS A FIRST-CLASS ACTION, not an empty text box. '' and NULL are
// different values here: the column's CHECK refuses a blank-after-trim string,
// and a stored '' would be MATCHABLE by a slotting rule whose brand field was
// left empty — quietly enrolling everything unbranded in it. So the operator
// picks "Clear the brand" deliberately and the payload sends null.

import React, { useMemo, useState } from 'react'
import { Modal, CreatableSelect } from '../ui'
import { brandOptions, withCurrentValue } from '../../lib/productTaxonomy'
import type { Product } from '../../types'

interface BulkBrandModalProps {
  open: boolean
  onClose: () => void
  /** The products the operator ticked. Never empty — the caller only opens
   *  this once something is selected. */
  products: Product[]
  /** The whole catalogue, for the brand suggestions. */
  catalog?: Product[]
  onApply: (brand: string | null) => Promise<void>
}

const BulkBrandModal: React.FC<BulkBrandModalProps> = ({
  open, onClose, products, catalog, onApply,
}) => {
  const [brand, setBrand] = useState('')
  const [clearing, setClearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choices = useMemo(() => withCurrentValue(brandOptions(catalog), brand), [catalog, brand])

  // What the selection carries today, so the operator can see they are about to
  // overwrite something rather than fill a blank.
  const existing = useMemo(() => {
    const seen = new Map<string, number>()
    let unbranded = 0
    for (const p of products) {
      if (p.brand) seen.set(p.brand, (seen.get(p.brand) ?? 0) + 1)
      else unbranded++
    }
    return { seen: [...seen.entries()].sort((a, b) => b[1] - a[1]), unbranded }
  }, [products])

  const apply = async () => {
    setError(null)
    if (!clearing && !brand.trim()) {
      setError('Pick a brand, or choose to clear it.')
      return
    }
    setBusy(true)
    try {
      await onApply(clearing ? null : brand.trim())
      setBrand('')
      setClearing(false)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update those products.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Set brand on ${products.length} product${products.length === 1 ? '' : 's'}`}
      dirty={brand.trim().length > 0 || clearing}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button" onClick={requestClose}
            className="btn-press text-sm px-3 py-1.5 rounded-lg border border-stone-200"
          >
            Cancel
          </button>
          <button
            type="button" onClick={apply} disabled={busy}
            className="btn-press text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-40"
          >
            {busy ? 'Applying…' : clearing ? 'Clear brand' : 'Set brand'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="text-xs text-stone-500 space-y-1">
          <p>These products currently carry:</p>
          <ul className="font-mono text-[11px] text-stone-600">
            {existing.seen.map(([name, count]) => (
              <li key={name}>{count} × {name}</li>
            ))}
            {existing.unbranded > 0 && <li>{existing.unbranded} × no brand</li>}
          </ul>
        </div>

        <label className="block text-xs text-stone-500">
          New brand
          <div className={clearing ? 'opacity-40 pointer-events-none' : ''}>
            <CreatableSelect
              id="bulk-brand"
              name="bulk-brand"
              value={brand}
              onChange={setBrand}
              options={choices}
              emptyLabel="Select a brand…"
              customLabel="New brand…"
              placeholder="Name the new brand"
              className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
            />
          </div>
        </label>

        <label className="flex items-start gap-2 text-xs text-stone-500">
          <input
            type="checkbox"
            checked={clearing}
            onChange={(e) => setClearing(e.target.checked)}
            className="mt-0.5 rounded border-stone-300"
          />
          <span>
            Clear the brand instead
            <span className="block text-[10px] text-stone-400">
              Sets it to “no brand”, which is not the same as an empty name — a
              slotting rule can never match on it.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  )
}

export default BulkBrandModal
