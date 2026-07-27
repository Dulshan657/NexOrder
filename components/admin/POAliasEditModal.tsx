// POAliasEditModal — create or edit a customer / product alias row.
//
// Handles both `customer_alias` and `product_alias` variants, both `create`
// and `edit` modes, in one component to keep the alias UI surface compact.
// Submits via the mutate-po-alias Edge Function; surfaces 409 (UNIQUE
// constraint violation) as an inline field error so the operator can adjust
// without losing form state.

import React, { useId, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../ui'
import type { HoReCa, Product } from '../../types'
import type {
  CustomerAliasRow,
  ProductAliasRow,
} from '@/services/supabase/poInboxService'
import {
  useCreateCustomerAlias,
  useCreateProductAlias,
  useUpdateCustomerAlias,
  useUpdateProductAlias,
} from '@/hooks/queries/usePoAliasMutations'

export type AliasModalMode =
  | { kind: 'customer'; action: 'create'; initial?: undefined }
  | { kind: 'customer'; action: 'edit'; initial: CustomerAliasRow }
  | { kind: 'product'; action: 'create'; initial?: undefined }
  | { kind: 'product'; action: 'edit'; initial: ProductAliasRow }

interface POAliasEditModalProps {
  mode: AliasModalMode
  hoReCas: HoReCa[]
  products: Product[]
  onClose: () => void
  onSaved?: () => void
}

const SOURCE_TYPE_OPTIONS: ReadonlyArray<{
  value: 'sender_email' | 'sender_domain' | 'po_text'
  label: string
  hint: string
}> = [
  { value: 'sender_email', label: 'Sender email', hint: 'orders@grandhotel.com' },
  { value: 'sender_domain', label: 'Sender domain', hint: 'grandhotel.com' },
  { value: 'po_text', label: 'PO text', hint: 'Customer name printed on the PO' },
]

const POAliasEditModal: React.FC<POAliasEditModalProps> = ({
  mode,
  hoReCas,
  products,
  onClose,
  onSaved,
}) => (
  // No `onSubmit` on the Modal: the two variants below are alternative <form>s (only
  // ever one is mounted), and each owns its own submit handler and pending state.
  // Promoting either one to the panel would leave the other nested inside a <form>,
  // which is invalid HTML — so both stay inner forms and the panel stays a <div>.
  <Modal
    open
    onClose={onClose}
    title={`${mode.action === 'create' ? 'New' : 'Edit'} ${
      mode.kind === 'customer' ? 'customer' : 'product'
    } alias`}
    description={
      mode.kind === 'customer'
        ? 'Maps an identifier from incoming email to a HoReCa.'
        : 'Maps a code or description in incoming email to one of your products.'
    }
  >
    {mode.kind === 'customer' ? (
      <CustomerAliasForm mode={mode} hoReCas={hoReCas} onClose={onClose} onSaved={onSaved} />
    ) : (
      <ProductAliasForm
        mode={mode}
        hoReCas={hoReCas}
        products={products}
        onClose={onClose}
        onSaved={onSaved}
      />
    )}
  </Modal>
)

// -----------------------------------------------------------------------
// Customer alias form
// -----------------------------------------------------------------------

interface CustomerAliasFormProps {
  mode: Extract<AliasModalMode, { kind: 'customer' }>
  hoReCas: HoReCa[]
  onClose: () => void
  onSaved?: () => void
}

const CustomerAliasForm: React.FC<CustomerAliasFormProps> = ({
  mode,
  hoReCas,
  onClose,
  onSaved,
}) => {
  const initial = mode.action === 'edit' ? mode.initial : undefined
  const [sourceType, setSourceType] = useState<'sender_email' | 'sender_domain' | 'po_text'>(
    initial?.source_type ?? 'sender_email',
  )
  const [sourceValue, setSourceValue] = useState<string>(initial?.source_value ?? '')
  const [horecaId, setHorecaId] = useState<number | null>(initial?.horeca_id ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)

  const create = useCreateCustomerAlias()
  const update = useUpdateCustomerAlias()
  const isBusy = create.isPending || update.isPending

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    setFormError(null)
    setFieldError(null)
    const trimmed = sourceValue.trim()
    if (!trimmed) {
      setFieldError({ field: 'source_value', message: 'Source value is required' })
      return
    }
    if (horecaId == null) {
      setFieldError({ field: 'horeca_id', message: 'Pick a HoReCa' })
      return
    }
    const onError = (err: Error) => {
      const code = (err as Error & { code?: string }).code
      if (code === 'CONFLICT') {
        setFieldError({
          field: 'source_value',
          message: 'An alias already exists for that source_type / source_value.',
        })
      } else {
        setFormError(err.message)
      }
    }
    const onSuccess = () => {
      onSaved?.()
      onClose()
    }
    if (mode.action === 'create') {
      create.mutate(
        { source_type: sourceType, source_value: trimmed, horeca_id: horecaId },
        { onError, onSuccess },
      )
    } else {
      update.mutate(
        { id: mode.initial.id, source_type: sourceType, source_value: trimmed, horeca_id: horecaId },
        { onError, onSuccess },
      )
    }
  }

  const hint = SOURCE_TYPE_OPTIONS.find(o => o.value === sourceType)?.hint ?? ''

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormRow label="Source type">
        <select
          value={sourceType}
          onChange={e =>
            setSourceType(e.target.value as 'sender_email' | 'sender_domain' | 'po_text')
          }
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {SOURCE_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FormRow>

      <FormRow
        label="Source value"
        hint={`e.g. ${hint}`}
        error={fieldError?.field === 'source_value' ? fieldError.message : undefined}
      >
        <input
          type="text"
          value={sourceValue}
          onChange={e => setSourceValue(e.target.value)}
          autoFocus
          maxLength={500}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </FormRow>

      <FormRow
        label="HoReCa"
        error={fieldError?.field === 'horeca_id' ? fieldError.message : undefined}
      >
        <HorecaPicker hoReCas={hoReCas} value={horecaId} onChange={setHorecaId} />
      </FormRow>

      {formError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {formError}
        </p>
      )}

      <FormActions onClose={onClose} isBusy={isBusy} submitLabel={mode.action === 'create' ? 'Create' : 'Save'} />
    </form>
  )
}

// -----------------------------------------------------------------------
// Product alias form
// -----------------------------------------------------------------------

interface ProductAliasFormProps {
  mode: Extract<AliasModalMode, { kind: 'product' }>
  hoReCas: HoReCa[]
  products: Product[]
  onClose: () => void
  onSaved?: () => void
}

const ProductAliasForm: React.FC<ProductAliasFormProps> = ({
  mode,
  hoReCas,
  products,
  onClose,
  onSaved,
}) => {
  const initial = mode.action === 'edit' ? mode.initial : undefined
  const [horecaId, setHorecaId] = useState<number | null>(initial?.horeca_id ?? null)
  const [productId, setProductId] = useState<number | null>(initial?.product_id ?? null)
  const [sourceCode, setSourceCode] = useState<string>(initial?.source_code ?? '')
  const [sourceDescription, setSourceDescription] = useState<string>(
    initial?.source_description ?? '',
  )
  const [defaultPackSize, setDefaultPackSize] = useState<string>(
    initial?.default_pack_size != null ? String(initial.default_pack_size) : '',
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)

  const create = useCreateProductAlias()
  const update = useUpdateProductAlias()
  const isBusy = create.isPending || update.isPending

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    setFormError(null)
    setFieldError(null)
    const code = sourceCode.trim() || null
    const desc = sourceDescription.trim() || null
    if (!code && !desc) {
      setFieldError({
        field: 'source_code',
        message: 'Provide at least one of customer code or description',
      })
      return
    }
    if (horecaId == null) {
      setFieldError({ field: 'horeca_id', message: 'Pick a HoReCa' })
      return
    }
    if (productId == null) {
      setFieldError({ field: 'product_id', message: 'Pick a product' })
      return
    }
    const packSizeNum = defaultPackSize ? Number.parseInt(defaultPackSize, 10) : null
    if (packSizeNum !== null && (Number.isNaN(packSizeNum) || packSizeNum <= 0)) {
      setFieldError({ field: 'default_pack_size', message: 'Pack size must be a positive integer' })
      return
    }
    const onError = (err: Error) => {
      const errCode = (err as Error & { code?: string }).code
      if (errCode === 'CONFLICT') {
        setFieldError({
          field: 'source_code',
          message: 'Another alias already maps this customer code / description.',
        })
      } else {
        setFormError(err.message)
      }
    }
    const onSuccess = () => {
      onSaved?.()
      onClose()
    }
    if (mode.action === 'create') {
      create.mutate(
        {
          horeca_id: horecaId,
          product_id: productId,
          source_code: code,
          source_description: desc,
          default_pack_size: packSizeNum,
        },
        { onError, onSuccess },
      )
    } else {
      update.mutate(
        {
          id: mode.initial.id,
          horeca_id: horecaId,
          product_id: productId,
          source_code: code,
          source_description: desc,
          default_pack_size: packSizeNum,
        },
        { onError, onSuccess },
      )
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormRow
        label="HoReCa"
        error={fieldError?.field === 'horeca_id' ? fieldError.message : undefined}
      >
        <HorecaPicker hoReCas={hoReCas} value={horecaId} onChange={setHorecaId} />
      </FormRow>

      <FormRow
        label="Customer code"
        hint="e.g. 402 (as the customer references this product)"
        error={fieldError?.field === 'source_code' ? fieldError.message : undefined}
      >
        <input
          type="text"
          value={sourceCode}
          onChange={e => setSourceCode(e.target.value)}
          maxLength={120}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </FormRow>

      <FormRow
        label="Customer description"
        hint="Free-text product name the customer uses (optional if code is set)"
      >
        <input
          type="text"
          value={sourceDescription}
          onChange={e => setSourceDescription(e.target.value)}
          maxLength={500}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </FormRow>

      <FormRow
        label="Product"
        error={fieldError?.field === 'product_id' ? fieldError.message : undefined}
      >
        <ProductPicker products={products} value={productId} onChange={setProductId} />
      </FormRow>

      <FormRow
        label="Default pack size"
        hint="Optional. Used when the PO doesn't explicitly state a pack size."
        error={fieldError?.field === 'default_pack_size' ? fieldError.message : undefined}
      >
        <input
          type="number"
          min={1}
          value={defaultPackSize}
          onChange={e => setDefaultPackSize(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </FormRow>

      {formError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {formError}
        </p>
      )}

      <FormActions onClose={onClose} isBusy={isBusy} submitLabel={mode.action === 'create' ? 'Create' : 'Save'} />
    </form>
  )
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

interface FormRowProps {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}

const FormRow: React.FC<FormRowProps> = ({ label, hint, error, children }) => {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      <div id={id}>{children}</div>
      {hint && !error && <p className="text-xs text-stone-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

interface FormActionsProps {
  onClose: () => void
  isBusy: boolean
  submitLabel: string
}

const FormActions: React.FC<FormActionsProps> = ({ onClose, isBusy, submitLabel }) => (
  <div className="flex justify-end gap-2 pt-2">
    <button
      type="button"
      onClick={onClose}
      disabled={isBusy}
      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60 btn-press"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={isBusy}
      className="inline-flex items-center gap-2 rounded-lg bg-nexgen-blue px-3 py-2 text-sm font-medium text-white hover:bg-nexgen-blue/90 disabled:opacity-60 btn-press"
    >
      {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
      {submitLabel}
    </button>
  </div>
)

interface HorecaPickerProps {
  hoReCas: HoReCa[]
  value: number | null
  onChange: (id: number | null) => void
}

const HorecaPicker: React.FC<HorecaPickerProps> = ({ hoReCas, value, onChange }) => {
  const sorted = useMemo(
    () => [...hoReCas].sort((a, b) => a.name.localeCompare(b.name)),
    [hoReCas],
  )
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
    >
      <option value="">Select HoReCa…</option>
      {sorted.map(h => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  )
}

interface ProductPickerProps {
  products: Product[]
  value: number | null
  onChange: (id: number | null) => void
}

const ProductPicker: React.FC<ProductPickerProps> = ({ products, value, onChange }) => {
  const sorted = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  )
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
    >
      <option value="">Select product…</option>
      {sorted.map(p => (
        <option key={p.id} value={p.id}>
          {p.sku} · {p.name}
        </option>
      ))}
    </select>
  )
}

export default POAliasEditModal
