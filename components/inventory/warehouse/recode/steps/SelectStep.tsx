// Step 1 — what to recode.
//
// The brush is the primary tool and is armed by default. The rectangle is secondary
// and hit-tests by `contain`, so a band that clips a neighbouring rack leaves it
// alone; between them they cover both the awkward shapes and the tidy ones.
//
// The site's swept/total progress used to live at the top of this step. It is
// standing context — equally true on all four steps — so it belongs to the panel
// header, where it no longer competes with the selection count for the same glance.

import { Brush, Eraser, Square, Undo2, Trash2, Check, AlertTriangle } from 'lucide-react'
import { Callout } from '@/components/ui'
import type { RecodeTool } from '../useRecodeSelection'
import type { BlockCensusRow } from '../recodeGeometry'
import { CHIP, MINI_BUTTON, SECTION_LABEL, SEGMENT_GROUP, segment } from '../recodeChrome'

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

const KBD =
  'rounded border border-stone-300 bg-white px-1 font-mono text-[10px] text-stone-600'

export function SelectStep({
  tool, mode, selectedCount, canUndo, areaNames, spannedAreas, blocks,
  lastSweep, reverting, onRevert,
  onTool, onMode, onUndo, onClear, onSelectArea, onSelectBlock,
}: SelectStepProps) {
  const brushArmed = tool === 'paint' && mode === 'add'
  const boxArmed = tool === 'rect' && mode === 'add'
  const erasing = mode === 'erase'

  return (
    <div className="flex flex-col gap-4">
      {/* The count is the answer to "how is this going", so it leads. The spanned
          areas note lives INSIDE this card because it is a fact about the selection,
          and it used to sit eight blocks below the number it qualifies. */}
      <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3">
        <div className="flex items-end gap-2">
          <span className="font-display text-2xl font-semibold leading-none tabular-nums text-stone-900">
            {selectedCount}
          </span>
          <span className="pb-0.5 text-xs text-stone-500">
            bin{selectedCount === 1 ? '' : 's'} selected
          </span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={onUndo} disabled={!canUndo} className={MINI_BUTTON}>
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Undo
            </button>
            <button type="button" onClick={onClear} disabled={selectedCount === 0} className={MINI_BUTTON}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Clear
            </button>
          </div>
        </div>
        {/* Visible before Apply, and deliberately not a block: an overlap between two
            areas is sometimes exactly what the operator means. */}
        {spannedAreas.length > 1 && (
          <p className="mt-2 flex items-start gap-1.5 border-t border-stone-200 pt-2 text-xs leading-relaxed text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-hidden="true" />
            <span>
              Spans {spannedAreas.join(' and ')} — they will all take one block name.
              Paint a smaller area if you meant to keep them apart.
            </span>
          </p>
        )}
      </div>

      {/* A segmented control rather than three separately-outlined pills, which read
          as three unrelated buttons. Erase is tinted ROSE when armed: while painting,
          "what will my drag do" has to be answerable in peripheral vision. */}
      <div>
        <div role="group" aria-label="Selection tool" className={SEGMENT_GROUP}>
          <button
            type="button"
            aria-pressed={brushArmed}
            className={segment(brushArmed)}
            onClick={() => { onTool('paint'); onMode('add') }}
          >
            <Brush className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Brush
          </button>
          <button
            type="button"
            aria-pressed={boxArmed}
            className={segment(boxArmed)}
            onClick={() => { onTool('rect'); onMode('add') }}
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Box
          </button>
          <button
            type="button"
            aria-pressed={erasing}
            className={segment(erasing, 'danger')}
            onClick={() => onMode('erase')}
          >
            <Eraser className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Erase
          </button>
        </div>
        {/* Below the tools, not above: the tools answer "what do I do", the modifier
            is a footnote to it. */}
        {/* Both wordings ship and CSS picks one. A media query is the honest test
            here — the question is what the INPUT is, not how wide the screen is, and
            a tablet with a keyboard is a real thing. Doing it in CSS also keeps this
            component free of a matchMedia subscription it would otherwise need
            threaded down from the map's viewport hook. */}
        <p className="mt-2 text-xs leading-relaxed text-stone-500 [@media(pointer:coarse)]:hidden">
          Drag across bins to select them. Drag the open floor to move the map;
          hold <kbd className={KBD}>Alt</kbd> to pan from anywhere, and right-drag to erase.
        </p>
        <p className="mt-2 hidden text-xs leading-relaxed text-stone-500 [@media(pointer:coarse)]:block">
          Drag across bins to select them. Drag the open floor to move the map, and
          use two fingers to zoom.
        </p>
      </div>

      {/* One heading rather than two. Areas are a SHORTCUT, never a source of truth —
          the code still never derives from the area name. Containment is areaForRect's
          majority vote, the same rule that decides which area names a rack. */}
      {(areaNames.length > 0 || blocks.length > 0) && (
        <section className="flex flex-col gap-2">
          <p className={SECTION_LABEL}>Quick select</p>
          {areaNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-stone-500">Areas</span>
              {areaNames.map((name) => (
                <button key={name} type="button" className={CHIP} onClick={() => onSelectArea(name)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          {blocks.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-stone-500">Done already</span>
              {blocks.map((b) => (
                <button key={b.block} type="button" className={CHIP} onClick={() => onSelectBlock(b.block)}>
                  <Check className="h-3 w-3 text-emerald-500" strokeWidth={3} aria-hidden="true" />
                  <span className="font-mono">{b.block}</span>
                  <span className="tabular-nums text-stone-500">{b.units}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {lastSweep && (
        <Callout
          dense
          action={
            <button type="button" onClick={onRevert} disabled={reverting} className={MINI_BUTTON}>
              {reverting ? 'Reverting…' : 'Undo it'}
            </button>
          }
        >
          Last sweep: <span className="font-mono font-semibold text-stone-700">{lastSweep.block}</span>,{' '}
          {lastSweep.rows} code{lastSweep.rows === 1 ? '' : 's'}.
        </Callout>
      )}
    </div>
  )
}
