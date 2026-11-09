// "Give it a home" for a product that has none (NX-0033, G4).
//
// A Manager or Admin standing at a Walk stop for a homeless product names the
// bin that should be its home: by scanning its label, by typing its code, or by
// picking it from the list. The list is home-bin-choices, which has already
// dropped every bin putaway could not use, one that is full, and another
// product's home, so naming a bin here is naming one that fits.
//
// This only CHOOSES. The stop card retargets to the bin and sends make_home with
// the move, so the home is set in the same transaction as the stock (plan ruling
// R5) and closing this sheet, or abandoning the stop, leaves nothing behind. The
// server judges the bin again when the stock lands.

import { useId, useRef, useState } from 'react'
import { Home } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { ScanField } from '@/components/ui/ScanField'
import { Select } from '@/components/ui/Field'
import { normalizeScan } from '@/lib/scan/resolveScan'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { useHomeBinChoices } from '@/hooks/queries/useHomeBinChoices'
import type { HomeBinChoice } from '@/services/supabase/homeBinHealthService'

export interface GiveHomeSheetProps {
  open: boolean
  warehouseId: number
  productId: number
  sku: string
  /** The line on the stop being worked. Its own promise to a bin is not counted
   *  against that bin, so a bin with room for exactly this stock is still offered. */
  recommendationId?: number
  onClose: () => void
  onChoose: (bin: HomeBinChoice) => void
}

const notOffered = (code: string) =>
  `${code} can't be this product's home. Pick one of the bins listed.`

/** `code — name`, or the code alone when the bin has no name worth adding. */
const optionLabel = (bin: HomeBinChoice) => {
  const name = (bin.binName ?? '').trim()
  return name && name !== bin.binCode ? `${bin.binCode} — ${name}` : bin.binCode
}

export function GiveHomeSheet({
  open, warehouseId, productId, sku, recommendationId, onClose, onChoose,
}: GiveHomeSheetProps) {
  const choices = useHomeBinChoices(warehouseId, productId, open, recommendationId)
  const bins = choices.data ?? []
  const [code, setCode] = useState('')
  const [picked, setPicked] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { flash, signal: signalFlash } = useScanFlash()
  const pickId = useId()
  const bodyRef = useRef<HTMLDivElement | null>(null)

  /** The offered bin a typed or scanned string names, however it was keyed. */
  const find = (raw: string): HomeBinChoice | undefined => {
    const wanted = normalizeScan(raw)
    return bins.find((b) => normalizeScan(b.binCode) === wanted)
  }

  const chooseCode = (raw: string) => {
    const hit = find(raw)
    if (!hit) {
      setError(notOffered(normalizeScan(raw)))
      signalFlash('reject')
      return
    }
    setError(null)
    signalFlash('ok')
    onChoose(hit)
  }

  // The typed code wins when there is one; otherwise the dropdown.
  const makeHome = () => {
    if (code.trim()) return chooseCode(code)
    const hit = bins.find((b) => b.binCode === picked)
    if (hit) onChoose(hit)
  }

  const canSubmit = code.trim().length > 0 || picked !== ''

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="md"
      mobile="bottom"
      icon={<Home className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />}
      title={`Give ${sku} a home bin`}
      // The trap puts focus on the first control, which is the close button. A
      // scan only reaches the FOCUSED field on the RS35, so hand it to the scan
      // field once the sheet has settled.
      onEntered={() => bodyRef.current?.querySelector<HTMLInputElement>('[data-scan-field]')?.focus()}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={requestClose}
            className="touch-target-y inline-flex items-center rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={makeHome}
            disabled={!canSubmit}
            className="touch-target-y inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white btn-press disabled:opacity-50"
          >
            Make this its home
          </button>
        </div>
      )}
    >
      <div ref={bodyRef} className="space-y-4">
        {choices.isLoading ? (
          <p className="text-sm text-stone-600">Loading bins…</p>
        ) : choices.isError ? (
          <p className="text-sm text-red-600" role="alert">
            {choices.error instanceof Error ? choices.error.message : 'Could not list bins for a home, try again.'}
          </p>
        ) : bins.length === 0 ? (
          <p className="text-sm text-stone-700">No bin in this warehouse can be its home right now.</p>
        ) : (
          <>
            <ScanField
              label="Scan or type the bin code"
              value={code}
              onChange={(v) => { setCode(v); setError(null) }}
              onScan={chooseCode}
              flash={flash}
              cameraTitle="Scan the bin label"
              autoFocus
              error={error ?? undefined}
            />
            <div>
              <label htmlFor={pickId} className="mb-1.5 block text-xs font-semibold text-stone-600">
                Or pick a bin
              </label>
              <Select
                id={pickId}
                value={picked}
                onChange={(e) => {
                  setPicked(e.target.value)
                  // Picking from the list is a fresh choice: a code typed before it
                  // (and refused) must not outvote it.
                  setCode('')
                  setError(null)
                }}
              >
                <option value="">Choose a bin</option>
                {bins.map((b) => (
                  <option key={b.binId} value={b.binCode}>{optionLabel(b)}</option>
                ))}
              </Select>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
