// POInboxView — single parent for the consolidated PO Inbox admin tab.
//
// Three sub-tabs (Queue, Archive, Aliases) + the Auto-approval and Mailboxes
// menus in the page header.
// URL-persists the active sub-tab via `?subtab=` so deep-links and browser
// back/forward work. Owns the post-OAuth-callback handling (it's always
// mounted while the PO Inbox tab is open) and opens the Mailboxes popover
// when a connection completes.

import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { LoadingSkeleton } from '../Skeleton'
import { PageFrame } from '../ui/PageFrame'
import { PageHeader } from '../ui/PageHeader'
import { PageTabs } from '../ui/PageTabs'
import { ADMIN_TAB_LABELS } from '../../lib/adminTabUrl'
import { lazyWithRetry } from '../../lib/lazyWithRetry'
import POInboxStatsTile from './POInboxStatsTile'
import MailboxesMenu from './MailboxesMenu'
import AutoApprovalMenu from './AutoApprovalMenu'
import type { HoReCa, Product } from '../../types'

const POInboxTab = lazyWithRetry(() => import('./POInboxTab'))
const POAliasesTab = lazyWithRetry(() => import('./POAliasesTab'))

export type POInboxSubTab = 'queue' | 'archive' | 'aliases'

const VALID_SUBTABS: ReadonlyArray<POInboxSubTab> = ['queue', 'archive', 'aliases']

const SUBTABS: ReadonlyArray<{ id: POInboxSubTab; label: string }> = [
  { id: 'queue', label: 'Queue' },
  { id: 'archive', label: 'Archive' },
  { id: 'aliases', label: 'Aliases' },
]

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
    // Stamp the URL with the current sub-tab on first render so a refresh stays put.
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
      // Open the popover on failure too, so the operator can retry Connect.
      setMailboxOpenNonce(n => n + 1)
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('connected')
    url.searchParams.delete('connect_error')
    url.searchParams.delete('account_id')
    url.searchParams.delete('message')
    window.history.replaceState({}, '', url.toString())
    // OAuth callback params are read once on mount; addToast is stable for the
    // life of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <PageFrame>
      <PageHeader
        title={ADMIN_TAB_LABELS['PO Inbox']}
        description="Inbound purchase orders extracted from email, ready to review."
        actions={
          <>
            <AutoApprovalMenu addToast={addToast} />
            <MailboxesMenu addToast={addToast} autoOpenNonce={mailboxOpenNonce} />
          </>
        }
      />

      <POInboxStatsTile variant="inline" />

      <PageTabs
        ariaLabel="PO Inbox sub-navigation"
        tabs={SUBTABS}
        activeId={subtab}
        onChange={switchSubtab}
      />

      {/* A <section>, not a <main>. AppShell already renders the document's one
          <main> and this view is inside it -- nesting a second is invalid HTML,
          and a screen reader listing landmarks then offers two "main" regions
          with no way to tell which is the real one. The label is what makes it
          worth being a landmark at all. */}
      <section aria-label="Purchase order inbox">
        <Suspense fallback={<LoadingSkeleton />}>
          {subtab === 'queue' && (
            <POInboxTab
              hoReCas={hoReCas}
              addToast={addToast}
              presetPendingPoId={presetPendingPoId}
              onViewInOrderImport={onViewInOrderImport}
            />
          )}
          {subtab === 'archive' && (
            <POInboxTab
              archived
              hoReCas={hoReCas}
              addToast={addToast}
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
      </section>
    </PageFrame>
  )
}

export default POInboxView
