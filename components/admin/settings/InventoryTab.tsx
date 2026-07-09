// Settings → Inventory: low-stock threshold + the global "show Stock tab to
// customers" toggle. (The dead low-stock preview stub from the old panel was
// intentionally not ported.)

import React from 'react'
import { Package, Loader2 } from 'lucide-react'
import { useSettingsDraft } from './useSettingsDraft'
import { SettingsSection, SettingsField, NumberInput, Toggle, SaveBar } from './primitives'

const KEYS = ['lowStockThreshold', 'showStockToHoReCa'] as const
type Key = (typeof KEYS)[number]

const InventoryTab: React.FC = () => {
  const { loaded, draft, setField, isDirty, errors, isSaving, save, discard } =
    useSettingsDraft<Key>(KEYS)

  if (!loaded || !draft) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    )
  }

  return (
    <div className="max-w-3xl divide-y divide-stone-200">
      <SettingsSection
        title="Inventory"
        description="Stock warnings and customer stock visibility."
        icon={<Package className="w-5 h-5" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingsField
            label="Low Stock Threshold"
            htmlFor="settings-low-stock"
            helper={'Products below this quantity show a "Low Stock" warning'}
            error={errors.lowStockThreshold}
          >
            <NumberInput
              id="settings-low-stock"
              value={draft.lowStockThreshold}
              onChange={e => setField('lowStockThreshold', Math.max(1, Number(e.target.value)))}
              min={1}
              invalid={!!errors.lowStockThreshold}
            />
          </SettingsField>
        </div>

        <Toggle
          checked={draft.showStockToHoReCa}
          onChange={next => setField('showStockToHoReCa', next)}
          label="Show Stock tab to Customers"
          description="When enabled, HoReCa users can see the Stock tab in the sidebar. Per-customer overrides live in Settings → Customers."
        />

        <SaveBar
          isDirty={isDirty}
          isSaving={isSaving}
          hasErrors={Object.keys(errors).length > 0}
          onSave={save}
          onDiscard={discard}
        />
      </SettingsSection>
    </div>
  )
}

export default InventoryTab
