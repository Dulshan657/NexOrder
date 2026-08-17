// Step 1 — what to recode.
//
// The brush is the primary tool and is armed by default. The rectangle is secondary
// and hit-tests by `contain`, so a band that clips a neighbouring rack leaves it
// alone; between them they cover both the awkward shapes and the tidy ones.

import { Brush, Eraser, Square, Undo2, Trash2 } from 'lucide-react'
import type { RecodeTool } from '../useRecodeSelection'
import type { BlockCensusRow } from '../recodeGeometry'

export interface SelectStepProps {
  tool: RecodeTool
  mode: 'add' | 'erase'
  selectedCount: number
  canUndo: boolean
  /** Named areas on this floor, for the one-click shortcut. */
  areaNames: readonly string[]
  /** Areas the current selection spans — a quiet note, never a block. */
  spannedAreas: readonly string[]
  /** Blocks already swept on this site, for growing one. */
  blocks: readonly BlockCensusRow[]
  /** How much of the site has been swept, from `code_block` provenance. */
  swept: number
  total: number
  /** The newest un-reverted sweep on this site, read from the server so the offer
   *  survives a reload — component state would lose it exactly when the operator
   *  most wants it, which is after refreshing to look at what they just did. */
  lastSweep: { block: string; rows: number } | null
  reverting: boolean
  onRevert: () => void
  onTool: (tool: RecodeTool) => void
  onMode: (mode: 'add' | 'erase') => void
  onUndo: () => void
  onClear: () => void
  onSelectArea: (areaName: string) => void
  onSelectBlock: (block: string) => void
}

const toggle = (on: boolean) =>
  `flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium btn-press ${
    on
      ? 'border-nexgen-blue bg-nexgen-blue/10 text-nexgen-blue'
      : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
  }`

const chip =
  'rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50'

export function SelectStep({
  tool, mode, selectedCount, canUndo, areaNames, spannedAreas, blocks, swept, total,
  lastSweep, reverting, onRevert,
  onTool, onMode, onUndo, onClear, onSelectArea, onSelectBlock,
}: SelectStepProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* The map is tinted to match while this panel is open, so the number and the
          picture are the same fact. `code_block IS NULL` is provenance, not a guess
          about the string. */}
      {total > 0 && (
        <div>
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-medium text-stone-600">
              {swept} of {total} recoded
            </span>
            <span className="text-stone-400">{total - swept} to go</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-emerald-400"
              style={{ width: `${Math.round((swept / total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-stone-500">
        Drag on the map to pick the bins you want to recode. Hold <kbd className="rounded border border-stone-300 px-1 font-mono text-[10px]">Alt</kbd> to pan instead.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={toggle(tool === 'paint' && mode === 'add')}
          onClick={() => { onTool('paint'); onMode('add') }} aria-pressed={tool === 'paint' && mode === 'add'}>
          <Brush className="h-3.5 w-3.5" strokeWidth={2} /> Brush
        </button>
        <button type="button" className={toggle(tool === 'rect' && mode === 'add')}
          onClick={() => { onTool('rect'); onMode('add') }} aria-pressed={tool === 'rect' && mode === 'add'}>
          <Square className="h-3.5 w-3.5" strokeWidth={2} /> Box
        </button>
        <button type="button" className={toggle(mode === 'erase')}
          onClick={() => onMode('erase')} aria-pressed={mode === 'erase'}>
          <Eraser className="h-3.5 w-3.5" strokeWidth={2} /> Erase
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-stone-800">
          {selectedCount} selected
        </span>
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={onUndo} disabled={!canUndo}
            className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-40">
            <Undo2 className="h-3.5 w-3.5" strokeWidth={2} /> Undo
          </button>
          <button type="button" onClick={onClear} disabled={selectedCount === 0}
            className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> Clear
          </button>
        </div>
      </div>

      {/* Areas are a SHORTCUT, never a source of truth — the code still never
          derives from the area name. Containment is areaForRect's majority vote,
          the same rule that decides which area names a rack. */}
      {areaNames.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            Or select a whole area
          </p>
          <div className="flex flex-wrap gap-1.5">
            {areaNames.map((name) => (
              <button key={name} type="button" className={chip} onClick={() => onSelectArea(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {blocks.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            Or re-select a block you have already done
          </p>
          <div className="flex flex-wrap gap-1.5">
            {blocks.map((b) => (
              <button key={b.block} type="button" className={chip} onClick={() => onSelectBlock(b.block)}>
                {b.block} <span className="text-stone-400">{b.units}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {lastSweep && (
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2">
          <p className="min-w-0 flex-1 text-[11px] text-stone-600">
            Last sweep: <span className="font-mono font-semibold">{lastSweep.block}</span>,{' '}
            {lastSweep.rows} code{lastSweep.rows === 1 ? '' : 's'}.
          </p>
          <button
            type="button"
            onClick={onRevert}
            disabled={reverting}
            className="shrink-0 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-40"
          >
            {reverting ? 'Reverting…' : 'Undo it'}
          </button>
        </div>
      )}

      {/* Visible before Apply, and deliberately not a block: an overlap between two
          areas is sometimes exactly what the operator means. */}
      {spannedAreas.length > 1 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-900">
          This selection spans {spannedAreas.join(' and ')}. They will all be given one
          block name — paint a smaller area if you meant to keep them apart.
        </p>
      )}
    </div>
  )
}
