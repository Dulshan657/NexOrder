import React from 'react'
import { Loader2 } from 'lucide-react'

// One button. Replaces three primary colours (stone-900 / nexgen-blue / emerald-600),
// three padding scales and two disabled opacities that had drifted across the app.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap ' +
  'transition-colors btn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-nexgen-blue text-white hover:bg-nexgen-blue-dark',
  secondary: 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50',
  ghost: 'text-stone-600 hover:bg-stone-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

// An intersection rather than `interface extends`: this repo ships no `@types/react`,
// so `React.ButtonHTMLAttributes` resolves to `any` and an interface cannot extend it.
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and blocks interaction. */
  loading?: boolean
  icon?: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
