// Settings → Products: catalogue-wide defaults. Today that is one thing — the
// standard pallet every product's pallet quantity is worked out against.
//
// ── WHY ITS OWN SUB-TAB ─────────────────────────────────────────────────────
//
// It is consumed by the PRODUCT form, not by a warehouse surface: the pallet
// fit turns a carton into a "Pallet" unit on a product's unit ladder. Filing it
// under Warehouse would put it beside level roles and label stock — real
// warehouse configuration that a product record never reads — and under
// Inventory it would sit with the low-stock threshold, which is about stock
// levels rather than the catalogue.
//
// ── WHY GLOBAL, STATED SO NOBODY HAS TO GUESS ───────────────────────────────
//
// One pallet standard for the business, taken as a decision. If a tenant ever
// runs two sites on different standards this needs its own table keyed by
// warehouse — not four more columns somewhere — because the four figures only
// mean anything together.

import React from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import { useSettingsDraft } from './useSettingsDraft'
import { SettingsSection, SettingsField, NumberInput, SaveBar } from './primitives'

const KEYS = [
  'palletFootprintLengthMm',
  'palletFootprintWidthMm',
  'palletBaseHeightMm',
  'palletMaxLoadHeightMm',
] as const
type Key = (typeof KEYS)[number]

const ProductsTab: React.FC = () => {
  const { loaded, draft, setField, isDirty, errors, isSaving, save, discard } =
    useSettingsDraft<Key>(KEYS)

  if (!loaded || !draft) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    )
  }

  const overall = draft.palletBaseHeightMm + draft.palletMaxLoadHeightMm

  return (
    <div className="max-w-3xl divide-y divide-stone-200">
      <SettingsSection
        title="Standard pallet"
        description="Used to work out how many cartons fit on a pallet for each product, and from that how many units. Set it once for the business."
        icon={<Boxes className="w-5 h-5" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingsField
            label="Footprint length (mm)"
            htmlFor="settings-pallet-length"
            helper="Australian standard is 1165 × 1165 mm."
            error={errors.palletFootprintLengthMm}
          >
            <NumberInput
              id="settings-pallet-length"
              value={draft.palletFootprintLengthMm}
              onChange={e => setField('palletFootprintLengthMm', Number(e.target.value))}
              min={1}
              invalid={!!errors.palletFootprintLengthMm}
            />
          </SettingsField>

          <SettingsField
            label="Footprint width (mm)"
            htmlFor="settings-pallet-width"
            error={errors.palletFootprintWidthMm}
          >
            <NumberInput
              id="settings-pallet-width"
              value={draft.palletFootprintWidthMm}
              onChange={e => setField('palletFootprintWidthMm', Number(e.target.value))}
              min={1}
              invalid={!!errors.palletFootprintWidthMm}
            />
          </SettingsField>

          <SettingsField
            label="Pallet deck height (mm)"
            htmlFor="settings-pallet-base"
            helper="The empty pallet itself. Reported, not subtracted from the load height."
            error={errors.palletBaseHeightMm}
          >
            <NumberInput
              id="settings-pallet-base"
              value={draft.palletBaseHeightMm}
              onChange={e => setField('palletBaseHeightMm', Number(e.target.value))}
              min={0}
              invalid={!!errors.palletBaseHeightMm}
            />
          </SettingsField>

          <SettingsField
            label="Maximum load height (mm)"
            htmlFor="settings-pallet-load"
            helper="How tall the GOODS may stack, not counting the pallet."
            error={errors.palletMaxLoadHeightMm}
          >
            <NumberInput
              id="settings-pallet-load"
              value={draft.palletMaxLoadHeightMm}
              onChange={e => setField('palletMaxLoadHeightMm', Number(e.target.value))}
              min={1}
              invalid={!!errors.palletMaxLoadHeightMm}
            />
          </SettingsField>
        </div>

        {/* The four figures are hard to sanity-check separately; the overall
            height is the one an operator can measure against real racking. */}
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
          {draft.palletFootprintLengthMm} × {draft.palletFootprintWidthMm} mm footprint ·{' '}
          {draft.palletMaxLoadHeightMm} mm of load on a {draft.palletBaseHeightMm} mm deck ={' '}
          <span className="font-medium text-stone-700">{overall} mm</span> overall.
        </p>

        <p className="text-xs text-stone-400">
          Changing this re-works every product’s pallet quantity. Figures already saved onto a
          product’s unit ladder are left alone — they are shown as entered by hand until someone
          confirms the new number.
        </p>

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

export default ProductsTab
