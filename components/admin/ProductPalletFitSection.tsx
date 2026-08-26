// "How many units are on a pallet" — computed, shown working, never written
// without a press.
//
// ── THE RULE THIS PANEL OBEYS ───────────────────────────────────────────────
//
// It computes continuously and writes nothing. The only thing that puts a
// "Pallet" row on the unit ladder is the button, and the number is editable
// before it is pressed. A panel that quietly kept a UOM row in sync with the
// dimensions would be editing the ladder behind the admin's back, and the
// ladder is what real receipts are counted in.
//
// ── IT SHOWS ITS WORKING BECAUSE THE ANSWER IS CHECKABLE ────────────────────
//
// "36 cartons" is worth nothing to someone standing next to a pallet; "2 along
// the length × 3 across, 6 layers" can be counted. The estimate especially: an
// estimated carton is a guess, and the only way to judge it is to see the box
// it guessed and the arrangement behind it.

import React, { useMemo, useState } from 'react'
import { Boxes, Check, Info } from 'lucide-react'
import { Tooltip } from '../ui'
import {
  describeRefusal,
  formatBoxCm,
  resolvePalletFit,
  type PalletSpec,
} from '../../lib/palletFit'
import { cartonUomOf, palletProvenance, provenanceHint } from '../../lib/palletUom'
import type { ExtraUomDraft } from './ProductUomsSection'

const CM = 'block w-full rounded-lg border-0 bg-white py-2 px-2.5 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm'

export type ProductPalletFitSectionProps = {
  /** The global pallet, or null when settings have not loaded. */
  spec: PalletSpec | null
  unitCm: { lengthCm: string; widthCm: string; heightCm: string }
  cartonCm: { lengthCm: string; widthCm: string; heightCm: string }
  onCartonChange: (patch: Partial<{ lengthCm: string; widthCm: string; heightCm: string }>) => void
  /** The ladder as the form currently has it — the carton row is read from here. */
  extraUoms: readonly ExtraUomDraft[]
  onApply: (unitsPerPallet: number) => void
}

const num = (v: string): number | null => {
  const n = parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function ProductPalletFitSection({
  spec,
  unitCm,
  cartonCm,
  onCartonChange,
  extraUoms,
  onApply,
}: ProductPalletFitSectionProps) {
  const [override, setOverride] = useState<string | null>(null)

  const carton = cartonUomOf(extraUoms)
  const unitsPerCarton = carton ? Number(carton.factorToBase) : null

  const result = useMemo(
    () =>
      resolvePalletFit({
        spec,
        cartonCm: {
          lengthCm: num(cartonCm.lengthCm),
          widthCm: num(cartonCm.widthCm),
          heightCm: num(cartonCm.heightCm),
        },
        unitCm: {
          lengthCm: num(unitCm.lengthCm),
          widthCm: num(unitCm.widthCm),
          heightCm: num(unitCm.heightCm),
        },
        unitsPerCarton: unitsPerCarton != null && Number.isInteger(unitsPerCarton) ? unitsPerCarton : null,
      }),
    [spec, cartonCm.lengthCm, cartonCm.widthCm, cartonCm.heightCm,
     unitCm.lengthCm, unitCm.widthCm, unitCm.heightCm, unitsPerCarton],
  )

  const fit = result.ok ? result.fit : null
  const estimate = result.ok ? result.estimate : null

  // The suggestion, or whatever the admin typed over it.
  const typed = override != null ? Number(override) : null
  const applyValue = typed != null && Number.isInteger(typed) && typed >= 2 ? typed : fit?.unitsPerPallet ?? null
  const applyBlocked =
    override != null && (!Number.isInteger(typed as number) || (typed as number) < 2)

  const existingPallet = extraUoms.find((u) => {
    const c = u.code.trim().toLowerCase()
    return c === 'pallet' || c === 'pallet load'
  })
  const existingFactor = existingPallet ? Number(existingPallet.factorToBase) : null
  const provenance = palletProvenance(existingFactor, fit)
  const hint = provenanceHint(provenance)

  return (
    <div className="bg-stone-50 rounded-lg p-4 border border-stone-200 space-y-3">
      <div className="flex items-start gap-2">
        <Boxes className="w-4 h-4 mt-0.5 shrink-0 text-stone-400" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-stone-700">Pallet quantity</h3>
          <p className="text-[11px] text-stone-400 mt-0.5">
            Worked out from the carton and the standard pallet, so goods-in can count a full
            pallet as one line. Nothing is saved until you add the unit.
          </p>
        </div>
      </div>

      {/* Carton (outer) dimensions — the input this panel adds to the form. */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[11px] font-medium text-stone-500">Carton (outer) dimensions — cm</span>
          <Tooltip
            label="What are carton dimensions for?"
            text="The outside of the shipping carton, not the unit inside it. Leave blank and the carton is estimated from the unit size and how many fit in one — the pallet quantity is then labelled as estimated."
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['lengthCm', 'widthCm', 'heightCm'] as const).map((key, i) => (
            <input
              key={key}
              type="number"
              step="0.1"
              min="0"
              className={CM}
              placeholder={['Length', 'Width', 'Height'][i]}
              aria-label={`Carton ${['length', 'width', 'height'][i]} in cm`}
              value={cartonCm[key]}
              onChange={(e) => onCartonChange({ [key]: e.target.value })}
            />
          ))}
        </div>
      </div>

      {/* Which ladder row the dimensions describe — the assumption, said out loud. */}
      <p className="text-[11px] text-stone-500">
        {carton ? (
          <>
            Carton ={' '}
            <span className="font-medium text-stone-700">{carton.code || 'unnamed unit'}</span>{' '}
            (×{carton.factorToBase} base units)
          </>
        ) : (
          <>No carton on the unit ladder above yet — add one to work out a pallet quantity.</>
        )}
      </p>

      {!result.ok ? (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {describeRefusal(result.reason, spec)}
        </p>
      ) : (
        <div className="space-y-2">
          {/* The estimate's working. Only when it IS an estimate. */}
          {estimate && (
            <div className="rounded-lg bg-white border border-stone-200 px-3 py-2 text-[11px] text-stone-600 space-y-0.5">
              <p className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                  <Info className="h-2.5 w-2.5" aria-hidden="true" /> Estimated carton
                </span>
                <span>best of {estimate.candidatesConsidered} arrangements</span>
              </p>
              <p>
                {estimate.unitsPerCarton} units laid {estimate.arrangement.join(' × ')} ={' '}
                {formatBoxCm(estimate.bareMm)}
              </p>
              <p>
                + {Math.round(estimate.wallAllowance * 100)}% for board and slack ={' '}
                <span className="font-medium text-stone-800">{formatBoxCm(estimate.box)}</span>
              </p>
            </div>
          )}

          {/* The fit's working. */}
          <div className="rounded-lg bg-white border border-stone-200 px-3 py-2 text-[11px] text-stone-600 space-y-0.5">
            <p>
              {fit!.alongLength} along the length × {fit!.alongWidth} across
              {fit!.orientation === 'rotated' ? ' (turned 90°)' : ''} ={' '}
              <span className="font-medium text-stone-800">{fit!.perLayer} per layer</span>
            </p>
            <p>
              {fit!.layers} layers ({fit!.loadHeightMm} mm of {fit!.loadHeightMm + fit!.headroomMm}{' '}
              mm) = <span className="font-medium text-stone-800">{fit!.cartonsPerPallet} cartons</span>
            </p>
            <p className="text-stone-800 font-medium">
              {fit!.unitsPerPallet.toLocaleString()} base units per pallet
            </p>
          </div>

          {/* Confirm. Editable first — the computation is a suggestion. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-stone-500">
              <span className="mb-1 block">Units per pallet</span>
              <input
                type="number"
                min={2}
                step={1}
                aria-label="Units per pallet"
                className={`${CM} w-36`}
                value={override ?? String(fit!.unitsPerPallet)}
                onChange={(e) => setOverride(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={applyBlocked || applyValue == null}
              onClick={() => applyValue != null && onApply(applyValue)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-2 text-xs font-medium text-white btn-press disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {existingPallet ? 'Update' : 'Add'} “Pallet” unit
              {applyValue != null ? ` (×${applyValue.toLocaleString()})` : ''}
            </button>
            {applyBlocked && (
              <span className="text-[11px] text-amber-700">Must be a whole number, 2 or more.</span>
            )}
          </div>
        </div>
      )}

      {/* What the ladder currently claims, and where that number came from. */}
      {existingPallet && hint && (
        <p className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <span>
            On the ladder: ×{existingPallet.factorToBase}
            {provenance === 'estimated' ? ' — estimated' : ''}
            {provenance === 'manual' ? ' — entered by hand' : ''}
          </span>
          <Tooltip label="Where did this pallet quantity come from?" text={hint} />
        </p>
      )}

      <p className="text-[11px] text-stone-400">
        The Pallet unit is added for receiving only, never for ordering — a full pallet can be
        counted in at the dock without appearing in the Shop.
      </p>
    </div>
  )
}

export default ProductPalletFitSection
