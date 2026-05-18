// EmailAccountsTab — admin page for connecting Gmail / Outlook mailboxes
// that the PO Inbox poller scans for inbound purchase orders.
//
// Admin and Manager can connect, pause/resume, and reconnect.
// Account-DELETE is intentionally not exposed: inbound_messages.FK has
// ON DELETE RESTRICT (preserves PO audit trail). Operators decommission
// a mailbox by setting status='paused'.

import React, { useEffect, useMemo, useState } from 'react'
import { Loader2, Mail, RefreshCw, PauseCircle, PlayCircle, AlertTriangle, Link as LinkIcon } from 'lucide-react'
import {
  useEmailAccounts,
  usePauseEmailAccount,
  useStartOAuthFlow,
} from '@/hooks/queries/useEmailAccounts'
import type {
  EmailAccountProvider,
  EmailAccountRow,
  EmailAccountStatus,
} from '@/services/supabase/emailAccountsService'

interface EmailAccountsTabProps {
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
}

const PROVIDER_LABEL: Record<EmailAccountProvider, string> = {
  gmail: 'Gmail / Google Workspace',
  outlook: 'Microsoft 365 / Outlook',
}

const STATUS_STYLES: Record<EmailAccountStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  paused: { label: 'Paused', className: 'bg-stone-100 text-stone-700 border-stone-200' },
  error: { label: 'Needs reconnect', className: 'bg-amber-50 text-amber-800 border-amber-200' },
}

const EmailAccountsTab: React.FC<EmailAccountsTabProps> = ({ addToast }) => {
  const accountsQuery = useEmailAccounts()
  const startOAuth = useStartOAuthFlow()
  const pauseMutation = usePauseEmailAccount()
  const [connecting, setConnecting] = useState<EmailAccountProvider | null>(null)

  // On mount, surface the post-OAuth-callback query params as toasts then
  // strip them from the URL so a refresh doesn't repeat the toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const connectError = params.get('connect_error')
    if (connected === '1') {
      addToast?.('Mailbox connected. The first sync will run within a minute.', 'success')
    } else if (connectError) {
      const message = params.get('message') ?? connectError
      addToast?.(`Connect failed (${connectError}): ${message}`, 'error')
    }
    if (connected || connectError) {
      const url = new URL(window.location.href)
      url.searchParams.delete('connected')
      url.searchParams.delete('connect_error')
      url.searchParams.delete('account_id')
      url.searchParams.delete('message')
      window.history.replaceState({}, '', url.toString())
    }
  }, [addToast])

  const accounts = accountsQuery.data ?? []
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        // Errored first so they're impossible to miss.
        if (a.status === 'error' && b.status !== 'error') return -1
        if (b.status === 'error' && a.status !== 'error') return 1
        return a.email_address.localeCompare(b.email_address)
      }),
    [accounts],
  )

  async function handleConnect(provider: EmailAccountProvider) {
    try {
      setConnecting(provider)
      const { authorizeUrl } = await startOAuth.mutateAsync(provider)
      window.location.href = authorizeUrl
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Could not start OAuth flow: ${message}`, 'error')
      setConnecting(null)
    }
  }

  async function handlePauseToggle(account: EmailAccountRow) {
    if (account.status === 'error') {
      addToast?.(
        'This account needs reconnecting — Pause/Resume will not recover it. Use Reconnect.',
        'info',
      )
      return
    }
    const desiredStatus = account.status === 'active' ? 'paused' : 'active'
    try {
      await pauseMutation.mutateAsync({ id: account.id, desiredStatus })
      addToast?.(
        `Mailbox ${account.email_address} ${desiredStatus === 'paused' ? 'paused' : 'resumed'}.`,
        'success',
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Update failed: ${message}`, 'error')
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Email Accounts</h2>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">
            Connect the mailbox(es) you receive purchase orders on. The poller checks every minute
            and extracts a standardized PO record from each new email.
          </p>
        </div>
        <div className="flex gap-2">
          <ConnectButton
            provider="gmail"
            busy={connecting === 'gmail'}
            disabled={startOAuth.isPending && connecting !== 'gmail'}
            onClick={handleConnect}
          />
          <ConnectButton
            provider="outlook"
            busy={connecting === 'outlook'}
            disabled={startOAuth.isPending && connecting !== 'outlook'}
            onClick={handleConnect}
          />
        </div>
      </header>

      <section className="rounded-xl border border-stone-200 bg-white shadow-card">
        {accountsQuery.isLoading ? (
          <div className="p-8 flex items-center justify-center text-stone-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading connected mailboxes…
          </div>
        ) : sortedAccounts.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-stone-200">
            {sortedAccounts.map(account => (
              <AccountRow
                key={account.id}
                account={account}
                onConnect={handleConnect}
                onTogglePause={handlePauseToggle}
                busy={pauseMutation.isPending}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-stone-500 max-w-2xl">
        Disconnecting a mailbox permanently is intentionally not available here — the email
        history is tied to existing purchase orders. Pause a mailbox to stop polling without
        losing audit history.
      </p>
    </div>
  )
}

interface ConnectButtonProps {
  provider: EmailAccountProvider
  busy: boolean
  disabled: boolean
  onClick: (p: EmailAccountProvider) => void
}

const ConnectButton: React.FC<ConnectButtonProps> = ({ provider, busy, disabled, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(provider)}
    disabled={busy || disabled}
    className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-60 disabled:cursor-not-allowed btn-press"
  >
    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
    Connect {PROVIDER_LABEL[provider].split(' / ')[0]}
  </button>
)

const EmptyState: React.FC = () => (
  <div className="p-8 text-center">
    <Mail className="w-8 h-8 mx-auto text-stone-400" />
    <p className="mt-3 text-sm text-stone-600">No mailboxes connected yet.</p>
    <p className="mt-1 text-xs text-stone-500">
      Click <strong>Connect Gmail</strong> or <strong>Connect Outlook</strong> to start.
    </p>
  </div>
)

interface AccountRowProps {
  account: EmailAccountRow
  onConnect: (p: EmailAccountProvider) => void
  onTogglePause: (account: EmailAccountRow) => void
  busy: boolean
}

const AccountRow: React.FC<AccountRowProps> = ({ account, onConnect, onTogglePause, busy }) => {
  const status = STATUS_STYLES[account.status]
  return (
    <li className="px-4 py-3 sm:px-6 sm:py-4 flex items-center gap-4 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-stone-900 truncate">{account.email_address}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
            {account.status === 'error' && <AlertTriangle className="w-3 h-3" />}
            {status.label}
          </span>
        </div>
        <div className="text-xs text-stone-500 mt-0.5 flex flex-wrap gap-x-3">
          <span>{PROVIDER_LABEL[account.provider]}</span>
          {account.last_sync_at && (
            <span>Last sync: {formatRelative(account.last_sync_at)}</span>
          )}
          {account.status === 'error' && account.last_error && (
            <span className="text-amber-700 truncate max-w-md">{account.last_error}</span>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        {account.status === 'error' ? (
          <button
            type="button"
            onClick={() => onConnect(account.provider)}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 btn-press"
          >
            <RefreshCw className="w-4 h-4" />
            Reconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onTogglePause(account)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60 btn-press"
          >
            {account.status === 'active' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            {account.status === 'active' ? 'Pause' : 'Resume'}
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * Lightweight relative-time formatter. Avoids a date library dependency.
 * Shown to operators in the admin UI; precision beyond "minutes ago" is
 * not load-bearing.
 */
export function formatRelative(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const deltaSec = Math.round((nowMs - t) / 1000)
  if (deltaSec < 60) return 'just now'
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} min ago`
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)} h ago`
  return `${Math.round(deltaSec / 86_400)} d ago`
}

export default EmailAccountsTab
