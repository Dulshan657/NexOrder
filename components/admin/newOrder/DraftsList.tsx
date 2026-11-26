// Every saved draft, everyone's: open one to carry on, or delete it.

import React from 'react'
import { FileText, Trash2 } from 'lucide-react'

import { Button, Modal } from '../../ui'
import type { OrderDraft } from '../../../lib/newOrder/orderDraft'
import type { HoReCa } from '../../../types'

interface DraftsListProps {
  open: boolean
  onClose: () => void
  drafts: OrderDraft[]
  hoReCas: HoReCa[]
  /** The draft on screen now; marked, and not deletable from here. */
  currentDraftId: string | null
  onOpen: (draft: OrderDraft) => void
  onDelete: (draft: OrderDraft) => void
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function DraftsList({ open, onClose, drafts, hoReCas, currentDraftId, onOpen, onDelete }: DraftsListProps) {
  const nameOf = (id: number | null) =>
    id === null ? 'No customer yet' : hoReCas.find((h) => h.id === id)?.name ?? `Customer ${id}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Drafts"
      icon={<FileText className="w-5 h-5" />}
      description="Orders saved while they were being keyed. Anyone in the office can finish one."
      size="lg"
    >
      {drafts.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-600">No drafts.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {drafts.map((d) => {
            const isCurrent = d.id === currentDraftId
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-stone-900 truncate">{nameOf(d.hoReCaId)}</p>
                  <p className="text-xs text-stone-600">
                    {d.lines.length} line{d.lines.length === 1 ? '' : 's'} · by {d.createdByName ?? 'someone'}
                    {d.updatedByName && d.updatedByName !== d.createdByName ? `, last edited by ${d.updatedByName}` : ''}
                    {' · '}
                    {when(d.updatedAt)}
                  </p>
                </div>
                {isCurrent ? (
                  <span className="text-xs font-medium text-stone-600">On screen</span>
                ) : (
                  <>
                    <Button type="button" size="sm" onClick={() => onOpen(d)} aria-label={`Open draft for ${nameOf(d.hoReCaId)}`}>
                      Open
                    </Button>
                    <button
                      type="button"
                      onClick={() => onDelete(d)}
                      aria-label={`Delete draft for ${nameOf(d.hoReCaId)}`}
                      className="touch-target rounded-lg p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 btn-press"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
