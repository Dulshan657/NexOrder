// TanStack Query bindings for a venue's QR code and the staff PINs behind it
// (services/supabase/qrService.ts -> mutate-qr-access / generate-qr-poster).
//
// Everything is keyed under `['qr-access', horecaId]`, so a single invalidation
// of that prefix refreshes the code, the lock state and the staff list together.
//
// All errors are `QrApiError` (lib/qr/qrApiError.ts): branch on `err.code`
// (QR_WEAK_PIN, QR_PIN_TAKEN, TOO_MANY_REQUESTS ...), show `err.message`.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createQrStaff,
  fetchQrPoster,
  getQrAccess,
  listQrStaff,
  regenerateQrCode,
  renameQrStaff,
  resetQrPin,
  revokeQrStaff,
  unlockQrCode,
  type QrAccessState,
  type QrPosterFormat,
  type QrRegenerateResult,
} from '@/services/supabase/qrService'
import type { QrApiError } from '@/lib/qr/qrApiError'
import type { QrStaff } from '@/types'

export const qrAccessKeys = {
  /** Every venue. */
  all: ['qr-access'] as const,
  /** One venue: the code + lock state + staff, and the lighter staff-only list. */
  venue: (horecaId: number) => ['qr-access', horecaId] as const,
  staff: (horecaId: number) => ['qr-access', horecaId, 'staff'] as const,
} as const

// The lock state and unlock times change under the panel (a cook unlocks, a
// guesser trips the backoff), but not second to second.
const ACCESS_STALE_MS = 15_000

/**
 * The venue's code, entry URL, lock state and active staff.
 *
 * Pass `null`/`undefined` (or `enabled: false`) to keep it idle. NOTE the first
 * call for a venue CREATES its code, so only enable this where the QR & PINs
 * panel is open -- never as a background query on a page that merely shows a
 * button.
 */
export function useQrAccess(
  horecaId: number | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery<QrAccessState, QrApiError>({
    queryKey: qrAccessKeys.venue(horecaId ?? 0),
    queryFn: () => getQrAccess(horecaId as number),
    enabled: enabled && horecaId != null,
    staleTime: ACCESS_STALE_MS,
  })
}

/**
 * Active staff only, read straight from `qr_staff` (RLS: Admin/Manager, the
 * venue's assigned reps, the venue itself). Unlike `useQrAccess` it never creates
 * the code, so it is safe to leave mounted. Names and unlock times, never a PIN.
 */
export function useQrStaff(
  horecaId: number | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery<QrStaff[]>({
    queryKey: qrAccessKeys.staff(horecaId ?? 0),
    queryFn: () => listQrStaff(horecaId as number),
    enabled: enabled && horecaId != null,
    staleTime: ACCESS_STALE_MS,
  })
}

/** Refresh the venue's code state + staff, or every venue's when the id is unknown. */
function useInvalidateAccess(horecaId: number | null | undefined) {
  const qc = useQueryClient()
  return () =>
    qc.invalidateQueries({
      queryKey: horecaId != null ? qrAccessKeys.venue(horecaId) : qrAccessKeys.all,
    })
}

/** `mutate()` with no arguments. Ends every unlock at the venue; the old sticker dies, PINs survive. */
export function useRegenerateQrCode(horecaId: number) {
  const invalidate = useInvalidateAccess(horecaId)
  return useMutation<QrRegenerateResult, QrApiError, void>({
    mutationFn: () => regenerateQrCode(horecaId),
    onSuccess: invalidate,
  })
}

export interface CreateQrStaffVars {
  name: string
  pin: string
}

export function useCreateQrStaff(horecaId: number) {
  const invalidate = useInvalidateAccess(horecaId)
  return useMutation<QrStaff, QrApiError, CreateQrStaffVars>({
    mutationFn: (v) => createQrStaff({ horecaId, name: v.name, pin: v.pin }),
    onSuccess: invalidate,
  })
}

export interface RenameQrStaffVars {
  staffId: string
  name: string
}

export function useRenameQrStaff(horecaId: number) {
  const invalidate = useInvalidateAccess(horecaId)
  return useMutation<{ id: string; name: string }, QrApiError, RenameQrStaffVars>({
    mutationFn: (v) => renameQrStaff(v.staffId, v.name),
    onSuccess: invalidate,
  })
}

export interface ResetQrPinVars {
  staffId: string
  pin: string
}

/** Also ends that person's current unlock, so their `unlockedUntil` clears on refetch. */
export function useResetQrPin(horecaId: number) {
  const invalidate = useInvalidateAccess(horecaId)
  return useMutation<{ sessionsEnded: boolean }, QrApiError, ResetQrPinVars>({
    mutationFn: (v) => resetQrPin(v.staffId, v.pin),
    onSuccess: invalidate,
  })
}

/**
 * `mutate(staffId)`. Idempotent. Invalidates on failure too: the server's
 * "access was removed, but ending their login did not finish" error means the
 * person IS gone from the list.
 */
export function useRevokeQrStaff(horecaId: number) {
  const invalidate = useInvalidateAccess(horecaId)
  return useMutation<void, QrApiError, string>({
    mutationFn: (staffId) => revokeQrStaff(staffId),
    onSettled: invalidate,
  })
}

/** `mutate()` with no arguments. Clears the wrong-PIN lock-out. */
export function useUnlockQrCode(horecaId: number) {
  const invalidate = useInvalidateAccess(horecaId)
  return useMutation<void, QrApiError, void>({
    mutationFn: () => unlockQrCode(horecaId),
    onSuccess: invalidate,
  })
}

export interface QrPosterVars {
  horecaId: number
  format: QrPosterFormat
}

/**
 * Render a poster. A mutation rather than a query on purpose: every call renders
 * afresh, nothing may be cached (the PDF contains the entry token), and it
 * should fire on a click, not on mount. Resolves to the PDF Blob; the caller
 * makes an object URL from it and revokes that when done.
 */
export function useQrPoster() {
  return useMutation<Blob, QrApiError, QrPosterVars>({
    mutationFn: (v) => fetchQrPoster(v.horecaId, v.format),
    // Do not keep the Blob (and so the token) around after the caller has it.
    gcTime: 0,
  })
}
