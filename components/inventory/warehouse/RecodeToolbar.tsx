// The recode-mode bar above the live warehouse map (mig 00107).
//
// Reads like AreaPaintToolbar on purpose — same shelf, same button order, same
// Cancel/commit pair — because an operator who has annotated a floor should not
// have to learn a second vocabulary to renumber one. What differs is the middle:
// there is no brush and no undo stack, because a selection is not a picture. The
// commit is "Preview", never a bare Save: this rewrites the barcode payload of
// every bin in the band, and the operator sees the whole list first.
//
// The live sample is rendered by the SAME pure module the server plans with
// (lib/codePattern.ts), so what the operator reads here is what they will get —
// evaluated early, not approximated.

import { Barcode, Eraser, ScanLine } from 'lucide-react'
import {
  BUILTIN_PATTERN,
  CODE_ORDERS,
  CODE_ORDER_LABELS,
  MAX_BLOCK_LENGTH,
  codeIssue,
  describeCodeIssue,
  formatCode,
  sanitizeBlock,
  templateIssue,
  type CodeOrder,
} from '@/lib/codePattern'

interface RecodeToolbarProps {
  warehouseCode: string
  block: string
  startAt: number | null
  order: CodeOrder
  templateOverride: string | null
  /** The site's stored pattern, or null when it is on the built-in default. */
  storedTemplate: string | null
  selectedCount: number
  busy: boolean
  onBlock: (block: string) => void
  onStart: (startAt: number | null) => void
  onOrder: (order: CodeOrder) => void
  onTemplate: (template: string | null) => void
  onClearSelection: () => void
  onCancel: () => void
  onPreview: () => void
}

export function RecodeToolbar({
  warehouseCode,
  block,
  startAt,
  order,
  templateOverride,
  storedTemplate,
  selectedCount,
  busy,
  onBlock,
  onStart,
  onOrder,
  onTemplate,
  onClearSelection,
  onCancel,
  onPreview,
}: RecodeToolbarProps) {
  const template = templateOverride ?? storedTemplate ?? BUILTIN_PATTERN.template
  const tmplIssue = templateIssue(template)
  const cleanBlock = sanitizeBlock(block)

  // The first three codes, exactly as the server will render them. Coordinates are
  // placeholders — only a `{x}`/`{y}` template would show them, and such a template
  // has no counter and will be refused as a duplicate anyway.
  const samples = tmplIssue
    ? []
    : [0, 1, 2].map((i) =>
        formatCode(template, {
          wh: warehouseCode,
          block: cleanBlock,
          x: 3,
          y: 4,
          n: (startAt ?? 1) + i,
          floor: 0,
        }),
      )
  const sampleIssue = samples.length > 0 ? codeIssue(samples[0]) : null

  const blocked = busy || selectedCount === 0 || !cleanBlock || !!tmplIssue || !!sampleIssue

  return (
    <div className="space-y-2 rounded-xl border border-nexgen-blue/30 bg-nexgen-blue/5 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-nexgen-blue">
          <Barcode className="h-3.5 w-3.5" strokeWidth={2.5} /> Recoding
        </span>
        <span className="text-xs text-stone-500">
          {selectedCount === 0
            ? 'Drag a box over the bins to renumber. Shift-drag adds to the selection.'
            : `${selectedCount} selected`}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 btn-press disabled:opacity-40"
          >
            <Eraser className="h-4 w-4" strokeWidth={2} /> Clear
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPreview}
            disabled={blocked}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white btn-press disabled:opacity-40"
          >
            <ScanLine className="h-4 w-4" strokeWidth={2} />
            {busy ? 'Checking…' : 'Preview'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-stone-500">Block</span>
          <input
            aria-label="Code block"
            value={block}
            maxLength={MAX_BLOCK_LENGTH}
            onChange={(e) => onBlock(e.target.value)}
            placeholder="COLD-A"
            className="w-40 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs uppercase text-stone-800 outline-none focus:border-nexgen-blue/60"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-stone-500">Start at</span>
          <input
            aria-label="Start number"
            type="number"
            min={1}
            max={9999}
            value={startAt ?? ''}
            onChange={(e) => onStart(e.target.value === '' ? null : Number(e.target.value))}
            placeholder="auto"
            className="w-24 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs text-stone-800 outline-none focus:border-nexgen-blue/60"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-stone-500">Order</span>
          <select
            aria-label="Numbering order"
            value={order}
            onChange={(e) => onOrder(e.target.value as CodeOrder)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 outline-none focus:border-nexgen-blue/60"
          >
            {CODE_ORDERS.map((o) => (
              <option key={o} value={o}>{CODE_ORDER_LABELS[o]}</option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-stone-500">
            Pattern {templateOverride ? '(this sweep only)' : '(site default)'}
          </span>
          <input
            aria-label="Code pattern"
            value={template}
            maxLength={64}
            onChange={(e) => onTemplate(e.target.value)}
            className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs text-stone-800 outline-none focus:border-nexgen-blue/60"
          />
        </label>
      </div>

      {/* Blank start means "continue past whatever this block already reaches", and
          that is worth saying out loud — it is the only number on this bar the
          operator did not choose. */}
      {startAt === null && (
        <p className="text-[11px] text-stone-500">
          Start is blank, so numbering continues after the highest number already in
          this block. Type one to force it.
        </p>
      )}

      {tmplIssue ? (
        <p className="text-[11px] font-medium text-rose-600">{tmplIssue}</p>
      ) : sampleIssue ? (
        <p className="text-[11px] font-medium text-rose-600">
          {describeCodeIssue(sampleIssue, samples[0])}
        </p>
      ) : cleanBlock ? (
        <p className="font-mono text-[11px] text-stone-500">
          {samples.join('  ·  ')}{selectedCount > 3 ? '  ·  …' : ''}
        </p>
      ) : (
        <p className="text-[11px] text-stone-500">Type a block to see the codes.</p>
      )}
    </div>
  )
}
