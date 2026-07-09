// Moved verbatim from `admin/settings/primitives.tsx` — it was already a correct
// `role="switch"` implementation, it just lived somewhere modals couldn't reach.

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  description?: string
}

export function Toggle({ checked, onChange, disabled, label, description }: ToggleProps) {
  return (
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
}
