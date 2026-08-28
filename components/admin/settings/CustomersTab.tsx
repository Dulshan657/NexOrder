// Settings → Customers: per-customer commercial settings.
//   1. Credit & access — default credit limit (app settings draft) + a
//      per-customer table of credit limit / tier / stock-tab overrides. All
//      three columns queue locally and flush together on Save (the old panel
//      saved tier immediately — now unified into the queue).
//   2. HoReCa pricing — blanket discount + per-product price overrides, saved
//      per customer with its own button (semantics unchanged from the old panel).

import React, { useEffect, useMemo, useState } from 'react'
import { CreditCard, Tags, Loader2 } from 'lucide-react'
import type { HoReCa, HoReCaTier, Product } from '../../../types'
import { useSettingsDraft } from './useSettingsDraft'
import {
  SettingsSection,
  SettingsField,
  NumberInput,
  TextInput,
  SelectInput,
  SaveBar,
} from './primitives'

interface CustomersTabProps {
  hoReCas: HoReCa[]
  products: Product[]
  onUpdateHoReCa: (customer: HoReCa, reason?: string) => void
}

const KEYS = ['defaultCreditLimit'] as const
type Key = (typeof KEYS)[number]

const TIER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'None' },
  { value: 'Gold', label: 'Gold' },
  { value: 'Silver', label: 'Silver' },
  { value: 'Bronze', label: 'Bronze' },
]

type StockTabChoice = 'default' | 'true' | 'false'

const CustomersTab: React.FC<CustomersTabProps> = ({ hoReCas, products, onUpdateHoReCa }) => {
  return (
    <div className="max-w-3xl divide-y divide-stone-200">
      <CreditAccessSection hoReCas={hoReCas} onUpdateHoReCa={onUpdateHoReCa} />
      <PricingSection hoReCas={hoReCas} products={products} onUpdateHoReCa={onUpdateHoReCa} />
    </div>
  )
}

// ── Section 1: credit & access ────────────────────────────────────

const CreditAccessSection: React.FC<{
  hoReCas: HoReCa[]
  onUpdateHoReCa: (customer: HoReCa, reason?: string) => void
}> = ({ hoReCas, onUpdateHoReCa }) => {
  const { loaded, draft, setField, isDirty: draftDirty, errors, isSaving, save, discard } =
    useSettingsDraft<Key>(KEYS)

  // Per-customer edit queues; flushed together on Save.
  const [creditLimitEdits, setCreditLimitEdits] = useState<Record<number, string>>({})
  const [tierEdits, setTierEdits] = useState<Record<number, string>>({}) // '' = None
  const [stockTabEdits, setStockTabEdits] = useState<Record<number, StockTabChoice>>({})

  // Merge every queued change into one updated HoReCa per customer, keeping
  // only customers whose values actually differ from the current data.
  const pendingUpdates = useMemo(() => {
    const map = new Map<number, HoReCa>()
    const draftOf = (c: HoReCa): HoReCa => map.get(c.id) ?? { ...c }

    for (const [idStr, valStr] of Object.entries(creditLimitEdits)) {
      const customer = hoReCas.find(c => c.id === Number(idStr))
      if (!customer) continue
      const newLimit = valStr === '' ? undefined : Number(valStr)
      if (Number.isNaN(newLimit as number)) continue
      if (newLimit !== customer.creditLimit) {
        map.set(customer.id, { ...draftOf(customer), creditLimit: newLimit })
      }
    }

    for (const [idStr, tierStr] of Object.entries(tierEdits)) {
      const customer = hoReCas.find(c => c.id === Number(idStr))
      if (!customer) continue
      const newTier = tierStr === '' ? undefined : (tierStr as HoReCaTier)
      if (newTier !== customer.tier) {
        map.set(customer.id, { ...draftOf(customer), tier: newTier })
      }
    }

    for (const [idStr, choice] of Object.entries(stockTabEdits)) {
      const customer = hoReCas.find(c => c.id === Number(idStr))
      if (!customer) continue
      const newValue = choice === 'default' ? undefined : choice === 'true'
      if (newValue !== customer.showStockTab) {
        map.set(customer.id, { ...draftOf(customer), showStockTab: newValue })
      }
    }

    return map
  }, [creditLimitEdits, tierEdits, stockTabEdits, hoReCas])

  const modifiedCount = pendingUpdates.size
  const isDirty = draftDirty || modifiedCount > 0

  const handleSave = async () => {
    if (Object.keys(errors).length > 0) return
    await save() // no-ops when the default-credit draft is clean
    for (const updated of pendingUpdates.values()) {
      onUpdateHoReCa(updated)
    }
    setCreditLimitEdits({})
    setTierEdits({})
    setStockTabEdits({})
  }

  const handleDiscard = () => {
    discard()
    setCreditLimitEdits({})
    setTierEdits({})
    setStockTabEdits({})
  }

  const creditValue = (customer: HoReCa): string => {
    const edit = creditLimitEdits[customer.id]
    if (edit !== undefined) return edit
    return customer.creditLimit !== undefined ? String(customer.creditLimit) : ''
  }

  const tierValue = (customer: HoReCa): string => {
    const edit = tierEdits[customer.id]
    if (edit !== undefined) return edit
    return customer.tier ?? ''
  }

  const stockTabValue = (customer: HoReCa): StockTabChoice => {
    const edit = stockTabEdits[customer.id]
    if (edit !== undefined) return edit
    return customer.showStockTab !== undefined ? (String(customer.showStockTab) as StockTabChoice) : 'default'
  }

  if (!loaded || !draft) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    )
  }

  return (
    <SettingsSection
      title="Credit & access"
      description="Default credit limit for new customers, plus per-customer limits, tiers and Stock-tab overrides."
      icon={<CreditCard className="w-5 h-5" />}
    >
      <SettingsField
        label="Default Credit Limit ($)"
        htmlFor="settings-default-credit"
        helper="Applied to new hoReCas. Set to 0 for no credit."
        error={errors.defaultCreditLimit}
      >
        <div className="w-full sm:w-64">
          <NumberInput
            id="settings-default-credit"
            value={draft.defaultCreditLimit}
            onChange={e => setField('defaultCreditLimit', Math.max(0, Number(e.target.value)))}
            min={0}
            step={100}
            invalid={!!errors.defaultCreditLimit}
          />
        </div>
      </SettingsField>

      <div>
        <p className="text-sm font-medium text-stone-700 mb-3">HoReCa Credit Limits</p>
        <div className="bg-white rounded-lg border border-stone-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">HoReCa</th>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">Current Limit ($)</th>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">Tier</th>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">Stock Tab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {hoReCas.map(customer => (
                <tr key={customer.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 text-stone-900 font-medium">{customer.name}</td>
                  <td className="px-4 py-2.5">
                    <div className="w-36">
                      <NumberInput
                        dense
                        aria-label={`Credit limit for ${customer.name}`}
                        value={creditValue(customer)}
                        onChange={e =>
                          setCreditLimitEdits(prev => ({ ...prev, [customer.id]: e.target.value }))
                        }
                        placeholder="No limit"
                        min={0}
                        step={100}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="w-28">
                      <SelectInput
                        dense
                        aria-label={`Tier for ${customer.name}`}
                        value={tierValue(customer)}
                        onChange={e =>
                          setTierEdits(prev => ({ ...prev, [customer.id]: e.target.value }))
                        }
                      >
                        {TIER_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </SelectInput>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="w-32">
                      <SelectInput
                        dense
                        aria-label={`Stock tab visibility for ${customer.name}`}
                        value={stockTabValue(customer)}
                        onChange={e =>
                          setStockTabEdits(prev => ({
                            ...prev,
                            [customer.id]: e.target.value as StockTabChoice,
                          }))
                        }
                      >
                        <option value="default">Default</option>
                        <option value="true">Show</option>
                        <option value="false">Hide</option>
                      </SelectInput>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        hasErrors={Object.keys(errors).length > 0}
        onSave={handleSave}
        onDiscard={handleDiscard}
        status={modifiedCount > 0 ? `${modifiedCount} customer${modifiedCount === 1 ? '' : 's'} modified` : undefined}
      />
    </SettingsSection>
  )
}

// ── Section 2: HoReCa pricing (ported editor, semantics unchanged) ─

const PricingSection: React.FC<{
  hoReCas: HoReCa[]
  products: Product[]
  onUpdateHoReCa: (customer: HoReCa, reason?: string) => void
}> = ({ hoReCas, products, onUpdateHoReCa }) => {
  const [selectedPricingCustomerId, setSelectedPricingCustomerId] = useState<number | null>(null)
  const [blanketDiscountEdit, setBlanketDiscountEdit] = useState<string>('')
  const [pricingEdits, setPricingEdits] = useState<Record<number, string>>({})
  const [pricingSearch, setPricingSearch] = useState('')
  const [pricingSaved, setPricingSaved] = useState(false)

  const selectedPricingCustomer = hoReCas.find(c => c.id === selectedPricingCustomerId) ?? null

  const filteredPricingProducts = useMemo(() => {
    if (!pricingSearch.trim()) return products
    const q = pricingSearch.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q))
  }, [products, pricingSearch])

  useEffect(() => {
    if (selectedPricingCustomer) {
      setBlanketDiscountEdit(
        selectedPricingCustomer.discountPercent != null
          ? String(selectedPricingCustomer.discountPercent)
          : '',
      )
      const initial: Record<number, string> = {}
      if (selectedPricingCustomer.pricing) {
        for (const pid in selectedPricingCustomer.pricing) {
          initial[Number(pid)] = String(selectedPricingCustomer.pricing[Number(pid)])
        }
      }
      setPricingEdits(initial)
    } else {
      setBlanketDiscountEdit('')
      setPricingEdits({})
    }
    setPricingSearch('')
    setPricingSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPricingCustomerId, hoReCas])

  const handleSavePricing = () => {
    if (!selectedPricingCustomer) return

    const newDiscount =
      blanketDiscountEdit.trim() === ''
        ? undefined
        : Math.min(100, Math.max(0, Number(blanketDiscountEdit)))

    const newPricing: { [productId: number]: number } = {}
    for (const pidStr of Object.keys(pricingEdits)) {
      const valStr = pricingEdits[Number(pidStr)]
      if (valStr == null) continue
      const price = parseFloat(valStr)
      if (!isNaN(price) && valStr.trim() !== '') {
        newPricing[Number(pidStr)] = price
      }
    }

    onUpdateHoReCa({
      ...selectedPricingCustomer,
      discountPercent: newDiscount,
      pricing: Object.keys(newPricing).length > 0 ? newPricing : undefined,
    })
    setPricingSaved(true)
    setTimeout(() => setPricingSaved(false), 2000)
  }

  return (
    <SettingsSection
      title="HoReCa pricing"
      description="Set blanket discounts and per-product price overrides for each customer. The better price (lower) wins."
      icon={<Tags className="w-5 h-5" />}
    >
      <SettingsField label="Select HoReCa" htmlFor="settings-pricing-customer">
        <div className="w-full sm:w-64">
          <SelectInput
            id="settings-pricing-customer"
            value={selectedPricingCustomerId ?? ''}
            onChange={e => setSelectedPricingCustomerId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Choose a customer...</option>
            {hoReCas.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </div>
      </SettingsField>

      {selectedPricingCustomer && (
        <div className="border-t border-stone-200 pt-4 space-y-5">
          <SettingsField
            label="Blanket Discount (%)"
            htmlFor="settings-blanket-discount"
            helper="Applied to all products. Per-product overrides below may give a better price."
          >
            <div className="w-full sm:w-64">
              <NumberInput
                id="settings-blanket-discount"
                value={blanketDiscountEdit}
                onChange={e => {
                  setBlanketDiscountEdit(e.target.value)
                  setPricingSaved(false)
                }}
                min={0}
                max={100}
                step={0.5}
                placeholder="No blanket discount"
              />
            </div>
          </SettingsField>

          <div>
            <label
              htmlFor="settings-pricing-search"
              className="block text-sm font-medium text-stone-700 mb-2"
            >
              Per-Product Price Overrides
            </label>
            <TextInput
              id="settings-pricing-search"
              value={pricingSearch}
              onChange={e => setPricingSearch(e.target.value)}
              placeholder="Search products..."
              className="mb-3"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 max-h-80 overflow-y-auto pr-1">
              {filteredPricingProducts.map(product => (
                <div key={product.id} className="flex items-center gap-3">
                  <div className="flex-grow min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{product.name}</p>
                    <p className="text-xs text-stone-500">Default: ${product.price.toFixed(2)}</p>
                  </div>
                  <div className="w-28 flex-shrink-0">
                    <NumberInput
                      dense
                      aria-label={`Price override for ${product.name}`}
                      value={pricingEdits[product.id] ?? ''}
                      onChange={e => {
                        setPricingEdits(prev => ({ ...prev, [product.id]: e.target.value }))
                        setPricingSaved(false)
                      }}
                      placeholder={product.price.toFixed(2)}
                      min={0}
                      step={0.01}
                    />
                  </div>
                </div>
              ))}
            </div>
            {filteredPricingProducts.length === 0 && (
              <p className="text-center text-stone-500 py-4 text-sm">No products match your search.</p>
            )}
          </div>

          <div className="pt-3 border-t border-stone-200">
            <button
              type="button"
              onClick={handleSavePricing}
              className={`font-medium py-2 px-5 rounded-lg transition-colors text-sm shadow-sm btn-press ${
                pricingSaved ? 'bg-emerald-600 text-white' : 'bg-stone-900 hover:bg-stone-800 text-white'
              }`}
            >
              {pricingSaved ? 'Saved!' : `Save Pricing for ${selectedPricingCustomer.name}`}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

export default CustomersTab
