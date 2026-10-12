// Where a locked kitchen phone goes: the venue's PIN pad.
//
// Its own file, apart from lib/qr/qrSessionEnd.ts, because `hooks/useAuth.ts` needs
// only this one function (its sign-out sends a QR Staff login back to the pad) and
// must not pull the whole QR service client into every build to get it.

import { QR_PARAM, readLastQrToken } from '@/lib/qr/qrLink'

/**
 * `/?qr=<token>` for the venue this browser last opened, or the plain login `/`
 * when it remembers none. The token is base64url, so it needs no escaping, but is
 * encoded anyway to keep the shape honest.
 */
export function qrReturnUrl(token: string | null = readLastQrToken()): string {
  return token ? `/?${QR_PARAM}=${encodeURIComponent(token)}` : '/'
}
