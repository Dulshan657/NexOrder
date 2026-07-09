// Settings-specific layout: section headings, the sub-tab button, and the per-tab
// SaveBar.
//
// The field primitives now live in `components/ui` so modals share them; they are
// re-exported here under their original names so existing importers are untouched.

import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

export {
  Field as SettingsField,
  Input as TextInput,
  NumberInput,
  Select as SelectInput,
  Toggle,
} from '../../ui'
export type { FieldProps as SettingsFieldProps, ToggleProps } from '../../ui'

// ── Section / field layout ────────────────────────────────────────

interface SettingsSectionProps {
  title: string
  description?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}

/** Heading block for a group of related settings. Tabs stack these in a
 *  `max-w-3xl` column separated by `divide-y divide-stone-200`. */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  icon,
  actions,
  children,
}) => (
  <section className="py-6 first:pt-0 last:pb-0">
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <div className="flex items-center gap-2">
          {icon && <span className="text-stone-500">{icon}</span>}
          <h3 className="text-base font-display font-semibold text-stone-900">{title}</h3>
        </div>
        {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
)

// ── Sub-tab button (moved verbatim from POInboxView) ──────────────

interface SubtabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

export const SubtabButton: React.FC<SubtabButtonProps> = ({ active, onClick, children }) => (
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

// ── SaveBar ───────────────────────────────────────────────────────

interface SaveBarProps {
  isDirty: boolean
  isSaving: boolean
  /** Disables saving and explains why, instead of a silent no-op click. */
  hasErrors?: boolean
  /** May return a promise — the bar shows its spinner until it settles. */
  onSave: () => void | Promise<void>
  onDiscard: () => void
  /** Optional extra status text next to the buttons (e.g. "2 customers modified"). */
  status?: string
}

/** Per-tab save row: disabled until dirty, spinner while saving, 2s emerald
 *  "Saved" flash after a successful save, plus a Discard text button. */
export const SaveBar: React.FC<SaveBarProps> = ({
  isDirty,
  isSaving,
  hasErrors,
  onSave,
  onDiscard,
  status,
}) => {
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const effectiveSaving = isSaving || busy
  const wasSaving = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flash "Saved" when a save finishes and the tab came out clean. A failed
  // save leaves the tab dirty, so no false-positive flash.
  useEffect(() => {
    if (wasSaving.current && !effectiveSaving && !isDirty) {
      setJustSaved(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setJustSaved(false), 2000)
    }
    wasSaving.current = effectiveSaving
  }, [effectiveSaving, isDirty])

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [],
  )

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onSave()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 pt-5 mt-2 border-t border-stone-200">
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={!isDirty || effectiveSaving || hasErrors}
        className={`inline-flex items-center gap-2 font-medium py-2 px-5 rounded-lg text-sm shadow-sm transition-colors btn-press ${
          justSaved && !isDirty
            ? 'bg-emerald-600 text-white'
            : 'bg-stone-900 hover:bg-stone-800 text-white disabled:opacity-50 disabled:cursor-not-allowed'
        }`}
      >
        {effectiveSaving && <Loader2 className="w-4 h-4 animate-spin" />}
        {effectiveSaving ? 'Saving…' : justSaved && !isDirty ? 'Saved' : 'Save changes'}
      </button>
      {isDirty && !effectiveSaving && (
        <button
          type="button"
          onClick={onDiscard}
          className="text-sm font-medium text-stone-500 hover:text-stone-800 transition-colors"
        >
          Discard
        </button>
      )}
      {hasErrors && isDirty && (
        <span className="text-xs text-amber-600" role="alert">
          Fix the highlighted fields to save.
        </span>
      )}
      {status && <span className="text-xs text-stone-500">{status}</span>}
    </div>
  )
}
