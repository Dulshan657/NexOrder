// MailboxesMenu — header button + popover for connecting and managing the
// Gmail / Outlook mailboxes the PO Inbox poller scans. Replaces the former
// Mailboxes sub-tab (EmailAccountsTab). All data hooks and the OAuth popup
// handshake are unchanged — only the presentation moved into a popover.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Mail,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Link as LinkIcon,
  LogOut,
  MoreHorizontal,
  ChevronDown,
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
import { formatRelative, summarizeMailboxHealth } from './emailAccountFormat'

interface MailboxesMenuProps {
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /** Bumped by POInboxView after an OAuth callback to auto-open the popover. */
  autoOpenNonce?: number
}

const PROVIDER_LABEL: Record<EmailAccountProvider, string> = {
  gmail: 'Gmail / Google Workspace',
  outlook: 'Microsoft 365 / Outlook',
}

const STATUS_DOT: Record<EmailAccountStatus, { label: string; dot: string; text: string }> = {
  active: { label: 'Active', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  paused: { label: 'Paused', dot: 'bg-stone-400', text: 'text-stone-500' },
  error: { label: 'Needs reconnect', dot: 'bg-amber-500', text: 'text-amber-700' },
  signed_out: { label: 'Signed out', dot: 'bg-stone-300', text: 'text-stone-400' },
}

const HEALTH_DOT: Record<'ok' | 'paused' | 'error', string> = {
  ok: 'bg-emerald-500',
  paused: 'bg-stone-400',
  error: 'bg-amber-500',
}

const MailboxesMenu: React.FC<MailboxesMenuProps> = ({ addToast, autoOpenNonce }) => {
  const accountsQuery = useEmailAccounts()
  const startOAuth = useStartOAuthFlow()
  const pauseMutation = usePauseEmailAccount()
  const disconnectMutation = useDisconnectEmailAccount()

  const [open, setOpen] = useState(false)
  const [connecting, setConnecting] = useState<EmailAccountProvider | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [signOutTarget, setSignOutTarget] = useState<EmailAccountRow | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const accounts = accountsQuery.data ?? []
  const health = summarizeMailboxHealth(accounts)
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        if (a.status === 'error' && b.status !== 'error') return -1
        if (b.status === 'error' && a.status !== 'error') return 1
        return a.email_address.localeCompare(b.email_address)
      }),
    [accounts],
  )

  // Parent (POInboxView) bumps autoOpenNonce after an OAuth callback.
  useEffect(() => {
    if (autoOpenNonce && autoOpenNonce > 0) setOpen(true)
  }, [autoOpenNonce])

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setMenuFor(null)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setMenuFor(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleConnect(provider: EmailAccountProvider) {
    try {
      setConnecting(provider)
      const { authorizeUrl } = await startOAuth.mutateAsync(provider)
      const popup = window.open(authorizeUrl, 'nexorder-po-oauth', 'width=520,height=720,popup=yes')
      if (!popup) {
        addToast?.(
          'Popup was blocked — opening the connect flow in this tab instead. You will be asked to sign in again after connecting.',
          'info',
        )
        window.location.href = authorizeUrl
        return
      }

      const expectedOrigin = window.location.origin
      type OAuthCompleteMessage = {
        type?: string
        connected?: boolean
        error?: string | null
        message?: string | null
      }
      const onCompleteMsg = (data: OAuthCompleteMessage) => {
        if (!data || data.type !== 'nexorder-oauth-complete') return
        cleanup()
        if (data.connected) {
          addToast?.('Mailbox connected. The first sync will run within a minute.', 'success')
          accountsQuery.refetch()
        } else if (data.error) {
          addToast?.(`Connect failed (${data.error}): ${data.message ?? data.error}`, 'error')
        }
      }

      let channel: BroadcastChannel | null = null
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('nexorder-oauth')
        channel.addEventListener('message', e => onCompleteMsg(e.data as OAuthCompleteMessage))
      }
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) return
        onCompleteMsg(event.data as OAuthCompleteMessage)
      }
      window.addEventListener('message', handleMessage)

      const startedAt = Date.now()
      const closedPoll = window.setInterval(() => {
        if (popup.closed) {
          cleanup()
          return
        }
        if (Date.now() - startedAt > 5 * 60_000) cleanup()
      }, 800)

      function cleanup() {
        window.removeEventListener('message', handleMessage)
        window.clearInterval(closedPoll)
        if (channel) {
          channel.close()
          channel = null
        }
        setConnecting(null)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Could not start OAuth flow: ${message}`, 'error')
      setConnecting(null)
    }
  }

  async function handlePauseToggle(account: EmailAccountRow) {
    setMenuFor(null)
    if (account.status === 'error') {
      addToast?.('This account needs reconnecting — Pause/Resume will not recover it. Use Reconnect.', 'info')
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

  const errored = health.tone === 'error'

  return (
    <div className="relative pb-1.5" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 text-sm font-medium rounded-lg border px-3 py-1.5 transition-colors btn-press ${
          errored
            ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
            : 'bg-white border-stone-200 text-stone-800 hover:bg-stone-50'
        }`}
      >
        <Mail className="w-4 h-4 text-stone-500" />
        Mailboxes
        {health.count > 0 && <span className="font-mono text-[11px] text-stone-500">{health.count}</span>}
        <span
          className={`w-1.5 h-1.5 rounded-full ${HEALTH_DOT[health.tone]}`}
          title={
            health.tone === 'error'
              ? `${health.erroredCount} mailbox${health.erroredCount === 1 ? '' : 'es'} need reconnecting`
              : health.tone === 'paused'
                ? `${health.pausedCount} paused`
                : 'All mailboxes healthy'
          }
        />
        <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connected mailboxes"
          className="po-pop-in absolute right-0 top-[calc(100%+6px)] z-30 w-[380px] max-w-[calc(100vw-1rem)] rounded-xl border border-stone-200 bg-white shadow-elevated overflow-hidden
                     max-sm:fixed max-sm:inset-x-2 max-sm:right-2 max-sm:top-auto max-sm:w-auto"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/70">
            <span className="font-semibold text-sm text-stone-900">Connected mailboxes</span>
            <span className="font-mono text-[11px] text-stone-400">{health.count}</span>
          </div>

          {accountsQuery.isLoading ? (
            <MailboxSkeleton />
          ) : sortedAccounts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Mail className="w-7 h-7 mx-auto text-stone-300" />
              <p className="mt-2 text-sm text-stone-600">No mailboxes connected yet.</p>
            </div>
          ) : (
            <ul
              className="max-h-80 overflow-auto divide-y divide-stone-200/60"
              onClick={() => setMenuFor(null)}
            >
              {sortedAccounts.map(account => (
                <AccountRow
                  key={account.id}
                  account={account}
                  menuOpen={menuFor === account.id}
                  onToggleMenu={() => setMenuFor(id => (id === account.id ? null : account.id))}
                  onConnect={handleConnect}
                  onTogglePause={handlePauseToggle}
                  onSignOut={a => {
                    setMenuFor(null)
                    setSignOutTarget(a)
                  }}
                  busy={pauseMutation.isPending}
                />
              ))}
            </ul>
          )}

          <div className="flex gap-2 px-4 py-3 border-t border-stone-200/70 bg-stone-50">
            <ConnectButton provider="gmail" busy={connecting === 'gmail'} disabled={startOAuth.isPending && connecting !== 'gmail'} onClick={handleConnect} />
            <ConnectButton provider="outlook" busy={connecting === 'outlook'} disabled={startOAuth.isPending && connecting !== 'outlook'} onClick={handleConnect} />
          </div>
        </div>
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

const MailboxSkeleton: React.FC = () => (
  <ul className="divide-y divide-stone-200/60">
    {Array.from({ length: 2 }).map((_, i) => (
      <li key={`mbx-skel-${i}`} className="flex items-center gap-3 px-4 py-3">
        <div className="po-skeleton" style={{ width: 8, height: 8, borderRadius: 999 }} />
        <div className="flex-1">
          <div className="po-skeleton" style={{ width: '60%', height: 11 }} />
          <div className="po-skeleton mt-2" style={{ width: '40%', height: 9 }} />
        </div>
      </li>
    ))}
  </ul>
)

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
    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-nexgen-blue border border-nexgen-blue/25 bg-white rounded-lg hover:bg-nexgen-blue/5 disabled:opacity-60 disabled:cursor-not-allowed btn-press"
  >
    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
    Connect {PROVIDER_LABEL[provider].split(' / ')[0]}
  </button>
)

interface AccountRowProps {
  account: EmailAccountRow
  menuOpen: boolean
  onToggleMenu: () => void
  onConnect: (p: EmailAccountProvider) => void
  onTogglePause: (account: EmailAccountRow) => void
  onSignOut: (account: EmailAccountRow) => void
  busy: boolean
}

const AccountRow: React.FC<AccountRowProps> = ({
  account,
  menuOpen,
  onToggleMenu,
  onConnect,
  onTogglePause,
  onSignOut,
  busy,
}) => {
  const reconnecting = account.status === 'active' && account.consecutive_failures > 0
  const status = reconnecting
    ? {
        label: account.consecutive_failures > 1 ? `Reconnecting (${account.consecutive_failures})` : 'Reconnecting…',
        dot: 'bg-amber-400 animate-pulse',
        text: 'text-amber-600',
      }
    : STATUS_DOT[account.status]

  return (
    <li className="relative flex items-center gap-3 px-4 py-3">
      <span className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-stone-900 truncate">{account.email_address}</div>
        <div className="text-[11px] text-stone-500 truncate">
          {PROVIDER_LABEL[account.provider].split(' / ')[0]} · {status.label}
          {account.last_sync_at && account.status === 'active' && !reconnecting && (
            <> · synced {formatRelative(account.last_sync_at)}</>
          )}
          {(account.status === 'error' || reconnecting) && account.last_error && (
            <> · <span className="text-amber-700">{account.last_error}</span></>
          )}
        </div>
      </div>

      {account.status === 'error' ? (
        <button
          type="button"
          onClick={() => onConnect(account.provider)}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg btn-press"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onToggleMenu()
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Actions for ${account.email_address}`}
          className="shrink-0 p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 btn-press"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}

      {menuOpen && account.status !== 'error' && (
        <div
          role="menu"
          className="po-pop-in absolute right-3 top-[calc(100%-6px)] z-10 w-40 rounded-lg border border-stone-200 bg-white shadow-elevated overflow-hidden"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => onTogglePause(account)}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            {account.status === 'active' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            {account.status === 'active' ? 'Pause' : 'Resume'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onSignOut(account)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 border-t border-stone-200/70"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </li>
  )
}

interface SignOutConfirmDialogProps {
  account: EmailAccountRow
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}

const SignOutConfirmDialog: React.FC<SignOutConfirmDialogProps> = ({ account, submitting, onCancel, onConfirm }) => {
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
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 id="signout-dialog-title" className="font-display font-semibold text-stone-900">
            Sign out of {account.email_address}?
          </h3>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm text-stone-700">
          {isGmail ? (
            <p>
              We'll revoke this app's access at Google and clear the stored token. Existing purchase orders from this
              mailbox stay in your audit history.
            </p>
          ) : (
            <>
              <p>We'll clear the stored token so this mailbox stops syncing immediately.</p>
              <p className="text-stone-600">
                Microsoft doesn't support automatic revoke — to fully remove access at Microsoft, visit{' '}
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

export default MailboxesMenu
