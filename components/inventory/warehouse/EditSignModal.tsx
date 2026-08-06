// Retype or remove one floor sign, from the map (mig 00097).
//
// EDITS THE WORKING SET, NOT THE SERVER. Clicking a sign on the map enters
// annotate mode; this dialog dispatches into that session and the operator then
// presses Save like any other annotation edit. That is deliberate — `paint_labels`
// is a full replace, so a dialog that saved by itself would be a second
// implementation of the same write, with its own fingerprint to capture and get
// wrong. Compare RenameAreaModal, which DOES call the server directly: an area
// rename cascades bin names and needs the server's dry run to be worth showing.
// A sign rename changes a string on a picture; there is nothing to preview.
//
// Renaming moves EVERY cell of the sign. A sign's identity is its text, so
// changing one cell would split the region and leave half of it reading the old
// words — the same rule as rename_area.

import { useState } from 'react'
import { Modal } from '@/components/ui'
import { MAX_SIGN_NAME, sanitizeSignName, signNameIssue } from '@/lib/signPaint'

interface EditSignModalProps {
  signName: string
  onRename: (from: string, to: string) => void
  onErase: (name: string) => void
  onClose: () => void
}

export function EditSignModal({ signName, onRename, onErase, onClose }: EditSignModalProps) {
  const [text, setText] = useState(signName)
  const trimmed = sanitizeSignName(text)
  const issue = text.trim() ? signNameIssue(text) : 'Give the sign some text.'
  const changed = trimmed !== signName

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit sign"
      size="sm"
      footer={({ requestClose }) => (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { onErase(signName); onClose() }}
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 btn-press"
          >
            Remove sign
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 btn-press"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onRename(signName, trimmed); onClose() }}
              disabled={!!issue || !changed}
              className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white btn-press disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-2">
        <label className="block text-xs text-stone-500">
          Sign text
          <input
            className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-700"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_SIGN_NAME}
            autoFocus
          />
        </label>
        {issue && text.trim() && <p className="text-[11px] text-rose-600">{issue}</p>}
        <p className="text-[11px] leading-snug text-stone-500">
          Every cell of this sign is retyped. Nothing is written until you press Save on the
          annotate bar — no bin is renamed and the layout does not need republishing.
        </p>
      </div>
    </Modal>
  )
}
