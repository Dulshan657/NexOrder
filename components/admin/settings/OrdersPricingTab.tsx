// Settings → Orders & Pricing: order ID prefix, minimum order value, currency,
// carton discount. The order-ID preview uses a real mount-time timestamp
// (fixes the old hardcoded 1711817600000 example).

import React, { useRef } from 'react'
import { FileText, DollarSign, Loader2 } from 'lucide-react'
import { useSettingsDraft } from './useSettingsDraft'
import {
  SettingsSection,
  SettingsField,
  TextInput,
  NumberInput,
  SelectInput,
  SaveBar,
} from './primitives'

const CURRENCIES = ['AUD', 'USD', 'NZD', 'GBP', 'EUR', 'SGD', 'MYR'] as const

const KEYS = ['orderIdPrefix', 'minimumOrderValue', 'currency', 'cartonDiscountPercent'] as const
type Key = (typeof KEYS)[number]

const OrdersPricingTab: React.FC = () => {
  const { loaded, draft, setField, isDirty, errors, isSaving, save, discard } =
    useSettingsDraft<Key>(KEYS)
  // Stable example timestamp for the order-ID preview (real, not hardcoded).
  const previewTs = useRef(Date.now())

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
        title="Orders"
        description="How new order IDs are generated and the minimum basket size."
        icon={<FileText className="w-5 h-5" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SettingsField
            label="Order ID Prefix"
            htmlFor="settings-order-prefix"
            helper={`e.g. ${draft.orderIdPrefix || 'ORD'}-${previewTs.current}`}
            error={errors.orderIdPrefix}
          >
            <TextInput
              id="settings-order-prefix"
              value={draft.orderIdPrefix}
              onChange={e => setField('orderIdPrefix', e.target.value.toUpperCase())}
              maxLength={6}
              className="font-mono"
              invalid={!!errors.orderIdPrefix}
            />
          </SettingsField>
          <SettingsField
            label="Minimum Order Value ($)"
            htmlFor="settings-min-order"
            helper="Set to 0 for no minimum"
            error={errors.minimumOrderValue}
          >
            <NumberInput
              id="settings-min-order"
              value={draft.minimumOrderValue}
              onChange={e => setField('minimumOrderValue', Math.max(0, Number(e.target.value)))}
              min={0}
              step={1}
              invalid={!!errors.minimumOrderValue}
            />
          </SettingsField>
          <SettingsField label="Currency" htmlFor="settings-currency">
            <SelectInput
              id="settings-currency"
              value={draft.currency}
              onChange={e => setField('currency', e.target.value)}
            >
              {CURRENCIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Pricing"
        description="Global pricing rules. Per-customer pricing lives in Settings → Customers."
        icon={<DollarSign className="w-5 h-5" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingsField
            label="Carton Discount (%)"
            htmlFor="settings-carton-discount"
            helper="Discount applied when ordering full cartons"
            error={errors.cartonDiscountPercent}
          >
            <NumberInput
              id="settings-carton-discount"
              value={draft.cartonDiscountPercent}
              onChange={e =>
                setField('cartonDiscountPercent', Math.min(50, Math.max(0, Number(e.target.value))))
              }
              min={0}
              max={50}
              step={0.5}
              invalid={!!errors.cartonDiscountPercent}
            />
          </SettingsField>
        </div>
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

export default OrdersPricingTab
