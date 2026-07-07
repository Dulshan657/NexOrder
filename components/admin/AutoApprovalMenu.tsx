// AutoApprovalMenu — admin-only header button + popover for the PO Inbox
// auto-approval policy (app_settings, mig 00044). Three toggles, all default on:
//   * po_auto_approve_enabled                  — master switch
//   * po_auto_approve_block_on_short_stock      — hold short-stock POs for review
//   * po_auto_approve_block_on_sender_mismatch  — hold spoofed-sender POs for review
//
// Mirrors MailboxesMenu's popover pattern (relative root + ref, click-outside +
// Escape, po-pop-in panel). Reads the raw settings row via useSettings() and
// writes snake_case patches via useUpdateSettings(); mutate-app-settings is
// Admin-only, so the whole control is gated on useAuth().isAdmin.

import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSettings, useUpdateSettings } from '@/hooks/queries/useSettings'

interface AutoApprovalMenuProps {
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
}

type PolicyKey =
  | 'po_auto_approve_enabled'
  | 'po_auto_approve_block_on_short_stock'
  | 'po_auto_approve_block_on_sender_mismatch'

interface PolicyToggle {
  key: PolicyKey
  label: string
  help: string
  /** Sub-policies only matter while the master switch is on. */
  sub?: boolean
}

const TOGGLES: readonly PolicyToggle[] = [
  {
    key: 'po_auto_approve_enabled',
    label: 'Auto-approve matching orders',
    help: 'Trusted sender, all items matched and high confidence → approved automatically.',
  },
  {
    key: 'po_auto_approve_block_on_short_stock',
    label: 'Hold for review when stock is short',
    help: "A PO that can't be fully filled from current inventory waits for a human.",
    sub: true,
  },
  {
    key: 'po_auto_approve_block_on_sender_mismatch',
    label: 'Hold for review on possible sender spoofing',
    help: 'A PO whose sender is not a known address for the customer waits for a human.',
    sub: true,
  },
]

const AutoApprovalMenu: React.FC<AutoApprovalMenuProps> = ({ addToast }) => {
  const { isAdmin } = useAuth()
  const settingsQuery = useSettings()
  const updateMutation = useUpdateSettings()

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on click-outside + Escape (matches MailboxesMenu).
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // mutate-app-settings is Admin-only; hide the control for everyone else.
  if (!isAdmin) return null

  const settings = settingsQuery.data
  // Absent column ⇒ default on (matches the server's fail-open behaviour).
  const valueOf = (key: PolicyKey): boolean =>
    (settings as Record<string, unknown> | undefined)?.[key] !== false
  const masterOn = valueOf('po_auto_approve_enabled')

  async function toggle(t: PolicyToggle) {
    const next = !valueOf(t.key)
    try {
      await updateMutation.mutateAsync({ [t.key]: next })
      addToast?.(`${t.label} ${next ? 'on' : 'off'}.`, 'success')
    } catch (err) {
      addToast?.(
        `Couldn't update setting: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error',
      )
    }
  }

  const saving = updateMutation.isPending
  const loaded = !!settings

  return (
    <div className="relative pb-1.5" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 text-sm font-medium rounded-lg border px-3 py-1.5 transition-colors btn-press bg-white border-stone-200 text-stone-800 hover:bg-stone-50"
      >
        <ShieldCheck className="w-4 h-4 text-stone-500" />
        Auto-approval
        <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Auto-approval policy"
          className="po-pop-in absolute right-0 top-[calc(100%+6px)] z-30 w-[340px] max-w-[calc(100vw-1rem)] rounded-xl border border-stone-200 bg-white shadow-elevated overflow-hidden
                     max-sm:fixed max-sm:inset-x-2 max-sm:right-2 max-sm:top-auto max-sm:w-auto"
        >
          <div className="px-4 py-3 border-b border-stone-200/70">
            <p className="font-semibold text-sm text-stone-900">Auto-approval policy</p>
            <p className="mt-0.5 text-[12px] text-stone-500">
              Controls which inbound POs are approved automatically vs held for review.
            </p>
          </div>

          <div className="px-4 py-3 space-y-3">
            {!loaded && (
              <p className="flex items-center gap-2 text-sm text-stone-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </p>
            )}
            {loaded &&
              TOGGLES.map(t => {
                const disabled = saving || (t.sub && !masterOn)
                return (
                  <label
                    key={t.key}
                    className={`flex items-start gap-2.5 ${t.sub ? 'pl-3' : ''} ${
                      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={valueOf(t.key)}
                      disabled={disabled}
                      onChange={() => toggle(t)}
                      className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-600 disabled:cursor-not-allowed"
                    />
                    <span>
                      <span className="block text-sm text-stone-800">{t.label}</span>
                      <span className="block text-[12px] leading-snug text-stone-500">{t.help}</span>
                    </span>
                  </label>
                )
              })}
            {loaded && !masterOn && (
              <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                Auto-approval is off — every PO is held for review.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default AutoApprovalMenu
