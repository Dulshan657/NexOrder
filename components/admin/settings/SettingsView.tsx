// SettingsView — shell for the revamped admin Settings tab.
//
// Six sub-tabs (General, Orders & Pricing, Inventory, Warehouse, Customers,
// Automation), URL-persisted via `?subtab=` following the POInboxView pattern.
// A `?designer=` / `?import=` deep link (from the Warehouse viewer's CTA)
// always lands on the Warehouse tab, where WarehousesSettingsSection consumes
// and strips the params. Tabs lazy-load on first visit and then stay mounted
// (hidden) so switching sub-tabs never discards unsaved drafts.

import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { LoadingSkeleton } from '../../Skeleton'
import { lazyWithRetry } from '../../../lib/lazyWithRetry'
import { settingsSubtabFromSearch, type SettingsSubTab } from '../../../lib/subtabUrl'
import { MODULE_PO_INBOX } from '../../../lib/modules'
import { SubtabButton } from './primitives'
import type { HoReCa, Product } from '../../../types'

const GeneralTab = lazyWithRetry(() => import('./GeneralTab'))
const OrdersPricingTab = lazyWithRetry(() => import('./OrdersPricingTab'))
const InventoryTab = lazyWithRetry(() => import('./InventoryTab'))
const WarehouseTab = lazyWithRetry(() => import('./WarehouseTab'))
const CustomersTab = lazyWithRetry(() => import('./CustomersTab'))
// The only sub-tab that belongs to a module. Everything else here — company
// profile, order prefix, minimum order value, currency, carton discount,
// inventory thresholds, warehouses, customer defaults — is configuration a
// tenant needs whatever they bought. "Orders & Pricing" in particular looks
// like a promotions surface and is not: it is the order NUMBERING and the
// carton discount, which a warehouse-only tenant still sets.
const AutomationTab = MODULE_PO_INBOX ? lazyWithRetry(() => import('./AutomationTab')) : null

export interface SettingsViewProps {
  hoReCas: HoReCa[]
  products: Product[]
  onUpdateHoReCa: (customer: HoReCa, reason?: string) => void
}

const TABS: ReadonlyArray<{ id: SettingsSubTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'orders', label: 'Orders & Pricing' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'customers', label: 'Customers' },
  ...(MODULE_PO_INBOX ? [{ id: 'automation' as SettingsSubTab, label: 'Automation' }] : []),
]

function readInitialSubtab(): SettingsSubTab {
  if (typeof window === 'undefined') return 'general'
  const requested = settingsSubtabFromSearch(window.location.search)
  // A `?subtab=automation` link outliving the module it names would otherwise
  // select a tab with no button and no panel — a blank Settings page. Degrade
  // to General, the same way `?tab=` degrades to the role's landing view.
  if (!TABS.some(t => t.id === requested)) return 'general'
  return requested
}

function writeSubtabToUrl(next: SettingsSubTab): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('subtab', next)
  window.history.replaceState({}, '', url.toString())
}

const SettingsView: React.FC<SettingsViewProps> = ({ hoReCas, products, onUpdateHoReCa }) => {
  const [subtab, setSubtab] = useState<SettingsSubTab>(readInitialSubtab)
  // Tabs the user has opened this session — they stay mounted (hidden) so
  // in-progress edits survive switching between sub-tabs.
  const [visited, setVisited] = useState<ReadonlySet<SettingsSubTab>>(() => new Set([subtab]))

  const activateSubtab = useCallback((next: SettingsSubTab) => {
    setSubtab(next)
    setVisited(prev => (prev.has(next) ? prev : new Set([...prev, next])))
  }, [])

  const switchSubtab = useCallback(
    (next: SettingsSubTab) => {
      activateSubtab(next)
      writeSubtabToUrl(next)
    },
    [activateSubtab],
  )

  useEffect(() => {
    function onPopState() {
      activateSubtab(readInitialSubtab())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [activateSubtab])

  useEffect(() => {
    // Stamp the URL with the current sub-tab on first render so a refresh stays put.
    writeSubtabToUrl(subtab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-display font-semibold tracking-tight text-stone-900">
          Settings
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Company profile, ordering rules, inventory, warehouses and automation.
        </p>

        <nav
          className="mt-6 flex items-center gap-6 border-b border-stone-200/70 overflow-x-auto"
          aria-label="Settings sub-navigation"
        >
          {TABS.map(t => (
            <SubtabButton key={t.id} active={subtab === t.id} onClick={() => switchSubtab(t.id)}>
              {t.label}
            </SubtabButton>
          ))}
        </nav>
      </header>

      <main className="mt-6">
        <Suspense fallback={<LoadingSkeleton />}>
          {visited.has('general') && (
            <div hidden={subtab !== 'general'}>
              <GeneralTab />
            </div>
          )}
          {visited.has('orders') && (
            <div hidden={subtab !== 'orders'}>
              <OrdersPricingTab />
            </div>
          )}
          {visited.has('inventory') && (
            <div hidden={subtab !== 'inventory'}>
              <InventoryTab />
            </div>
          )}
          {visited.has('warehouse') && (
            <div hidden={subtab !== 'warehouse'}>
              <WarehouseTab />
            </div>
          )}
          {visited.has('customers') && (
            <div hidden={subtab !== 'customers'}>
              <CustomersTab hoReCas={hoReCas} products={products} onUpdateHoReCa={onUpdateHoReCa} />
            </div>
          )}
          {MODULE_PO_INBOX && visited.has('automation') && (
            <div hidden={subtab !== 'automation'}>
              <AutomationTab />
            </div>
          )}
        </Suspense>
      </main>
    </div>
  )
}

export default SettingsView
