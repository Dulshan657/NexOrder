// MailboxHealthBanner — slim 1-line strip surfacing paused / errored
// mailboxes regardless of which PO Inbox sub-tab the admin is on. Renders
// nothing when every connected account is healthy.

import React from 'react'
import { AlertTriangle, PauseCircle } from 'lucide-react'
import { useEmailAccounts } from '@/hooks/queries/useEmailAccounts'

interface MailboxHealthBannerProps {
  onGoToMailboxes: () => void
}

const MailboxHealthBanner: React.FC<MailboxHealthBannerProps> = ({ onGoToMailboxes }) => {
  const { data } = useEmailAccounts()
  const accounts = data ?? []
  const errored = accounts.filter(a => a.status === 'error')
  const paused = accounts.filter(a => a.status === 'paused')
  if (errored.length === 0 && paused.length === 0) return null

  const isError = errored.length > 0
  const message = isError
    ? buildSummary(errored, 'mailbox needs reconnecting', 'mailboxes need reconnecting')
    : buildSummary(paused, 'mailbox paused', 'mailboxes paused')

  return (
    <div
      role="status"
      className={`mt-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 text-sm border-y ${
        isError
          ? 'bg-amber-50/70 border-amber-200/70 text-amber-900'
          : 'bg-stone-50 border-stone-200/70 text-stone-700'
      }`}
    >
      {isError ? (
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden />
      ) : (
        <PauseCircle className="w-4 h-4 shrink-0 text-stone-500" aria-hidden />
      )}
      <p className="flex-1 truncate">{message}</p>
      <button
        type="button"
        onClick={onGoToMailboxes}
        className="text-sm font-medium underline underline-offset-4 hover:opacity-80 btn-press shrink-0"
      >
        {isError ? 'Reconnect' : 'Open Mailboxes'}
      </button>
    </div>
  )
}

function buildSummary(
  list: Array<{ email_address: string }>,
  singular: string,
  plural: string,
): string {
  if (list.length === 1) {
    return `1 ${singular} — ${list[0].email_address}`
  }
  // Show first email + count when there's more than one.
  return `${list.length} ${plural} — ${list[0].email_address} and ${list.length - 1} other${list.length - 1 === 1 ? '' : 's'}`
}

export default MailboxHealthBanner
