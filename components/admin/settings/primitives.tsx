// Shared form primitives for the Settings tabs. One place for the input class
// string, section/field layout, toggle switch, sub-tab button, and per-tab
// SaveBar so tabs stay small and visually consistent.

import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

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

interface SettingsFieldProps {
  label: string
  htmlFor?: string
  helper?: string
  error?: string
  children: React.ReactNode
}

/** Label above the control, helper or error text below. */
export const SettingsField: React.FC<SettingsFieldProps> = ({
  label,
  htmlFor,
  helper,
  error,
  children,
}) => (
  <div>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-700 mb-1">
      {label}
    </label>
    {children}
    {error ? (
      <p className="text-xs text-red-600 mt-1" role="alert">
        {error}
      </p>
    ) : helper ? (
      <p className="text-xs text-stone-400 mt-1">{helper}</p>
    ) : null}
  </div>
)

// ── Inputs ────────────────────────────────────────────────────────

const inputClass = (invalid?: boolean, dense?: boolean) =>
  `w-full ${dense ? 'px-2.5 py-1.5 rounded-md' : 'px-3 py-2 rounded-lg'} border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 focus:border-nexgen-blue ${
    invalid ? 'border-red-300' : 'border-stone-300'
  }`

/** `dense` = compact table-cell variant. Constrain width by wrapping in a
 *  fixed-width container (inputs are always `w-full`). */
type InputExtras = { invalid?: boolean; dense?: boolean }

export const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & InputExtras> = ({
  invalid,
  dense,
  className,
  ...rest
}) => <input type="text" {...rest} className={`${inputClass(invalid, dense)} ${className ?? ''}`} />

export const NumberInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & InputExtras> = ({
  invalid,
  dense,
  className,
  ...rest
}) => <input type="number" {...rest} className={`${inputClass(invalid, dense)} ${className ?? ''}`} />

export const SelectInput: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & InputExtras> = ({
  invalid,
  dense,
  className,
  children,
  ...rest
}) => (
  <select {...rest} className={`${inputClass(invalid, dense)} ${className ?? ''}`}>
    {children}
  </select>
)

// ── Toggle ────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  description?: string
}

/** Accessible switch: real button with role="switch", nexgen-blue on-state. */
export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, label, description }) => (
  <div className={`flex items-start gap-3 ${disabled ? 'opacity-50' : ''}`}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors btn-press focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 ${
        checked ? 'bg-nexgen-blue' : 'bg-stone-300'
      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
    <div className="min-w-0">
      <span className="block text-sm font-medium text-stone-700">{label}</span>
      {description && <span className="block text-xs text-stone-400 leading-snug">{description}</span>}
    </div>
  </div>
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
