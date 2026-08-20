// Paste a block of SKU/quantity rows instead of picking them one at a time.
//
// The office already works in spreadsheets and email, so the fast path into an
// order is a paste, not twenty dropdowns. Everything it decides comes from
// `resolveOrderLines` — the same pure module the grid renders from — so what
// this panel previews IS what gets added.

import React, { useMemo, useState } from 'react'
import { ClipboardPaste, AlertTriangle, Check } from 'lucide-react'

import { Button, Textarea } from '../../ui'
import { resolveOrderLines } from '../../../lib/newOrder/resolveOrderLines'
import type { ParsedOrderLine } from '../../../lib/newOrder/resolveOrderLines'
import type { Product } from '../../../types'

interface CsvPastePanelProps {
  products: Product[]
  onAdd: (lines: ParsedOrderLine[]) => void
}

const CsvPastePanel: React.FC<CsvPastePanelProps> = ({ products, onAdd }) => {
  const [text, setText] = useState('')

  // Live, because the whole point is that the operator sees the refusals while
  // the text is still in front of them and can fix the row rather than hunt for
  // it after a failed submit.
  const result = useMemo(() => resolveOrderLines(text, products), [text, products])
  const hasInput = text.trim() !== ''

  // Keep exactly the rows that could not be used, so "fix the rest" means
  // editing what is still on screen rather than finding it again in an email.
  const add = () => {
    onAdd(result.lines)
    setText(result.issues.map((i) => i.raw).join('\n'))
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardPaste className="w-4 h-4 text-stone-500" />
        <h3 className="text-sm font-semibold text-stone-800">Paste lines</h3>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        One row per line, product code then quantity. Commas or tabs both work, so a
        block copied straight out of a spreadsheet pastes as-is. A header row is ignored.
      </p>

      <Textarea
        value={text}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={'AMD-001, 10\nAMD-002, 4'}
        className="font-mono text-sm"
      />

      {hasInput && (
        <div className="mt-3 space-y-2">
          {result.lines.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check className="w-3.5 h-3.5" />
              {result.lines.length} line{result.lines.length === 1 ? '' : 's'} ready
            </p>
          )}
          {result.issues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {result.issues.length} row{result.issues.length === 1 ? '' : 's'} cannot be used
              </p>
              <ul className="space-y-0.5">
                {result.issues.map((issue) => (
                  <li key={`${issue.line}-${issue.reason}`} className="text-xs text-amber-900">
                    <span className="font-mono font-semibold">Line {issue.line}</span> — {issue.detail}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 mt-1.5">
                Adding takes the good rows only. The rest stay in the box so they can be fixed.
              </p>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={result.lines.length === 0}
            onClick={add}
          >
            Add {result.lines.length > 0 ? result.lines.length : ''} to order
          </Button>
        </div>
      )}
    </div>
  )
}

export default CsvPastePanel
