// POInboxView — single parent for the consolidated PO Inbox admin tab.
//
// Replaces three separate top-level admin tabs (Email Accounts, PO Inbox,
// PO Aliases) with one tab + three sub-tabs. URL-persists the active
// sub-tab via `?subtab=` so deep-links and browser back/forward work.

import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { LoadingSkeleton } from '../Skeleton'
import POInboxStatsTile from './POInboxStatsTile'
import MailboxHealthBanner from './MailboxHealthBanner'
import type { HoReCa, Product } from '../../types'

const EmailAccountsTab = lazy(() => import('./EmailAccountsTab'))
const POInboxTab = lazy(() => import('./POInboxTab'))
const POAliasesTab = lazy(() => import('./POAliasesTab'))

export type POInboxSubTab = 'queue' | 'mailboxes' | 'aliases'

const VALID_SUBTABS: ReadonlyArray<POInboxSubTab> = ['queue', 'mailboxes', 'aliases']

interface POInboxViewProps {
  hoReCas: HoReCa[]
  products: Product[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /**
   * Handler from AppShell to deep-link an approved PO into Order Import.
   * Forwarded to POInboxDetailModal via POInboxTab.
   */
  onViewInOrderImport?: (orderId: string) => void
}

function readInitialSubtab(): POInboxSubTab {
  if (typeof window === 'undefined') return 'queue'
  const raw = new URLSearchParams(window.location.search).get('subtab')
  if (raw && (VALID_SUBTABS as ReadonlyArray<string>).includes(raw)) {
    return raw as POInboxSubTab
  }
  return 'queue'
}

function writeSubtabToUrl(next: POInboxSubTab): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('subtab', next)
  window.history.replaceState({}, '', url.toString())
}

const POInboxView: React.FC<POInboxViewProps> = ({
  hoReCas,
  products,
  addToast,
  onViewInOrderImport,
}) => {
  const [subtab, setSubtab] = useState<POInboxSubTab>(readInitialSubtab)
  const [presetPendingPoId, setPresetPendingPoId] = useState<string | null>(null)

  const switchSubtab = useCallback((next: POInboxSubTab) => {
    setSubtab(next)
    writeSubtabToUrl(next)
  }, [])

  // Browser back/forward should sync the sub-tab.
  useEffect(() => {
    function onPopState() {
      setSubtab(readInitialSubtab())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // First render: stamp the URL with the current sub-tab so refresh stays here.
  useEffect(() => {
    writeSubtabToUrl(subtab)
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleViewSourcePo = useCallback(
    (pendingPoId: string) => {
      setPresetPendingPoId(pendingPoId)
      switchSubtab('queue')
    },
    [switchSubtab],
  )

  // Once the Queue sub-tab has consumed the preset, clear it so the next
  // visit doesn't accidentally re-open the modal.
  useEffect(() => {
    if (subtab !== 'queue' && presetPendingPoId) {
      setPresetPendingPoId(null)
    }
  }, [subtab, presetPendingPoId])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-display font-semibold tracking-tight text-stone-900">
          PO Inbox
        </h1>
        <div className="mt-3">
          <POInboxStatsTile variant="inline" />
        </div>

        <nav
          className="mt-6 flex items-center gap-6 border-b border-stone-200/70"
          aria-label="PO Inbox sub-navigation"
        >
          <SubtabButton active={subtab === 'queue'} onClick={() => switchSubtab('queue')}>
            Queue
          </SubtabButton>
          <SubtabButton active={subtab === 'mailboxes'} onClick={() => switchSubtab('mailboxes')}>
            Mailboxes
          </SubtabButton>
          <SubtabButton active={subtab === 'aliases'} onClick={() => switchSubtab('aliases')}>
            Aliases
          </SubtabButton>
        </nav>
      </header>

      <MailboxHealthBanner onGoToMailboxes={() => switchSubtab('mailboxes')} />

      <main className="mt-6">
        <Suspense fallback={<LoadingSkeleton />}>
          {subtab === 'queue' && (
            <POInboxTab
              hoReCas={hoReCas}
              addToast={addToast}
              presetPendingPoId={presetPendingPoId}
              onViewInOrderImport={onViewInOrderImport}
            />
          )}
          {subtab === 'mailboxes' && <EmailAccountsTab addToast={addToast} />}
          {subtab === 'aliases' && (
            <POAliasesTab
              hoReCas={hoReCas}
              products={products}
              addToast={addToast}
              onViewSourcePo={handleViewSourcePo}
            />
          )}
        </Suspense>
      </main>
    </div>
  )
}

interface SubtabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

// Underline tab — text + 2px bottom border on active. The border sits flush
// with the parent nav's `border-b`, so the active item visually "pierces"
// the divider.
const SubtabButton: React.FC<SubtabButtonProps> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative -mb-px py-2.5 text-sm transition-colors border-b-2 ${
      active
        ? 'border-stone-900 text-stone-900 font-medium'
        : 'border-transparent text-stone-500 hover:text-stone-800'
    }`}
  >
    {children}
  </button>
)

export default POInboxView
