// "None found / finish short": end an open line of an imported order with what was
// really found, including nothing.
//
// Closing a line cannot be undone from the screen (undoing it is the office's job), so
// nothing is posted by the first tap. It opens a confirm step that says what will
// happen, with the found quantity in it, and only that confirm posts. The line's open
// units are released and one difference is recorded for the office; on-hand is NOT
// touched, because only a count changes on-hand.
//
// Offered only on an imported order (the workspace decides). Every other order never
// sees this control, and record-short-pick would refuse it anyway.

import React, { useEffect, useRef, useState } from 'react'
import { PackageX } from 'lucide-react'
import { useRecordShortPick } from '@/hooks/queries/useRecordShortPick'
import { useToastActions } from '@/hooks/useToasts'
import { refusalMessage } from '@/lib/pickRefusal'
import type { PickQueueLine } from '@/services/supabase/pickService'

interface FinishShortControlProps {
  orderId: string
  line: PickQueueLine
  /** The bin that was checked, when exactly one is known. It is flagged for a recount.
   *  Null when the line points at several bins or none: the server does not guess. */
  bin: { id: number; code: string } | null
  disabled: boolean
}

export const FinishShortControl: React.FC<FinishShortControlProps> = ({ orderId, line, bin, disabled }) => {
  const { addToast } = useToastActions()
  const finishShort = useRecordShortPick()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A second tap can land before React has re-rendered the button as disabled, and
  // posting twice is exactly what this guards: a ref is read synchronously, state is not.
  const inFlight = useRef(false)
  // Focus follows the control: it moves to the safe choice when the confirm opens, and
  // back to the trigger when the picker keeps picking, so a keyboard or a scanner's
  // trailing Enter is never left on a button that finishes the line.
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (wasConfirming.current && !confirming) triggerRef.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  const found = line.picked
  const open = Math.max(line.quantity - line.picked, 0)

  const confirm = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setError(null)
    try {
      await finishShort.mutateAsync({ orderId, orderItemId: line.orderItemId, locationId: bin?.id })
      addToast(`${line.productName} finished short`, 'success')
      setConfirming(false)
    } catch (err) {
      // The confirm stays open: the picker reads why, then keeps picking or tries again.
      setError(refusalMessage(err, 'Could not finish the line short.'))
    } finally {
      inFlight.current = false
    }
  }

  if (!confirming) {
    return (
      <div className="py-1.5 pl-5">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => { setError(null); setConfirming(true) }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 touch-target-y border border-stone-300 bg-white text-stone-700 text-xs font-medium rounded-lg btn-press disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PackageX className="w-3 h-3" aria-hidden="true" /> None found / finish short
        </button>
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label="Finish this line short"
      className="ml-5 my-2 p-3 rounded-lg border border-amber-300 bg-amber-50 space-y-2"
    >
      <p className="text-sm font-semibold text-stone-800">Finish {line.productName} short?</p>
      <p className="text-xs text-stone-700">
        You have found {found} of {line.quantity}. Picking stops on this line, and the {open} you did
        not find is recorded as a difference for the office and released. Stock counts do not change.
      </p>
      {bin && (
        <p className="text-xs text-stone-700">
          The bin {bin.code} will be flagged for a recount.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={confirm}
          disabled={finishShort.isPending}
          className="inline-flex items-center justify-center px-3.5 py-2 min-h-[44px] bg-stone-800 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
        >
          {finishShort.isPending ? 'Finishing…' : 'Finish short'}
        </button>
        <button
          type="button"
          onClick={() => { setError(null); setConfirming(false) }}
          disabled={finishShort.isPending}
          autoFocus
          className="inline-flex items-center justify-center px-3.5 py-2 min-h-[44px] border border-stone-300 bg-white text-stone-700 text-sm font-medium rounded-lg btn-press disabled:opacity-50"
        >
          Keep picking
        </button>
      </div>
    </div>
  )
}
