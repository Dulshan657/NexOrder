import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
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
  // `touch-target-y` applies to the dense variant too: dense is about horizontal
  // density in a grid row, and a 34px input is no easier to hit than a 38px one.
  //
  // The focus ring is `nexgen-blue-dark`, solid. It was `nexgen-blue/40`, which
  // composites to #a9cff2 over white -- 1.62:1, against the 3:1 that WCAG 2.2
  // SC 1.4.11 requires of a focus indicator. That is a different criterion from
  // the brand-colour text exception recorded in the accessibility statement, and
  // it is not covered by it: a keyboard user depends on this ring more than on
  // any other single pixel in the app. #2472C2 measures 4.93:1.
  `w-full touch-target-y ${dense ? 'px-2.5 py-1.5 rounded-md' : 'px-3 py-2 rounded-lg'} border text-sm bg-white ` +
  `focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue ` +
  `${invalid ? 'border-red-300' : 'border-stone-300'}`

/**
 * What `<Field>` tells the control inside it.
 *
 * `labelId` rather than an id for the control, deliberately. A Field takes its
 * control as an opaque `children: ReactNode` and cannot know how many controls
 * are in there -- WarehouseForm wraps two -- so handing out one id would emit
 * duplicate ids the moment anyone composes. Several elements may share one
 * `aria-labelledby` target, and several may share one `aria-describedby`, so
 * pointing inward from the control is safe at any arity where pointing outward
 * from the label is not.
 *
 * `htmlFor` is untouched: the 17 call sites that already pass it keep their
 * native label association, and with it click-to-focus.
 */
interface FieldContextValue {
  labelId: string
  describedBy?: string
  invalid: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Accessibility props a control should inherit from its surrounding `<Field>`.
 *
 * Everything the caller supplied wins. A control that already names itself is
 * better informed than the wrapper.
 */
function useFieldA11y(own: {
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  invalid?: boolean
}) {
  const ctx = useContext(FieldContext)
  const named = own['aria-label'] != null || own['aria-labelledby'] != null
  return {
    'aria-labelledby': named || !ctx ? own['aria-labelledby'] : ctx.labelId,
    'aria-describedby': own['aria-describedby'] ?? ctx?.describedBy,
    // `invalid` has always driven the red border; it now also reaches the
    // accessibility tree, where it was never reported at all.
    'aria-invalid': own['aria-invalid'] ?? (own.invalid || ctx?.invalid ? true : undefined),
  }
}

export interface FieldProps {
  label: string
  htmlFor?: string
  helper?: string
  error?: string
  children: ReactNode
}

/** Label above the control, helper or error text below. Error replaces helper. */
export function Field({ label, htmlFor, helper, error, children }: FieldProps) {
  const uid = useId()
  const labelId = `${uid}-label`
  const msgId = `${uid}-msg`
  const message = error ?? helper

  return (
    <FieldContext.Provider
      value={{ labelId, describedBy: message ? msgId : undefined, invalid: Boolean(error) }}
    >
      <div>
        <label id={labelId} htmlFor={htmlFor} className="block text-sm font-medium text-stone-700 mb-1">
          {label}
        </label>
        {children}
        {error ? (
          <p id={msgId} className="text-xs text-red-600 mt-1" role="alert">
            {error}
          </p>
        ) : helper ? (
          <p id={msgId} className="text-xs text-stone-400 mt-1">
            {helper}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & InputExtras

export function Input({ invalid, dense, className = '', type = 'text', ...rest }: InputProps) {
  const a11y = useFieldA11y({ ...rest, invalid })
  return <input {...rest} {...a11y} type={type} className={`${inputClass(invalid, dense)} ${className}`} />
}

export function NumberInput({ invalid, dense, className = '', ...rest }: InputProps) {
  const a11y = useFieldA11y({ ...rest, invalid })
  return <input {...rest} {...a11y} type="number" className={`${inputClass(invalid, dense)} ${className}`} />
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & InputExtras

export function Textarea({ invalid, dense, className = '', ...rest }: TextareaProps) {
  const a11y = useFieldA11y({ ...rest, invalid })
  return <textarea {...rest} {...a11y} className={`${inputClass(invalid, dense)} ${className}`} />
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & InputExtras

export function Select({ invalid, dense, className = '', children, ...rest }: SelectProps) {
  const a11y = useFieldA11y({ ...rest, invalid })
  return (
    <select {...rest} {...a11y} className={`${inputClass(invalid, dense)} ${className}`}>
      {children}
    </select>
  )
}
