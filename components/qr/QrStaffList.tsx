// The kitchen staff behind a venue's QR: who can unlock it, and the form that adds
// someone. Each person is a row with Rename, Reset PIN and Remove.
//
// PINs are chosen by the manager and never shown again -- the server keeps only a
// keyed hash -- so "forgot my PIN" is always "Reset PIN" here, and a reset also
// ends that person's current unlock.
//
// Errors from the server are shown where the manager is looking: a weak or taken
// PIN under the PIN field (QR_WEAK_PIN, QR_PIN_TAKEN), anything else as a line
// above the form. `lib/qr/pinForm.ts` catches the weak ones before the request.

import { Fragment, useState, type FormEvent } from 'react'
import { KeyRound, Pencil, Trash2, UserPlus } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input } from '@/components/ui'
import QrPinField from './QrPinField'
import { useToastActions } from '@/hooks/useToasts'
import {
  useCreateQrStaff,
  useRenameQrStaff,
  useResetQrPin,
  useRevokeQrStaff,
} from '@/hooks/queries/useQrAccess'
import { isQrApiError } from '@/services/supabase/qrService'
import { pinFeedback } from '@/lib/qr/pinForm'
import { formatWhen, isFutureTime, formatClock } from '@/lib/qr/qrFormat'
import type { QrStaff } from '@/types'

const NAME_MAX = 80
const GENERIC_ERROR = 'Something went wrong. Please try again.'

function messageOf(err: unknown): string {
  return isQrApiError(err) ? err.message : GENERIC_ERROR
}

/** The two errors that belong under the PIN field rather than above the form. */
function isPinError(err: unknown): boolean {
  return isQrApiError(err) && (err.code === 'QR_WEAK_PIN' || err.code === 'QR_PIN_TAKEN')
}

// ── add ─────────────────────────────────────────────────────────────────────

function AddStaffForm({ horecaId }: { horecaId: number }) {
  const { addToast } = useToastActions()
  const create = useCreateQrStaff(horecaId)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinTouched, setPinTouched] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const trimmed = name.trim()
  const feedback = pinFeedback(pin, pinTouched)
  const canSubmit = trimmed.length > 0 && feedback.ok && !create.isPending

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setPinTouched(true)
    if (!canSubmit) return
    setPinError(null)
    setFormError(null)
    try {
      await create.mutateAsync({ name: trimmed, pin })
      addToast(`${trimmed} can now unlock the kitchen screen`, 'success')
      setName('')
      setPin('')
      setPinTouched(false)
    } catch (err) {
      if (isPinError(err)) setPinError(messageOf(err))
      else setFormError(messageOf(err))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-stone-200 p-3" aria-label="Add kitchen staff">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
        <UserPlus className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />
        Add kitchen staff
      </h4>
      {formError && (
        <p role="alert" className="text-xs font-medium text-red-700">{formError}</p>
      )}
      <Field label="Name" htmlFor="qr-staff-name">
        <Input
          id="qr-staff-name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          placeholder="e.g. Sam"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <QrPinField
        id="qr-staff-pin"
        label="PIN (4 to 6 digits)"
        value={pin}
        onChange={(next) => { setPin(next); setPinError(null) }}
        onBlur={() => setPinTouched(true)}
        error={pinError ?? feedback.error}
        helper="They enter this after scanning the code. You choose it; it cannot be looked up later."
      />
      <Button type="submit" icon={<UserPlus className="w-4 h-4" aria-hidden="true" />} loading={create.isPending} disabled={!canSubmit}>
        Add staff member
      </Button>
    </form>
  )
}

// ── one person ──────────────────────────────────────────────────────────────

type RowMode = 'view' | 'rename' | 'reset'

function StaffRow({ staff, horecaId, onRemove }: { staff: QrStaff; horecaId: number; onRemove: (s: QrStaff) => void }) {
  const { addToast } = useToastActions()
  const rename = useRenameQrStaff(horecaId)
  const reset = useResetQrPin(horecaId)
  const [mode, setMode] = useState<RowMode>('view')
  const [nameDraft, setNameDraft] = useState(staff.name)
  const [pin, setPin] = useState('')
  const [pinTouched, setPinTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)

  const unlocked = isFutureTime(staff.unlockedUntil)
  const feedback = pinFeedback(pin, pinTouched)

  // The Rename / Reset PIN button that opened the form is unmounted while it is open;
  // when the form closes, focus goes back to it rather than to the page.
  const focusTrigger = (from: 'rename' | 'reset') => {
    setTimeout(() => document.getElementById(`qr-${from}-btn-${staff.id}`)?.focus(), 0)
  }

  const close = () => {
    if (mode !== 'view') focusTrigger(mode)
    setMode('view')
    setError(null)
    setPinError(null)
    setPin('')
    setPinTouched(false)
    setNameDraft(staff.name)
  }

  const onRename = async (e: FormEvent) => {
    e.preventDefault()
    const next = nameDraft.trim()
    if (!next || rename.isPending) return
    if (next === staff.name) return close()
    setError(null)
    try {
      await rename.mutateAsync({ staffId: staff.id, name: next })
      addToast('Name updated', 'success')
      close()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  const onReset = async (e: FormEvent) => {
    e.preventDefault()
    setPinTouched(true)
    if (!feedback.ok || reset.isPending) return
    setError(null)
    setPinError(null)
    try {
      await reset.mutateAsync({ staffId: staff.id, pin })
      addToast(`New PIN set for ${staff.name}. They have been signed out.`, 'success')
      close()
    } catch (err) {
      if (isPinError(err)) setPinError(messageOf(err))
      else setError(messageOf(err))
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">{staff.name}</p>
          <p className="text-xs text-stone-600">
            {staff.lastUnlockedAt ? `Last unlocked ${formatWhen(staff.lastUnlockedAt)}` : 'Has not unlocked yet'}
          </p>
          {unlocked && (
            <span className="mt-1 inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
              Unlocked until {formatClock(staff.unlockedUntil)}
            </span>
          )}
        </div>
        {mode === 'view' && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Button id={`qr-rename-btn-${staff.id}`} size="sm" variant="ghost" icon={<Pencil className="w-3.5 h-3.5" aria-hidden="true" />} aria-label={`Rename ${staff.name}`} onClick={() => setMode('rename')}>
              Rename
            </Button>
            <Button id={`qr-reset-btn-${staff.id}`} size="sm" variant="ghost" icon={<KeyRound className="w-3.5 h-3.5" aria-hidden="true" />} aria-label={`Reset PIN for ${staff.name}`} onClick={() => setMode('reset')}>
              Reset PIN
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />} aria-label={`Remove ${staff.name}`} onClick={() => onRemove(staff)}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {mode === 'rename' && (
        <form onSubmit={onRename} className="mt-2 space-y-2" aria-label={`Rename ${staff.name}`}>
          {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
          <Field label="Name" htmlFor={`qr-rename-${staff.id}`}>
            <Input
              id={`qr-rename-${staff.id}`}
              value={nameDraft}
              maxLength={NAME_MAX}
              autoComplete="off"
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={rename.isPending} disabled={nameDraft.trim() === ''}>Save name</Button>
            <Button size="sm" variant="secondary" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}

      {mode === 'reset' && (
        <form onSubmit={onReset} className="mt-2 space-y-2" aria-label={`Reset PIN for ${staff.name}`}>
          {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
          <QrPinField
            id={`qr-reset-${staff.id}`}
            label={`New PIN for ${staff.name}`}
            value={pin}
            autoFocus
            onChange={(next) => { setPin(next); setPinError(null) }}
            onBlur={() => setPinTouched(true)}
            error={pinError ?? feedback.error}
            helper="Signs them out of any phone they have unlocked."
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={reset.isPending} disabled={!feedback.ok}>Set new PIN</Button>
            <Button size="sm" variant="secondary" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </li>
  )
}

// ── the list ────────────────────────────────────────────────────────────────

export interface QrStaffListProps {
  horecaId: number
  staff: QrStaff[]
}

export default function QrStaffList({ horecaId, staff }: QrStaffListProps) {
  const { addToast } = useToastActions()
  const revoke = useRevokeQrStaff(horecaId)
  const [removing, setRemoving] = useState<QrStaff | null>(null)

  const onConfirmRemove = async () => {
    if (!removing) return
    const target = removing
    try {
      await revoke.mutateAsync(target.id)
      addToast(`${target.name} removed`, 'success')
    } catch (err) {
      // The hook refetches on failure too: the server's "access was removed, but ending
      // their login did not finish" means they ARE gone, and the message says to retry.
      addToast(messageOf(err), 'error')
    } finally {
      setRemoving(null)
      // The row (and the Remove button that had focus) is gone: land on the list heading.
      setTimeout(() => document.getElementById('qr-staff-heading')?.focus(), 0)
    }
  }

  return (
    <div className="space-y-3">
      {staff.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-3 text-sm text-stone-600">
          No one can unlock this code yet. Add the people who reorder in the kitchen.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 px-3" aria-label="Kitchen staff">
          {staff.map((s) => (
            <Fragment key={s.id}>
              <StaffRow staff={s} horecaId={horecaId} onRemove={setRemoving} />
            </Fragment>
          ))}
        </ul>
      )}

      <AddStaffForm horecaId={horecaId} />

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.name}?` : 'Remove staff member?'}
        message="They will not be able to unlock with their PIN any more, and any phone they unlocked is signed out. Their past orders keep their name."
        confirmLabel="Remove"
        tone="danger"
        busy={revoke.isPending}
        onConfirm={onConfirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
