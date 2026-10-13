// Pick which Field/Office Sales Reps look after a venue (HoReCa edit form).
//
// Why it matters: only assigned reps approve the venue's kitchen QR orders and
// manage its PINs; Admin and Manager always can, and so can the venue's own
// Customer logins. A rep who is not assigned sees none of it.
//
// OWNS ITS OWN SAVING. The form around it knows nothing about reps: this reports
// a `PendingSave` (lib/qr/assignedReps.ts) whenever the selection differs from
// what is stored, and null when it does not. The form calls `save()` before it
// saves the venue and stays open if that throws. Keeping the persistence in here is
// what lets a tenant without the shop module ship none of it -- the form's own
// code never mentions `set_reps`.

import { useMemo, useState } from 'react'
import { Callout } from '@/components/ui'
import { useToastActions } from '@/hooks/useToasts'
import { useHorecaReps, useSetHorecaReps } from '@/hooks/queries/useHoReCas'
import { useProfiles } from '@/hooks/queries/useProfiles'
import { repCandidates, sameIdSet, toggleId, type PendingSave } from '@/lib/qr/assignedReps'

export interface AssignedRepsPickerProps {
  horecaId: number
  /** A saver when the selection differs from what is stored; null when it does not. */
  onPendingSave: (pending: PendingSave | null) => void
  disabled?: boolean
}

export default function AssignedRepsPicker({ horecaId, onPendingSave, disabled = false }: AssignedRepsPickerProps) {
  const { addToast } = useToastActions()
  const { data: stored, isLoading: loadingStored, isError: storedFailed } = useHorecaReps(horecaId)
  const { data: profiles, isLoading: loadingProfiles } = useProfiles()
  const setReps = useSetHorecaReps()

  // null = untouched: show what is stored.
  const [selection, setSelection] = useState<string[] | null>(null)

  const candidates = useMemo(
    () => repCandidates((profiles ?? []) as Array<{ id: string; name: string; email: string; role: string }>),
    [profiles],
  )

  const current = selection ?? stored ?? []
  const loading = loadingStored || loadingProfiles

  const toggle = (id: string) => {
    // Never change anything on top of an assignment we could not read: the save
    // sends the COMPLETE set, so a guess about the rest would unassign people.
    if (!stored) return
    const next = toggleId(current, id)
    if (sameIdSet(next, stored)) {
      setSelection(null)
      onPendingSave(null)
      return
    }
    setSelection(next)
    onPendingSave({
      save: async () => {
        await setReps.mutateAsync({ horecaId, repIds: next })
        addToast('Assigned reps updated', 'success')
      },
    })
  }

  return (
    <fieldset className="mt-8 border-t border-stone-100 pt-6" disabled={disabled}>
      <legend className="text-lg font-semibold text-stone-800">Assigned reps</legend>
      <p className="mt-1 mb-3 text-sm text-stone-600">
        Assigned reps can approve this venue&rsquo;s staff QR orders and manage its staff PINs. Admins and
        managers always can.
      </p>

      {loading && <p role="status" className="text-sm text-stone-600">Loading reps...</p>}

      {storedFailed && (
        <Callout tone="danger" title="Could not load the assigned reps">
          Reload and try again. Changes to this list will not be saved until it loads.
        </Callout>
      )}

      {!loading && !storedFailed && candidates.length === 0 && (
        <p className="text-sm text-stone-600">There are no sales reps to assign yet.</p>
      )}

      {!loading && !storedFailed && candidates.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {candidates.map((rep) => {
            const inputId = `assigned-rep-${horecaId}-${rep.id}`
            return (
              <li key={rep.id}>
                <label
                  htmlFor={inputId}
                  className="touch-target-y flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 hover:bg-stone-50"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    aria-label={rep.name}
                    className="h-4 w-4 rounded border-stone-300 text-nexgen-blue-dark focus:ring-nexgen-blue-dark"
                    checked={current.includes(rep.id)}
                    onChange={() => toggle(rep.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{rep.name}</span>
                    <span className="block truncate text-xs text-stone-600">{rep.role}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </fieldset>
  )
}
