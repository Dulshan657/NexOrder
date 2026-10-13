// "QR & PINs": everything a manager does to give a venue's kitchen a QR reorder.
//
//   the code     print the A4 poster or the sticker, copy the link, regenerate
//                the code (the old sticker dies at once), clear a wrong-PIN lock
//   the people   who can unlock it, each with their own PIN (components/qr/QrStaffList)
//
// Opened from the HoReCa profile ("QR & PINs") and from the `qr_code_locked`
// notification. Mount it only where it can be opened: `useQrAccess` CREATES the
// venue's code the first time it is asked for, so the query is enabled only while
// the sheet is open.
//
// Who may use it is decided by the server (Admin, Manager, the venue's assigned
// reps, the venue's own Customer logins). A rep who is not assigned gets FORBIDDEN
// from the very first call, and that is shown as what to do about it rather than
// as an error.

import { useState } from 'react'
import { Copy, Lock, Printer, QrCode, RefreshCw, Unlock } from 'lucide-react'
import { Button, Callout, ConfirmDialog, Sheet } from '@/components/ui'
import QrStaffList from './QrStaffList'
import { useToastActions } from '@/hooks/useToasts'
import {
  useQrAccess,
  useQrPoster,
  useRegenerateQrCode,
  useUnlockQrCode,
} from '@/hooks/queries/useQrAccess'
import { isQrApiError, type QrPosterFormat } from '@/services/supabase/qrService'
import { discardPendingWindow, openPendingWindow, showPoster } from '@/lib/qr/openPoster'
import { formatWhen } from '@/lib/qr/qrFormat'
import { posterFileName } from '@/supabase/functions/_shared/qrPoster/layout'

const GENERIC_ERROR = 'Something went wrong. Please try again.'
const NOT_ASSIGNED = 'Ask an admin to assign you to this venue.'

export interface QrAccessPanelProps {
  horecaId: number
  open: boolean
  onClose: () => void
}

function messageOf(err: unknown): string {
  return isQrApiError(err) ? err.message : GENERIC_ERROR
}

export default function QrAccessPanel({ horecaId, open, onClose }: QrAccessPanelProps) {
  const { addToast } = useToastActions()
  const access = useQrAccess(horecaId, { enabled: open })
  const regenerate = useRegenerateQrCode(horecaId)
  const unlockCode = useUnlockQrCode(horecaId)
  const poster = useQrPoster()

  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [printing, setPrinting] = useState<QrPosterFormat | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  const state = access.data
  const venueName = state?.horecaName ?? ''
  const forbidden = isQrApiError(access.error) && access.error.code === 'FORBIDDEN'

  const onPrint = async (format: QrPosterFormat) => {
    if (!state || printing) return
    setCodeError(null)
    // The tab must open inside the click; the PDF only arrives after an await.
    const win = openPendingWindow()
    setPrinting(format)
    try {
      const blob = await poster.mutateAsync({ horecaId, format })
      showPoster(blob, posterFileName(venueName, format), win)
    } catch (err) {
      discardPendingWindow(win)
      setCodeError(messageOf(err))
    } finally {
      setPrinting(null)
    }
  }

  const onCopy = async () => {
    if (!state) return
    try {
      await navigator.clipboard.writeText(state.url)
      addToast('Link copied', 'success')
    } catch {
      addToast('Could not copy the link. Print the poster instead.', 'error')
    }
  }

  const onRegenerate = async () => {
    setCodeError(null)
    try {
      await regenerate.mutateAsync()
      addToast('New code created. Print a new poster or sticker.', 'success')
    } catch (err) {
      setCodeError(messageOf(err))
    } finally {
      setConfirmRegenerate(false)
    }
  }

  const onUnlock = async () => {
    setCodeError(null)
    try {
      await unlockCode.mutateAsync()
      addToast('Code unlocked. Staff can try their PINs again.', 'success')
    } catch (err) {
      setCodeError(messageOf(err))
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        width="lg"
        title="QR & PINs"
        description={venueName || undefined}
        icon={<QrCode className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />}
        footer={({ requestClose }) => (
          <Button variant="secondary" onClick={requestClose}>Done</Button>
        )}
      >
        <div className="space-y-6">
          <Callout tone="info" title="How it works">
            Stick the poster up where your team orders from. Staff scan it with their phone, enter their own PIN, and can
            reorder for the next 2 hours. Every order they send waits for approval before it is placed.
          </Callout>

          {access.isLoading && (
            <p role="status" className="py-6 text-center text-sm text-stone-600">Loading...</p>
          )}

          {access.isError && (
            <Callout
              tone={forbidden ? 'warning' : 'danger'}
              title={forbidden ? 'You cannot manage this venue yet' : 'Could not load the QR code'}
              action={forbidden ? undefined : <Button size="sm" variant="secondary" onClick={() => access.refetch()}>Try again</Button>}
            >
              {forbidden ? NOT_ASSIGNED : access.error.message}
            </Callout>
          )}

          {state && (
            <>
              <section aria-labelledby="qr-code-heading" className="space-y-3">
                <h3 id="qr-code-heading" className="text-sm font-semibold text-stone-900">QR code</h3>

                {state.locked ? (
                  <Callout
                    tone="danger"
                    icon={<Lock className="w-3.5 h-3.5" aria-hidden="true" />}
                    title={state.permanent ? 'Locked after too many wrong PINs' : 'Temporarily locked'}
                    action={
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Unlock className="w-3.5 h-3.5" aria-hidden="true" />}
                        loading={unlockCode.isPending}
                        onClick={onUnlock}
                      >
                        Unlock code
                      </Button>
                    }
                  >
                    {state.permanent
                      ? 'Nobody can unlock until you clear this. If it was not one of your staff guessing, regenerate the code too.'
                      : `Too many wrong PINs. It opens again ${state.lockedUntil ? formatWhen(state.lockedUntil) : 'shortly'}, or you can unlock it now.`}
                  </Callout>
                ) : (
                  <p className="text-sm text-stone-700">
                    <span className="mr-2 inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Active</span>
                    {venueName ? `${venueName}'s code is ready to print.` : 'The code is ready to print.'}
                  </p>
                )}

                {codeError && (
                  <p role="alert" className="text-xs font-medium text-red-700">{codeError}</p>
                )}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    icon={<Printer className="w-4 h-4" aria-hidden="true" />}
                    loading={printing === 'a4'}
                    disabled={printing !== null}
                    onClick={() => onPrint('a4')}
                  >
                    Print A4 poster
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Printer className="w-4 h-4" aria-hidden="true" />}
                    loading={printing === 'sticker'}
                    disabled={printing !== null}
                    onClick={() => onPrint('sticker')}
                  >
                    Print sticker
                  </Button>
                  <Button variant="secondary" icon={<Copy className="w-4 h-4" aria-hidden="true" />} onClick={onCopy}>
                    Copy link
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                    onClick={() => setConfirmRegenerate(true)}
                  >
                    Regenerate code
                  </Button>
                </div>
              </section>

              <section aria-labelledby="qr-staff-heading" className="space-y-3">
                <h3 id="qr-staff-heading" tabIndex={-1} className="text-sm font-semibold text-stone-900 focus:outline-none">
                  Staff
                </h3>
                <QrStaffList horecaId={horecaId} staff={state.staff} />
              </section>
            </>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmRegenerate}
        title="Regenerate this QR code?"
        message="Old stickers stop working immediately, and everyone who is unlocked is signed out. Staff PINs keep working. You will need to print and put up the new poster or sticker."
        confirmLabel="Regenerate"
        tone="danger"
        busy={regenerate.isPending}
        onConfirm={onRegenerate}
        onCancel={() => setConfirmRegenerate(false)}
      />
    </>
  )
}
