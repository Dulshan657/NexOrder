import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

// Form primitives, hoisted out of `admin/settings/primitives.tsx` so modals and
// settings tabs finally share one input class, one label convention and one focus
// ring. Two modals previously shipped inputs with no focus ring at all.

/** `dense` is the compact table-cell variant. Inputs are always `w-full`; constrain by wrapping. */
export interface InputExtras {
  invalid?: boolean
  dense?: boolean
}

export const inputClass = (invalid?: boolean, dense?: boolean): string =>
  `w-full ${dense ? 'px-2.5 py-1.5 rounded-md' : 'px-3 py-2 rounded-lg'} border text-sm bg-white ` +
  `focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 focus:border-nexgen-blue ` +
  `${invalid ? 'border-red-300' : 'border-stone-300'}`

export interface FieldProps {
  label: string
  htmlFor?: string
  helper?: string
  error?: string
  children: ReactNode
}

/** Label above the control, helper or error text below. Error replaces helper. */
export function Field({ label, htmlFor, helper, error, children }: FieldProps) {
  return (
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
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & InputExtras

export function Input({ invalid, dense, className = '', type = 'text', ...rest }: InputProps) {
  return <input {...rest} type={type} className={`${inputClass(invalid, dense)} ${className}`} />
}

export function NumberInput({ invalid, dense, className = '', ...rest }: InputProps) {
  return <input {...rest} type="number" className={`${inputClass(invalid, dense)} ${className}`} />
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & InputExtras

export function Textarea({ invalid, dense, className = '', ...rest }: TextareaProps) {
  return <textarea {...rest} className={`${inputClass(invalid, dense)} ${className}`} />
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & InputExtras

export function Select({ invalid, dense, className = '', children, ...rest }: SelectProps) {
  return (
    <select {...rest} className={`${inputClass(invalid, dense)} ${className}`}>
      {children}
    </select>
  )
}
