// POInboxView — single parent for the consolidated PO Inbox admin tab.
//
// Two sub-tabs (Queue, Aliases) + a Mailboxes button/popover in the nav.
// URL-persists the active sub-tab via `?subtab=` so deep-links and browser
// back/forward work. Owns the post-OAuth-callback handling (it's always
// mounted while the PO Inbox tab is open) and opens the Mailboxes popover
// when a connection completes.

import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { LoadingSkeleton } from '../Skeleton'
import POInboxStatsTile from './POInboxStatsTile'
import MailboxesMenu from './MailboxesMenu'
import type { HoReCa, Product } from '../../types'

const POInboxTab = lazy(() => import('./POInboxTab'))
const POAliasesTab = lazy(() => import('./POAliasesTab'))

export type POInboxSubTab = 'queue' | 'aliases'

const VALID_SUBTABS: ReadonlyArray<POInboxSubTab> = ['queue', 'aliases']

interface POInboxViewProps {
  hoReCas: HoReCa[]
  products: Product[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  onViewInOrderImport?: (orderId: string) => void
}

function readInitialSubtab(): POInboxSubTab {
  if (typeof window === 'undefined') return 'queue'
  const raw = new URLSearchParams(window.location.search).get('subtab')
  if (raw && (VALID_SUBTABS as ReadonlyArray<string>).includes(raw)) {
    return raw as POInboxSubTab
  }
  // Legacy or unknown values (e.g. the removed 'mailboxes') fall back to Queue.
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
  // Bumped to ask MailboxesMenu to open its popover (after an OAuth callback).
  const [mailboxOpenNonce, setMailboxOpenNonce] = useState(0)

  const switchSubtab = useCallback((next: POInboxSubTab) => {
    setSubtab(next)
    writeSubtabToUrl(next)
  }, [])

  useEffect(() => {
    function onPopState() {
      setSubtab(readInitialSubtab())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    writeSubtabToUrl(subtab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Post-OAuth callback: surface the result, open the Mailboxes popover, then
  // strip the params so a refresh doesn't repeat the toast. Lifted here from
  // the former EmailAccountsTab so it fires even though the popover isn't
  // mounted at page load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const connectError = params.get('connect_error')
    if (!connected && !connectError) return
    if (connected === '1') {
      addToast?.('Mailbox connected. The first sync will run within a minute.', 'success')
      setMailboxOpenNonce(n => n + 1)
    } else if (connectError) {
      const message = params.get('message') ?? connectError
      addToast?.(`Connect failed (${connectError}): ${message}`, 'error')
      setMailboxOpenNonce(n => n + 1)
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('connected')
    url.searchParams.delete('connect_error')
    url.searchParams.delete('account_id')
    url.searchParams.delete('message')
    window.history.replaceState({}, '', url.toString())
  }, [addToast])

  const handleViewSourcePo = useCallback(
    (pendingPoId: string) => {
      setPresetPendingPoId(pendingPoId)
      switchSubtab('queue')
    },
    [switchSubtab],
  )

  useEffect(() => {
    if (subtab !== 'queue' && presetPendingPoId) {
      setPresetPendingPoId(null)
    }
  }, [subtab, presetPendingPoId])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-semibold tracking-tight text-stone-900">
              PO Inbox
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              Inbound purchase orders extracted from email, ready to review.
            </p>
          </div>
          <POInboxStatsTile variant="inline" />
        </div>

        <nav
          className="mt-6 flex items-center justify-between gap-4 border-b border-stone-200/70"
          aria-label="PO Inbox sub-navigation"
        >
          <div className="flex items-center gap-6">
            <SubtabButton active={subtab === 'queue'} onClick={() => switchSubtab('queue')}>
              Queue
            </SubtabButton>
            <SubtabButton active={subtab === 'aliases'} onClick={() => switchSubtab('aliases')}>
              Aliases
            </SubtabButton>
          </div>
          <MailboxesMenu addToast={addToast} autoOpenNonce={mailboxOpenNonce} />
        </nav>
      </header>

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
