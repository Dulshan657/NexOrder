// The three step bodies for the slotting block builder.
//
// Together they are smaller than any one of the recode steps, so they share a file
// rather than a directory — the recode split exists because NumberingStep alone is
// 296 lines, and a directory of three 60-line files would be structure for its own
// sake.

import { Eraser, Brush, Square, Undo2, X, Layers, Boxes } from 'lucide-react'
import {
  CARD, CHIP, HINT, MINI_BUTTON, SECTION_LABEL, SEGMENT_GROUP, segment,
} from '../panelChrome'
import type { SlotTool } from './useSlotSelection'
import type { SlottingRuleRow } from '@/services/supabase/slottingRulesService'

// ── 1. Select ────────────────────────────────────────────────────────────────

export interface SlotSelectStepProps {
  tool: SlotTool
  mode: 'add' | 'erase'
  selectedCount: number
  binCount: number
  canUndo: boolean
  areaNames: readonly string[]
  onTool: (tool: SlotTool) => void
  onMode: (mode: 'add' | 'erase') => void
  onUndo: () => void
  onClear: () => void
  onSelectArea: (name: string) => void
}

export function SlotSelectStep(p: SlotSelectStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className={SECTION_LABEL}>Brush</div>
        <div className={`${SEGMENT_GROUP} mt-1.5`}>
          <button type="button" className={segment(p.tool === 'paint')} onClick={() => p.onTool('paint')}>
            <Brush className="h-3.5 w-3.5" /> Paint
          </button>
          <button type="button" className={segment(p.tool === 'rect')} onClick={() => p.onTool('rect')}>
            <Square className="h-3.5 w-3.5" /> Band
          </button>
        </div>
        <div className={`${SEGMENT_GROUP} mt-1.5`}>
          <button type="button" className={segment(p.mode === 'add')} onClick={() => p.onMode('add')}>
            Add
          </button>
          {/* Tinted rose when armed, not blue: mid-paint, "what will my drag do"
              has to be readable in peripheral vision, and two identically-blue
              pills do not answer that. */}
          <button type="button" className={segment(p.mode === 'erase', 'danger')} onClick={() => p.onMode('erase')}>
            <Eraser className="h-3.5 w-3.5" /> Erase
          </button>
        </div>
        <p className={`${HINT} mt-2`}>
          Drag across the racking you want in this block. Dragging over open floor
          moves the map instead, so you can pan without switching tools.
        </p>
      </div>

      <div className={CARD}>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl tabular-nums text-stone-900">{p.selectedCount}</span>
          <span className="text-xs text-stone-500">
            {p.selectedCount === 1 ? 'rack or bin' : 'racks and bins'} selected
          </span>
        </div>
        {/* The number that actually matters downstream: a rack counts once here
            but contributes all its levels to the block. */}
        <p className={`${HINT} mt-1`}>
          {p.binCount} bin{p.binCount === 1 ? '' : 's'} in total once racks are expanded.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={MINI_BUTTON} disabled={!p.canUndo} onClick={p.onUndo}>
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            type="button" className={MINI_BUTTON}
            disabled={p.selectedCount === 0} onClick={p.onClear}
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {p.areaNames.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Or start from a painted area</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {p.areaNames.map((name) => (
              <button key={name} type="button" className={CHIP} onClick={() => p.onSelectArea(name)}>
                <Layers className="h-3 w-3" /> {name}
              </button>
            ))}
          </div>
          {/* The area is a SOURCE, not a live binding — mig 00115's header says so
              and the operator needs to know it here, not discover it later. */}
          <p className={`${HINT} mt-2`}>
            This copies the area&apos;s racking into the block once. Repainting the
            area later will not change the block.
          </p>
        </div>
      )}
    </div>
  )
}

// ── 2. Name ──────────────────────────────────────────────────────────────────

export interface SlotBlockStepProps {
  name: string
  binCount: number
  existingNames: readonly string[]
  /** Set when this flow is editing an existing block rather than creating one. */
  editingExisting: boolean
  onName: (name: string) => void
}

export function SlotBlockStep(p: SlotBlockStepProps) {
  const clash = p.existingNames.some(
    (n) => n.trim().toLowerCase() === p.name.trim().toLowerCase(),
  )
  return (
    <div className="space-y-4">
      <div>
        <label className="block">
          <span className={SECTION_LABEL}>Block name</span>
          <input
            className="mt-1.5 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/20"
            value={p.name}
            maxLength={60}
            placeholder="Coconut aisle"
            onChange={(e) => p.onName(e.target.value)}
          />
        </label>
        <p className={`${HINT} mt-2`}>
          What you would call this part of the floor out loud. Rules refer to it by
          name, and several rules can share one block.
        </p>
        {clash && !p.editingExisting && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-amber-200">
            A block called “{p.name.trim()}” already exists here. Saving will be
            refused — names are unique per warehouse.
          </p>
        )}
      </div>

      <div className={CARD}>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl tabular-nums text-stone-900">{p.binCount}</span>
          <span className="text-xs text-stone-500">bin{p.binCount === 1 ? '' : 's'} in this block</span>
        </div>
      </div>

      {p.existingNames.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Already here</div>
          <p className={`${HINT} mt-1.5`}>{p.existingNames.join(' · ')}</p>
        </div>
      )}
    </div>
  )
}

// ── 3. Rule ──────────────────────────────────────────────────────────────────

export interface SlotRuleStepProps {
  blockName: string
  attachRuleId: string
  newRuleName: string
  newRuleBrand: string
  rules: readonly SlottingRuleRow[]
  brands: readonly string[]
  onAttachRule: (id: string) => void
  onNewRuleName: (name: string) => void
  onNewRuleBrand: (brand: string) => void
}

export function SlotRuleStep(p: SlotRuleStepProps) {
  const attaching = p.attachRuleId !== ''
  const creating = p.newRuleName.trim() !== '' || p.newRuleBrand.trim() !== ''

  return (
    <div className="space-y-4">
      <p className={HINT}>
        A block on its own stores nothing about products. Point a rule at it to make
        putaway use it — now, or later from Settings.
      </p>

      {p.rules.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Add to an existing rule</div>
          <select
            className="mt-1.5 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm"
            value={p.attachRuleId}
            onChange={(e) => p.onAttachRule(e.target.value)}
          >
            <option value="">Don&apos;t attach it</option>
            {p.rules.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name} ({r.blocks.length} block{r.blocks.length === 1 ? '' : 's'})
              </option>
            ))}
          </select>
          {attaching && (
            <p className={`${HINT} mt-1.5`}>
              “{p.blockName.trim() || 'This block'}” will be added as the last
              overflow block on that rule. Reorder it in Settings.
            </p>
          )}
        </div>
      )}

      <div className={attaching ? 'opacity-40' : ''}>
        <div className={SECTION_LABEL}>Or start a new rule</div>
        <div className="mt-1.5 space-y-2">
          <input
            className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/20"
            value={p.newRuleName}
            maxLength={60}
            placeholder="Rule name"
            disabled={attaching}
            onChange={(e) => p.onNewRuleName(e.target.value)}
          />
          <input
            list="slot-panel-brands"
            className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/20"
            value={p.newRuleBrand}
            maxLength={60}
            placeholder="Brand it applies to"
            disabled={attaching}
            onChange={(e) => p.onNewRuleBrand(e.target.value)}
          />
          {/* ONE datalist, not one per input — the replenishment grid froze Chrome
              with a select per row and the lesson generalises. */}
          <datalist id="slot-panel-brands">
            {p.brands.map((b) => <option key={b} value={b} />)}
          </datalist>
        </div>
        {/* This deliberately offers ONE axis. Several axes, hard enforcement and
            reservation are real decisions with consequences on the floor, and they
            belong on the settings table where they can be read together — not
            buried in a map panel a step from a paint stroke. */}
        <p className={`${HINT} mt-2`}>
          Brand only, and soft: it will prefer this block, never refuse a bin. For
          categories, suppliers, a single SKU or a hard rule, use Settings →
          Warehouse → Slotting rules.
        </p>
      </div>

      {!attaching && !creating && (
        <div className={CARD}>
          <div className="flex items-start gap-2">
            <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            <p className="text-xs text-stone-600">
              Saving just the block is fine. It will appear in Settings, ready for a
              rule whenever you want one.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
