// Settings → Automation: the PO Inbox auto-approval policy toggles.
// Shares TOGGLES with the PO Inbox header popover (AutoApprovalMenu) — both
// surfaces read/write the same ['settings'] query so they stay in sync.
// Each toggle saves immediately (snake_case patch), matching the popover.

import React from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { useSettings, useUpdateSettings } from '../../../hooks/queries/useSettings'
import { useToasts } from '../../../hooks/useToasts'
import { TOGGLES, policyValue, type PolicyToggle } from './autoApprovalPolicy'
import { SettingsSection, Toggle } from './primitives'

const AutomationTab: React.FC = () => {
  const settingsQuery = useSettings()
  const updateMutation = useUpdateSettings()
  const { addToast } = useToasts()

  const settings = settingsQuery.data as Record<string, unknown> | undefined
  const loaded = !!settings
  const saving = updateMutation.isPending
  const masterOn = policyValue(settings, 'po_auto_approve_enabled')

  async function toggle(t: PolicyToggle) {
    const next = !policyValue(settings, t.key)
    try {
      await updateMutation.mutateAsync({ [t.key]: next })
      addToast(`${t.label} ${next ? 'on' : 'off'}.`, 'success')
    } catch (err) {
      addToast(
        `Couldn't update setting: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error',
      )
    }
  }

  return (
    <div className="max-w-3xl divide-y divide-stone-200">
      <SettingsSection
        title="PO auto-approval"
        description="Controls which inbound POs are approved automatically vs held for review. Changes apply immediately."
        icon={<ShieldCheck className="w-5 h-5" />}
      >
        {!loaded && (
          <p className="flex items-center gap-2 text-sm text-stone-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        )}
        {loaded && (
          <div className="space-y-4">
            {TOGGLES.map(t => (
              <div key={t.key} className={t.sub ? 'pl-6' : ''}>
                <Toggle
                  checked={policyValue(settings, t.key)}
                  onChange={() => void toggle(t)}
                  disabled={saving || (t.sub && !masterOn)}
                  label={t.label}
                  description={t.help}
                />
              </div>
            ))}
            {!masterOn && (
              <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                Auto-approval is off — every PO is held for review.
              </p>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

export default AutomationTab
