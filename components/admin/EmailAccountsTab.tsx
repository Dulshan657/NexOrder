// EmailAccountsTab — admin page for connecting Gmail / Outlook mailboxes
// that the PO Inbox poller scans for inbound purchase orders.
//
// Admin and Manager can connect, pause/resume, reconnect, and sign out.
// Pause/Resume stops polling temporarily (status='paused'). Sign out is
// permanent: it revokes the OAuth grant at the provider (Gmail only —
// Microsoft has no programmatic revoke), clears the local refresh token,
// and removes the row from this list. Historical inbound_messages /
// pending_pos / orders remain linked to the (now hidden) row so the audit
// trail survives.

import React, { useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Mail,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Link as LinkIcon,
  LogOut,
} from 'lucide-react'
import {
  useDisconnectEmailAccount,
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

const STATUS_DOT: Record<EmailAccountStatus, { label: string; dot: string; text: string }> = {
  active: { label: 'Active', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  paused: { label: 'Paused', dot: 'bg-stone-400', text: 'text-stone-500' },
  error: { label: 'Needs reconnect', dot: 'bg-amber-500', text: 'text-amber-700' },
  // signed_out rows are filtered out of the list query, so this entry
  // never actually renders — but keeping the union exhaustive prevents
  // a TS narrowing error and makes the intent clear.
  signed_out: { label: 'Signed out', dot: 'bg-stone-300', text: 'text-stone-400' },
}

const EmailAccountsTab: React.FC<EmailAccountsTabProps> = ({ addToast }) => {
  const accountsQuery = useEmailAccounts()
  const startOAuth = useStartOAuthFlow()
  const pauseMutation = usePauseEmailAccount()
  const disconnectMutation = useDisconnectEmailAccount()
  const [connecting, setConnecting] = useState<EmailAccountProvider | null>(null)
  // When non-null, the SignOutConfirmDialog is shown for this account.
  const [signOutTarget, setSignOutTarget] = useState<EmailAccountRow | null>(null)

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

      // Open the OAuth flow in a popup so the parent tab keeps its
      // in-memory NexOrder session. Without this, the redirect chain
      // (provider → Supabase callback → /admin/email-accounts) lands
      // back inside this tab and the persistSession:false config in
      // lib/supabase.ts means the operator gets the LoginPage instead
      // of their dashboard. index.tsx detects "I'm in a popup that just
      // finished OAuth" and posts the result back to us.
      const popup = window.open(
        authorizeUrl,
        'nexorder-po-oauth',
        'width=520,height=720,popup=yes,noopener=no',
      )
      if (!popup) {
        // Popup blocked. Fall back to full-tab navigation — the operator
        // will be re-logged-in but the OAuth round-trip still completes.
        addToast?.(
          'Popup was blocked — opening the connect flow in this tab instead. You will be asked to sign in again after connecting.',
          'info',
        )
        window.location.href = authorizeUrl
        return
      }

      // Listen for the success/failure message from the popup. We must
      // origin-check every message because anything on the page can
      // post arbitrary data here.
      const expectedOrigin = window.location.origin
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) return
        const data = event.data as
          | { type?: string; connected?: boolean; error?: string | null; message?: string | null }
          | null
        if (!data || data.type !== 'nexorder-oauth-complete') return
        cleanup()
        if (data.connected) {
          addToast?.('Mailbox connected. The first sync will run within a minute.', 'success')
          accountsQuery.refetch()
        } else if (data.error) {
          addToast?.(`Connect failed (${data.error}): ${data.message ?? data.error}`, 'error')
        }
      }

      // If the operator closes the popup without completing OAuth we
      // need to release the busy spinner. Poll until the popup is gone,
      // and also bound the wait at 5 minutes so a forgotten popup
      // doesn't pin the interval handler forever.
      const startedAt = Date.now()
      const closedPoll = window.setInterval(() => {
        if (popup.closed) {
          cleanup()
          return
        }
        if (Date.now() - startedAt > 5 * 60_000) {
          cleanup()
        }
      }, 800)

      function cleanup() {
        window.removeEventListener('message', handleMessage)
        window.clearInterval(closedPoll)
        setConnecting(null)
      }
      window.addEventListener('message', handleMessage)
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

  async function handleSignOutConfirm(account: EmailAccountRow): Promise<void> {
    try {
      const result = await disconnectMutation.mutateAsync(account.id)
      addToast?.(`Signed out of ${account.email_address}.`, 'success')
      if (result.manualRevokeUrl) {
        // Outlook only — Microsoft can't be revoked programmatically.
        addToast?.(
          `To fully revoke at Microsoft, visit ${result.manualRevokeUrl} and remove NexOrder's access.`,
          'info',
        )
      }
      setSignOutTarget(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Sign out failed: ${message}`, 'error')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-2 pb-4 border-b border-stone-200/70">
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

      {accountsQuery.isLoading ? (
        <div className="py-10 flex items-center justify-center text-stone-500">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading connected mailboxes…
        </div>
      ) : sortedAccounts.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-stone-200/70">
          {sortedAccounts.map(account => (
            <AccountRow
              key={account.id}
              account={account}
              onConnect={handleConnect}
              onTogglePause={handlePauseToggle}
              onSignOut={setSignOutTarget}
              busy={pauseMutation.isPending}
            />
          ))}
        </ul>
      )}

      {signOutTarget && (
        <SignOutConfirmDialog
          account={signOutTarget}
          submitting={disconnectMutation.isPending}
          onCancel={() => setSignOutTarget(null)}
          onConfirm={() => handleSignOutConfirm(signOutTarget)}
        />
      )}
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
    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-stone-700 hover:text-stone-900 disabled:opacity-60 disabled:cursor-not-allowed btn-press"
  >
    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
    Connect {PROVIDER_LABEL[provider].split(' / ')[0]}
  </button>
)

const EmptyState: React.FC = () => (
  <div className="py-16 text-center">
    <Mail className="w-8 h-8 mx-auto text-stone-300" />
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
  onSignOut: (account: EmailAccountRow) => void
  busy: boolean
}

const AccountRow: React.FC<AccountRowProps> = ({ account, onConnect, onTogglePause, onSignOut, busy }) => {
  const status = STATUS_DOT[account.status]
  return (
    <li className="py-3 flex items-center gap-4 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-medium text-stone-900 truncate">{account.email_address}</span>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden />
            <span className={status.text}>{status.label}</span>
          </span>
        </div>
        <div className="text-xs text-stone-500 mt-0.5 flex flex-wrap gap-x-3">
          <span>{PROVIDER_LABEL[account.provider]}</span>
          {account.last_sync_at && (
            <>
              <span aria-hidden>·</span>
              <span>Last sync {formatRelative(account.last_sync_at)}</span>
            </>
          )}
          {account.status === 'error' && account.last_error && (
            <>
              <span aria-hidden>·</span>
              <span className="text-amber-700 truncate max-w-md">{account.last_error}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        {account.status === 'error' ? (
          <button
            type="button"
            onClick={() => onConnect(account.provider)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-amber-800 hover:bg-amber-50 rounded-md btn-press"
          >
            <RefreshCw className="w-4 h-4" />
            Reconnect
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onTogglePause(account)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-md disabled:opacity-60 btn-press"
            >
              {account.status === 'active' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
              {account.status === 'active' ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => onSignOut(account)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-stone-600 hover:text-rose-700 hover:bg-rose-50 rounded-md btn-press"
              aria-label={`Sign out of ${account.email_address}`}
              title="Sign out — revokes access at the provider and removes this mailbox"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </>
        )}
      </div>
    </li>
  )
}

interface SignOutConfirmDialogProps {
  account: EmailAccountRow
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}

const SignOutConfirmDialog: React.FC<SignOutConfirmDialogProps> = ({
  account,
  submitting,
  onCancel,
  onConfirm,
}) => {
  const isGmail = account.provider === 'gmail'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signout-dialog-title"
      onClick={onCancel}
      onKeyDown={e => {
        if (e.key === 'Escape' && !submitting) onCancel()
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 id="signout-dialog-title" className="font-display font-semibold text-stone-900">
            Sign out of {account.email_address}?
          </h3>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm text-stone-700">
          {isGmail ? (
            <p>
              We'll revoke this app's access at Google and clear the stored token. Existing
              purchase orders from this mailbox stay in your audit history.
            </p>
          ) : (
            <>
              <p>We'll clear the stored token so this mailbox stops syncing immediately.</p>
              <p className="text-stone-600">
                Microsoft doesn't support automatic revoke — to fully remove access at Microsoft,
                visit{' '}
                <a
                  href="https://account.live.com/consent/Manage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-stone-900"
                >
                  account.live.com/consent/Manage
                </a>{' '}
                after signing out here.
              </p>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-200 rounded-md disabled:opacity-60 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-60 btn-press"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign out
          </button>
        </div>
      </div>
    </div>
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
