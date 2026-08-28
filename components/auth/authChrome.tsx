import React from 'react'
import { ArrowRight, AlertTriangle, Check } from 'lucide-react'

// Shared presentational chrome for the three pre-auth surfaces — LoginPage,
// ForgotPasswordDialog and ResetPasswordView — which had drifted into three
// near-identical copies of the same input, label, alert and submit-button class
// strings.
//
// Deliberately NOT built on `components/ui/Field.tsx`. That primitive carries the
// dense admin vocabulary (`text-sm font-medium` label, `px-3 py-2`, ring at /40),
// while the pre-auth pages are a larger, more editorial treatment (`px-4 py-3`,
// mono uppercase labels). Folding one into the other would flatten a distinction
// that is doing real work — these are the only screens a signed-out prospect sees.
//
// One eyebrow scale is used throughout. LoginPage previously ran two for the same
// job (11px/0.24em on section eyebrows, 10px/0.18em on field labels).

/** Decelerating ease shared by every transition on the auth surfaces. */
export const AUTH_EASING = 'cubic-bezier(0.16,1,0.3,1)'

/** The single label/eyebrow scale. Callers add their own colour. */
export const EYEBROW_CLASS = 'font-mono text-[10px] uppercase tracking-[0.18em]'

const INPUT_CLASS =
  'w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 ' +
  'placeholder:text-stone-500 ' +
  'focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/25 ' +
  'disabled:bg-stone-100 disabled:text-stone-400 ' +
  'transition-[border-color,box-shadow,background-color] duration-300'

/**
 * Staggered page-load entrance. Returns the inline custom property `.auth-in`
 * reads for its delay (see `index.css`), so callers pass an index rather than
 * hand-writing a delay. Disabled wholesale under `prefers-reduced-motion`.
 */
export function authStagger(index: number): React.CSSProperties {
  return { ['--auth-i' as string]: index } as React.CSSProperties
}

export interface AuthEyebrowProps {
  children: React.ReactNode
  className?: string
}

/** Small mono kicker above a heading. Defaults to the light-surface colour. */
export function AuthEyebrow({ children, className = 'text-stone-500' }: AuthEyebrowProps) {
  return <p className={`${EYEBROW_CLASS} ${className}`}>{children}</p>
}

export interface AuthFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  /** Optional control rendered opposite the label — e.g. "Forgot your password?". */
  action?: React.ReactNode
  type?: string
  placeholder?: string
  autoComplete?: string
  disabled?: boolean
  required?: boolean
  minLength?: number
  autoFocus?: boolean
}

/** Mono uppercase label above a full-width input, with an optional trailing action. */
export function AuthField({
  id,
  label,
  value,
  onChange,
  action,
  type = 'text',
  placeholder,
  autoComplete,
  disabled = false,
  required = false,
  minLength,
  autoFocus = false,
}: AuthFieldProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={`${EYEBROW_CLASS} text-stone-600`}>
          {label}
        </label>
        {action}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        style={{ transitionTimingFunction: AUTH_EASING }}
        className={INPUT_CLASS}
      />
    </div>
  )
}

export interface AuthSubmitProps {
  children: React.ReactNode
  disabled?: boolean
  /** Renders as a plain button rather than a submit — for "Back to sign in" etc. */
  type?: 'submit' | 'button'
  onClick?: () => void
  className?: string
}

/** Full-width primary action. The arrow nudges on hover and holds still when disabled. */
export function AuthSubmit({
  children,
  disabled = false,
  type = 'submit',
  onClick,
  className = '',
}: AuthSubmitProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ transitionTimingFunction: AUTH_EASING }}
      className={
        'group inline-flex w-full items-center justify-between gap-3 rounded-lg ' +
        'bg-nexgen-blue px-5 py-3 text-sm font-semibold text-white ' +
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ' +
        'hover:bg-nexgen-blue-dark active:translate-y-[1px] ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue ' +
        'focus-visible:ring-offset-2 ' +
        'disabled:cursor-not-allowed disabled:opacity-40 ' +
        'transition-[background-color,transform,opacity] duration-300 ' +
        className
      }
    >
      <span>{children}</span>
      <ArrowRight
        className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-disabled:translate-x-0"
        strokeWidth={2}
      />
    </button>
  )
}

export interface AuthAlertProps {
  tone: 'error' | 'success'
  children: React.ReactNode
}

/**
 * The status box repeated across all three surfaces. `error` carries `role="alert"`
 * so failures are announced; `success` does not, because it accompanies a heading
 * change that already moves focus context.
 */
export function AuthAlert({ tone, children }: AuthAlertProps) {
  const isError = tone === 'error'
  const Icon = isError ? AlertTriangle : Check

  return (
    <div
      role={isError ? 'alert' : undefined}
      className={
        'flex items-start gap-3 rounded-lg border px-4 py-3 ' +
        (isError ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50')
      }
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${isError ? 'text-rose-600' : 'text-emerald-600'}`}
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className={`text-sm leading-relaxed ${isError ? 'text-rose-800' : 'text-emerald-900'}`}>
        {children}
      </div>
    </div>
  )
}
