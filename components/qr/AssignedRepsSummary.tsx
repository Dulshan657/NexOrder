// "Assigned reps" on the HoReCa profile: who approves this venue's kitchen QR orders.
// Read-only; the edit form (AssignedRepsPicker) changes it.

import { useMemo } from 'react'
import { UserCheck } from 'lucide-react'
import { useHorecaReps } from '@/hooks/queries/useHoReCas'
import { useProfiles } from '@/hooks/queries/useProfiles'

export interface AssignedRepsSummaryProps {
  horecaId: number
}

export default function AssignedRepsSummary({ horecaId }: AssignedRepsSummaryProps) {
  const { data: repIds, isLoading, isError } = useHorecaReps(horecaId)
  const { data: profiles } = useProfiles()

  const names = useMemo(() => {
    const byId = new Map(((profiles ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
    return (repIds ?? []).map((id) => byId.get(id) ?? 'Unknown rep').sort((a, b) => a.localeCompare(b))
  }, [repIds, profiles])

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-stone-500">
        <UserCheck className="w-3.5 h-3.5" aria-hidden="true" /> Assigned reps
      </div>
      {isLoading ? (
        <p className="text-sm text-stone-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-stone-500">Could not load the assigned reps.</p>
      ) : names.length > 0 ? (
        <p className="text-sm font-semibold text-stone-900">{names.join(', ')}</p>
      ) : (
        <p className="text-sm text-stone-500">None assigned</p>
      )}
    </div>
  )
}
