// A kitchen phone's own `qr_staff.unlocked_until`: when its 2-hour unlock ends.
//
// The database enforces the window (`user_horeca_id()` goes NULL at expiry); this
// is only how the client learns the time, to count down to it and to put the PIN
// pad back on screen. Which row is "mine" is picked by lib/qr/ownQrStaff.ts.
//
// Result is the ISO timestamp, or null when the login has no usable unlock at all
// (revoked, or its PIN was reset / the code regenerated -- both clear it).

import { useQuery } from '@tanstack/react-query'
import { listQrStaff } from '@/services/supabase/qrService'
import { ownUnlockedUntil } from '@/lib/qr/ownQrStaff'

export const qrOwnUnlockKeys = {
  one: (userId: string, horecaId: number) => ['qr-own-unlock', userId, horecaId] as const,
}

/** One read of the venue's staff rows, reduced to the caller's own unlock time. */
export async function fetchOwnUnlockedUntil(horecaId: number, staffName: string): Promise<string | null> {
  return ownUnlockedUntil(await listQrStaff(horecaId), staffName)
}

export interface UseQrOwnUnlockOptions {
  enabled: boolean
  /** The signed-in auth user id (keys the cache so two staff on one phone never share an answer). */
  userId: string
  horecaId: number | null | undefined
  /** The signed-in profile's name, which is the staff name. */
  staffName: string
}

export function useQrOwnUnlock({ enabled, userId, horecaId, staffName }: UseQrOwnUnlockOptions) {
  const on = enabled && !!userId && horecaId != null
  return useQuery<string | null>({
    queryKey: qrOwnUnlockKeys.one(userId, horecaId ?? -1),
    queryFn: () => fetchOwnUnlockedUntil(horecaId as number, staffName),
    enabled: on,
    // Short: the time is only useful fresh, and the visibility handler refetches anyway.
    staleTime: 60_000,
    retry: 1,
  })
}
