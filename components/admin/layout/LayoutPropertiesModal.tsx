import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Field, Input, NumberInput } from '@/components/ui'
import {
  MAX_GRID_CELLS,
  deriveFloorSize,
  deriveGrid,
  findOutOfBounds,
  planRescale,
  toHundredths,
  type ScaleItem,
} from '@/supabase/functions/_shared/wie/gridScale'
import type { WarehouseLayout } from '@/types'

// The layout header: what building this is, how big it really is, and how finely
// it's drawn. One component serves both creating a draft and editing an existing
// layout, because the questions are identical and two forms would drift.
//
// THE OPERATOR ENTERS A BUILDING, NOT A GRID. You measure walls with a tape, then
// decide how finely to draw them; the cell count falls out of those two facts.
// Asking for a grid size directly would be asking the operator to do the division
// and would let them pick a grid that doesn't describe their warehouse at all.
//
// The rescale preview below runs planRescale — the SAME function mutate-layout
// runs to perform the change (_shared/wie/gridScale.ts, imported by both
// runtimes). That's the whole point of the module being shared: a preview that
// promises "×2, nothing refused" followed by a server that refuses would be worse
// than showing nothing.

/** Resolutions offered by default. Anything that divides evenly into common bay
 *  widths; the operator can still type a value the list doesn't hold. */
const RESOLUTION_PRESETS = [0.25, 0.5, 1, 1.2, 2]

/** A drawn item as the preview sees it: a rectangle with a name to blame and the
 *  floor it sits on (so dropping a floor can report what it would strand). */
export type PreviewItem = ScaleItem & { floor?: number }

export interface LayoutPropertiesValues {
  name: string
  cellSizeM: number
  gridWidth: number
  gridHeight: number
  floorCount: number
}

export interface LayoutPropertiesModalProps {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  /** The layout being edited. Ignored (and not required) when creating. */
  layout?: WarehouseLayout | null
  /** Current geometry, for previewing what a resolution change would do. Labels
   *  are what a refusal names, so pass something an operator can walk to. */
  placements?: PreviewItem[]
  objects?: PreviewItem[]
  busy?: boolean
  onSubmit: (values: LayoutPropertiesValues) => void | Promise<void>
}

/** Trim trailing zeros so a 1 m cell reads "1" and a 0.5 m cell reads "0.5". */
const num = (v: number): string => String(Number(v.toFixed(2)))

export function LayoutPropertiesModal({
  open,
  onClose,
  mode,
  layout,
  placements = [],
  objects = [],
  busy = false,
  onSubmit,
}: LayoutPropertiesModalProps) {
  const isEdit = mode === 'edit' && !!layout

  // Inputs are strings: a controlled number input that coerces on every keystroke
  // makes "0.5" unreachable, because "0." parses to 0 and the field rewrites
  // itself under the operator's cursor mid-decimal.
  const [name, setName] = useState('')
  const [widthM, setWidthM] = useState('')
  const [heightM, setHeightM] = useState('')
  const [cellM, setCellM] = useState('')
  const [floors, setFloors] = useState('1')

  // Seed from the layout each time the modal opens, so a cancelled edit doesn't
  // leave its abandoned values behind for the next one.
  useEffect(() => {
    if (!open) return
    if (isEdit && layout) {
      const size = deriveFloorSize({ gridWidth: layout.gridWidth, gridHeight: layout.gridHeight, cellSizeM: layout.cellSizeM })
      setName(layout.name)
      setWidthM(num(size.floorWidthM))
      setHeightM(num(size.floorHeightM))
      setCellM(num(layout.cellSizeM))
      setFloors(String(layout.floorCount))
    } else {
      setName(`Layout ${new Date().getFullYear()}`)
      setWidthM('60')
      setHeightM('40')
      setCellM('1')
      setFloors('1')
    }
  }, [open, isEdit, layout?.id])

  const parsed = useMemo(() => {
    const w = Number(widthM)
    const h = Number(heightM)
    const c = Number(cellM)
    const f = Math.round(Number(floors))
    return {
      floorWidthM: w,
      floorHeightM: h,
      cellSizeM: c,
      floorCount: Number.isFinite(f) && f >= 1 ? f : 1,
      cellValid: toHundredths(c) !== null,
      sizeValid: toHundredths(w) !== null && toHundredths(h) !== null,
    }
  }, [widthM, heightM, cellM, floors])

  const grid = useMemo(
    () =>
      parsed.cellValid && parsed.sizeValid
        ? deriveGrid({ floorWidthM: parsed.floorWidthM, floorHeightM: parsed.floorHeightM, cellSizeM: parsed.cellSizeM })
        : null,
    [parsed],
  )

  const overCap = !!grid && (grid.gridWidth > MAX_GRID_CELLS || grid.gridHeight > MAX_GRID_CELLS)

  /**
   * What this edit does to the existing drawing. Three shapes:
   *   - resolution changed  → a rescale, which may be refused
   *   - only the floor size changed → nothing moves, but a shrink can strand things
   *   - creating, or nothing relevant changed → nothing to say
   */
  const consequence = useMemo(() => {
    if (!isEdit || !layout || !grid || overCap) return null
    const resolutionChanged = parsed.cellSizeM !== layout.cellSizeM

    if (resolutionChanged) {
      const plan = planRescale({
        placements,
        objects,
        fromCellM: layout.cellSizeM,
        toCellM: parsed.cellSizeM,
        gridWidth: layout.gridWidth,
        gridHeight: layout.gridHeight,
        toGridWidth: grid.gridWidth,
        toGridHeight: grid.gridHeight,
      })
      if (plan.ok === false) return { tone: 'error' as const, text: plan.detail }
      const moved = plan.placements.length + plan.objects.length
      if (moved === 0) return { tone: 'info' as const, text: 'Nothing is drawn yet, so there is nothing to rescale.' }
      return {
        tone: 'info' as const,
        text:
          `${moved} item${moved === 1 ? '' : 's'} will be rescaled ` +
          `${plan.factor.num}/${plan.factor.den}× so everything keeps its real size — ` +
          `a ${num(layout.cellSizeM)} m bay is still a ${num(layout.cellSizeM)} m bay.`,
      }
    }

    const gridChanged = grid.gridWidth !== layout.gridWidth || grid.gridHeight !== layout.gridHeight
    if (!gridChanged) return null
    const outside = findOutOfBounds([...placements, ...objects], grid)
    if (outside.length > 0) {
      return {
        tone: 'error' as const,
        text:
          `A ${grid.gridWidth} × ${grid.gridHeight} grid would leave these outside the floor: ` +
          `${outside.slice(0, 6).join(', ')}${outside.length > 6 ? ` and ${outside.length - 6} more` : ''}. ` +
          'Move or remove them first.',
      }
    }
    return { tone: 'info' as const, text: 'Nothing moves — only the floor gets bigger or smaller.' }
  }, [isEdit, layout, grid, overCap, parsed.cellSizeM, placements, objects])

  const floorTooFew = useMemo(() => {
    if (!isEdit) return null
    const stranded = [...placements, ...objects].filter((it) => (it.floor ?? 0) >= parsed.floorCount)
    return stranded.length > 0 ? stranded.length : null
  }, [isEdit, placements, objects, parsed.floorCount])

  const error =
    !parsed.sizeValid
      ? 'Give the floor a width and a height in metres (up to two decimal places).'
      : !parsed.cellValid
        ? 'A resolution must be a positive number with at most two decimal places.'
        : overCap && grid
          ? `${num(parsed.cellSizeM)} m per cell would need a ${grid.gridWidth} × ${grid.gridHeight} grid; ` +
            `the maximum is ${MAX_GRID_CELLS} × ${MAX_GRID_CELLS}. Use a coarser resolution.`
          : floorTooFew
            ? `${parsed.floorCount} floor${parsed.floorCount === 1 ? '' : 's'} would strand ${floorTooFew} drawn item${floorTooFew === 1 ? '' : 's'}. Clear the upper floors first.`
            : consequence?.tone === 'error'
              ? consequence.text
              : !name.trim()
                ? 'Give the layout a name.'
                : null

  const canSubmit = !busy && !error && !!grid

  const submit = () => {
    if (!canSubmit || !grid) return
    void onSubmit({
      name: name.trim(),
      cellSizeM: parsed.cellSizeM,
      gridWidth: grid.gridWidth,
      gridHeight: grid.gridHeight,
      floorCount: parsed.floorCount,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Layout properties' : 'New layout'}
      description={
        isEdit
          ? 'The building this layout describes, and how finely it is drawn.'
          : 'Measure the floor, then choose how finely to draw it. The grid follows from both.'
      }
      size="lg"
      footer={({ requestClose }) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? 'Saving…' : isEdit ? 'Save' : 'Create draft'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="layout-name">
          <Input id="layout-name" value={name} onChange={(e: any) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Floor width (m)" htmlFor="layout-w">
            <NumberInput id="layout-w" min={1} step={0.1} value={widthM} onChange={(e: any) => setWidthM(e.target.value)} />
          </Field>
          <Field label="Floor depth (m)" htmlFor="layout-h">
            <NumberInput id="layout-h" min={1} step={0.1} value={heightM} onChange={(e: any) => setHeightM(e.target.value)} />
          </Field>
        </div>

        <Field
          label="Resolution"
          htmlFor="layout-cell"
          helper="How much of the building one grid cell covers. Finer cells draw narrow bays true, at the cost of a bigger grid."
        >
          <div className="flex items-center gap-2">
            <NumberInput
              id="layout-cell"
              min={0.01}
              step={0.05}
              className="w-28"
              value={cellM}
              onChange={(e: any) => setCellM(e.target.value)}
            />
            <span className="text-sm text-stone-500">m per cell</span>
            <div className="flex gap-1 ml-auto">
              {RESOLUTION_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCellM(num(p))}
                  className={`px-2 py-0.5 text-xs rounded border btn-press ${
                    parsed.cellSizeM === p ? 'border-stone-400 bg-stone-100 text-stone-700' : 'border-stone-200 text-stone-500'
                  }`}
                >
                  {num(p)}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <Field label="Floors" htmlFor="layout-floors">
          <NumberInput
            id="layout-floors"
            min={1}
            max={10}
            className="w-24"
            value={floors}
            onChange={(e: any) => setFloors(e.target.value)}
          />
        </Field>

        {/* The derived value, shown rather than asked for. */}
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-stone-500">Grid</span>
            <span className="font-mono text-stone-700">
              {grid ? `${grid.gridWidth} × ${grid.gridHeight} cells` : '—'}
            </span>
          </div>
          {grid ? (
            <p className="text-xs text-stone-400 mt-1">
              1 cell = {num(parsed.cellSizeM)} m. Drawn area {num(grid.gridWidth * parsed.cellSizeM)} ×{' '}
              {num(grid.gridHeight * parsed.cellSizeM)} m — rounded up so the far wall is inside the plan.
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : consequence ? (
          <p className="text-sm text-stone-600">{consequence.text}</p>
        ) : null}

        {isEdit && layout?.status === 'published' ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            This layout is live. Travel distances were frozen at {num(layout.cellSizeM)} m per cell when it was
            published — publish it again after saving for routing to pick the change up.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
