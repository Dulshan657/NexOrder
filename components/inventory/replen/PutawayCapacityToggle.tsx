// NX-0049: the owner's "space is unlimited for now" switch for putaway
// (app_settings.putaway_ignore_capacity, mig 00151).
//
// When on, no home location is ever full (capacity or maximum), a homed
// product always goes home, and nothing waits as "Home full". Weight limits
// still apply. Only an Admin can change it: mutate-app-settings refuses anyone
// else, and the switch is shown read-only to them.

import React from 'react'
import { useSettings, useUpdateSettings } from '../../../hooks/queries/useSettings'
import { useToastActions } from '../../../hooks/useToasts'

interface PutawayCapacityToggleProps {
  canEdit: boolean
}

const PutawayCapacityToggle: React.FC<PutawayCapacityToggleProps> = ({ canEdit }) => {
  const { data: settings, isLoading } = useSettings()
  const update = useUpdateSettings()
  const { addToast } = useToastActions()

  if (isLoading || !settings) return null
  const on = (settings as { putaway_ignore_capacity?: boolean }).putaway_ignore_capacity === true

  const toggle = async () => {
    try {
      await update.mutateAsync({ putaway_ignore_capacity: !on })
      addToast(!on ? 'Location capacity is now ignored at putaway' : 'Location capacity is enforced again', 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not save the setting, try again', 'error')
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 flex items-start gap-3">
      <input
        id="putaway-ignore-capacity"
        type="checkbox"
        aria-label="Ignore location capacity (treat space as unlimited)"
        className="mt-1 h-4 w-4"
        checked={on}
        disabled={!canEdit || update.isPending}
        onChange={toggle}
      />
      <label htmlFor="putaway-ignore-capacity" className="text-xs text-stone-700">
        <strong className="block text-sm text-stone-900">Ignore location capacity (treat space as unlimited)</strong>
        A product with a home always goes home, however much arrives, and nothing waits as &ldquo;Home full&rdquo;.
        Weight limits still apply.
        {!canEdit && <span className="block mt-1 text-stone-500">Only an Admin can change this.</span>}
      </label>
    </div>
  )
}

export default PutawayCapacityToggle
