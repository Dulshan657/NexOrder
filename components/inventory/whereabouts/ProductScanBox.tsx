// Scan or type a product (NX-0039). Resolves a barcode or SKU with the shared
// scan resolver — the same folding every other scan surface uses — and falls
// back to a name search for a typed word. It only ever reports a product id;
// an unrecognised code is said out loud and goes nowhere.

import { useMemo, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { useWedgeScanner } from '@/lib/scan/useWedgeScanner'
import { buildScanIndex, resolveScan, type ScanProduct } from '@/lib/scan/resolveScan'
import { useProducts } from '@/hooks/queries/useProducts'

const MAX_CHOICES = 6
const MIN_NAME_SEARCH = 2

export interface ProductScanBoxProps {
  onProduct: (productId: number) => void
  /** Arm the desktop wedge-gun safety net. Handheld screens only; never on a page with other inputs. */
  wedge?: boolean
}

export function ProductScanBox({ onProduct, wedge = false }: ProductScanBoxProps) {
  const { data: products } = useProducts()
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [choices, setChoices] = useState<ScanProduct[]>([])
  const { flash, signal } = useScanFlash()

  const scanProducts = useMemo<ScanProduct[]>(
    () => ((products ?? []) as Array<{ id: number; sku?: string | null; name: string; barcode?: string | null }>)
      .map((p) => ({ id: p.id, sku: p.sku ?? '', name: p.name, barcode: p.barcode ?? null })),
    [products],
  )
  const index = useMemo(() => buildScanIndex({ products: scanProducts }), [scanProducts])

  const found = (p: ScanProduct) => {
    setNote(null)
    setChoices([])
    signal('ok')
    onProduct(p.id)
  }

  const offer = (list: ScanProduct[], what: string) => {
    setChoices(list.slice(0, MAX_CHOICES))
    setNote(`${list.length} products match ${what} — pick one.`)
    signal('ok')
  }

  const handleScan = (raw: string) => {
    const text = raw.trim()
    const result = resolveScan(text, index)
    if (result.kind === 'empty') return
    if (result.kind === 'product') return found(result.product)
    if (result.kind === 'ambiguous') {
      const hits = result.candidates.flatMap((c) => (c.kind === 'product' ? [c.product] : []))
      if (hits.length === 1) return found(hits[0])
      if (hits.length > 1) return offer(hits, text)
    }

    // Not a barcode or SKU: a typed name, perhaps.
    const needle = text.toLowerCase()
    const byName = needle.length >= MIN_NAME_SEARCH
      ? scanProducts.filter((p) => p.name.toLowerCase().includes(needle))
      : []
    if (byName.length === 1) return found(byName[0])
    if (byName.length > 1) return offer(byName, `"${text}"`)

    setChoices([])
    setNote(`Nothing matches ${text}.`)
    signal('reject')
  }

  useWedgeScanner({ active: wedge, onScan: handleScan })

  return (
    <div>
      <ScanField
        label="Scan or type a product"
        value={code}
        onChange={(v) => { setCode(v); if (note) setNote(null) }}
        onScan={handleScan}
        flash={flash}
        placeholder="Barcode, SKU or name"
        cameraTitle="Scan a product"
        softKeyboard="onDemand"
      />
      {note && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700" role="status">
          <ScanLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {note}
        </p>
      )}
      {choices.length > 0 && (
        <ul className="mt-1.5 space-y-1" aria-label="Matching products">
          {choices.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { setCode(p.name); found(p) }}
                className="touch-target w-full rounded-md px-2 py-1 text-left text-xs text-stone-700 hover:bg-stone-100 btn-press"
              >
                {p.name} <span className="font-mono text-stone-600">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
