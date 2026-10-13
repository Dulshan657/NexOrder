import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { resolveQr, signInWithQrPin, signOutQrLocally, type QrVenueInfo } from '@/services/supabase/qrService'
import { isQrApiError, type QrApiError } from '@/lib/qr/qrApiError'
import { decideQrEntry } from '@/lib/qr/qrEntryDecision'
import { clearLastQrToken, readLastQrToken, saveLastQrToken, stripQrParam } from '@/lib/qr/qrLink'
import { markQrEntry } from '@/lib/qr/qrEntryFlag'
import { describePinFailure, isStillLocked, type PinFailure } from '@/lib/qr/qrPinMessages'
import { fetchOwnUnlockedUntil } from '@/hooks/queries/useQrOwnUnlock'
import { UserRole } from '@/types'
import PinPad from './PinPad'

// What a venue's printed QR opens: the operator's name and the venue's, then a
// PIN pad. Rendered by index.tsx BEFORE AuthGate, so it has to work for someone
// who is signed out -- which is the common case on a kitchen phone.
//
// The screen only chooses; it decides nothing about access. `decideQrEntry`
// (lib/qr/qrEntryDecision.ts) picks one of four answers from the facts below, and
// the server stays the control either way (a wrong 'enter' lands on a screen
// whose every query RLS answers with nothing).
//
//   no session ................ PIN pad
//   Customer of THIS venue .... straight in, to the Kitchen screen
//   QR Staff, still unlocked .. straight in
//   QR Staff, lapsed / other .. sign out LOCALLY (the server side is already
//                               inert), then PIN pad
//   anyone else ............... "Signed in as X": continue, or use a kitchen PIN.
//                               NEVER signs them out unasked.
//
// Auth comes from `useAuth()` -- Root renders this inside AuthProvider -- so the
// session and profile are the same objects the rest of the app reads. After a
// correct PIN the session arrives through onAuthStateChange and the profile is
// loaded a tick later; this waits for it before handing over, so AuthGate never
// has a moment with a user and no profile (which it would draw as LoginPage).

export interface QrEntryScreenProps {
  /** The venue token from `?qr=`, already validated by `readQrToken`. */
  token: string
  /** Hand over to the ordinary app (AuthGate -> App). */
  onDone: () => void
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'pin' }
  | { kind: 'other_user' }
  | { kind: 'entering' }

const MAX_TIMER_MS = 2_147_483_647
const FALLBACK_LOGO = '/assets/Nex-Order-no-bg-logo.png'

const LINK_CLASS =
  'font-semibold text-nexgen-blue-dark underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2'
const PRIMARY_BUTTON =
  'touch-target flex w-full items-center justify-center rounded-xl bg-nexgen-blue-dark px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors btn-press hover:bg-nexgen-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2 disabled:opacity-60'
const SECONDARY_BUTTON =
  'touch-target flex w-full items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-3 text-base font-semibold text-stone-800 transition-colors btn-press hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2 disabled:opacity-60'

/** Take `?qr=` off the address bar without adding a history entry. */
function stripQrFromAddressBar(): void {
  try {
    window.history.replaceState(window.history.state, '', stripQrParam(window.location.href))
  } catch {
    // A sandboxed frame or an old browser: the token just stays visible.
  }
}

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full rounded-2xl border border-stone-200 bg-white p-5 shadow-card">{children}</div>
)

const Spinner: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" className="flex items-center gap-2 py-10 text-sm text-stone-600">
    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
    {label}
  </div>
)

const QrEntryScreen: React.FC<QrEntryScreenProps> = ({ token, onDone }) => {
  const auth = useAuth()

  const [venue, setVenue] = useState<QrVenueInfo | null>(null)
  const [resolveError, setResolveError] = useState<{ unknown: boolean; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<PinFailure | null>(null)
  const [lockActive, setLockActive] = useState(false)

  const aliveRef = useRef(true)
  // The entry decision is made ONCE per visit. Signing in with a PIN changes the
  // auth state under us; re-deciding would bounce the person we just let in.
  const decidedRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Hand over to the app. `kitchen` asks AppShell to open on the Kitchen screen.
  const finish = useCallback(
    (kitchen: boolean) => {
      if (kitchen) markQrEntry()
      stripQrFromAddressBar()
      onDone()
    },
    [onDone],
  )

  // 1. Who does this sticker belong to?
  useEffect(() => {
    let cancelled = false
    setResolveError(null)
    resolveQr(token)
      .then((info) => {
        if (cancelled) return
        saveLastQrToken(token)
        setVenue(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const err: QrApiError | null = isQrApiError(e) ? e : null
        const unknown = err?.code === 'QR_UNKNOWN_CODE'
        // A dead sticker must not become the place an expired phone bounces to.
        if (unknown && readLastQrToken() === token) clearLastQrToken()
        setResolveError({ unknown, message: err?.message || 'Could not open this code. Please try again.' })
      })
    return () => {
      cancelled = true
    }
  }, [token, attempt])

  // 2. Who is already on this phone, and what should that mean?
  useEffect(() => {
    if (!venue || decidedRef.current || auth.isLoading) return
    // A session whose profile FAILED to load: the retry card below handles it. A
    // session with no profile and no error has no usable account behind it (once
    // `isLoading` is false the profile load has finished), so it is treated as no
    // session -- the PIN pad, and a correct PIN replaces it -- rather than a spinner
    // with no way out.
    if (auth.user && !auth.profile && auth.profileError) return

    decidedRef.current = true
    const profile = auth.profile

    void (async () => {
      if (!auth.user || !profile) {
        if (aliveRef.current) setPhase({ kind: 'pin' })
        return
      }

      // Only a QR Staff login of THIS venue has an unlock worth reading.
      let qrUnlockedUntil: string | null = null
      let unlockReadFailed = false
      if (profile.role === UserRole.QR_STAFF && profile.horeca_id === venue.horecaId) {
        try {
          qrUnlockedUntil = await fetchOwnUnlockedUntil(venue.horecaId, profile.name)
        } catch {
          unlockReadFailed = true
        }
      }

      let decision = decideQrEntry({
        session: true,
        role: profile.role,
        profileHorecaId: profile.horeca_id,
        tokenHorecaId: venue.horecaId,
        qrUnlockedUntil,
        now: new Date(),
      })
      // A failed READ proves nothing about the unlock, and signing a working
      // session out over a dropped connection would be a worse outcome than a
      // screen that corrects itself: the expiry hook ends a genuinely lapsed one.
      if (unlockReadFailed && decision === 'pin_after_signout') decision = 'enter'

      if (!aliveRef.current) return
      if (decision === 'enter') {
        finish(true)
      } else if (decision === 'other_user') {
        setPhase({ kind: 'other_user' })
      } else {
        if (decision === 'pin_after_signout') await signOutQrLocally()
        if (aliveRef.current) setPhase({ kind: 'pin' })
      }
    })()
  }, [venue, auth.isLoading, auth.user, auth.profile, finish])

  // 3. A correct PIN was accepted: wait for the new login's profile, then go in.
  useEffect(() => {
    if (phase.kind !== 'entering') return
    if (auth.profile && auth.profile.role === UserRole.QR_STAFF) finish(true)
  }, [phase.kind, auth.profile, finish])

  // A timed lock lifts itself on screen when its time comes.
  useEffect(() => {
    if (!failure || !failure.locked) {
      setLockActive(false)
      return
    }
    const active = isStillLocked(failure, new Date())
    setLockActive(active)
    if (!active || failure.permanent || !failure.lockedUntil) return
    const wait = Math.min(Date.parse(failure.lockedUntil) - Date.now(), MAX_TIMER_MS)
    const timer = setTimeout(() => {
      setLockActive(false)
      setFailure(null)
    }, Math.max(wait, 0))
    return () => clearTimeout(timer)
  }, [failure])

  const handlePin = useCallback(
    async (pin: string): Promise<boolean> => {
      setBusy(true)
      setFailure(null)
      try {
        await signInWithQrPin(token, pin)
        if (aliveRef.current) setPhase({ kind: 'entering' })
        return true
      } catch (e: unknown) {
        const f = describePinFailure(e)
        if (!aliveRef.current) return false
        if (f.kind === 'unknown_code') {
          // The sticker was regenerated while this screen was open.
          if (readLastQrToken() === token) clearLastQrToken()
          setResolveError({ unknown: true, message: f.message })
        } else {
          setFailure(f)
        }
        return false
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    },
    [token],
  )

  const switchToPin = useCallback(async () => {
    await signOutQrLocally()
    if (aliveRef.current) setPhase({ kind: 'pin' })
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  const profileFailed = !!(auth.user && !auth.profile && auth.profileError)
  const logo = venue?.logoUrl ?? null
  const company = venue?.companyName ?? ''
  // No header until we know whose it is: the fallback logo would flash, then swap.
  const showHeader = !!venue || !!resolveError
  // The operator's own identity, in order of preference: their logo (with their
  // name beside it), else their name alone, else ours. Showing OUR logo above
  // THEIR company name would put two brands on one sticker.
  const showFallbackLogo = !logo && !company

  let body: React.ReactNode
  if (resolveError) {
    body = resolveError.unknown ? (
      <Card>
        <h1 className="font-display text-xl font-bold text-stone-900">This code is no longer active</h1>
        <p className="mt-2 text-sm text-stone-600">Ask your manager for the new one.</p>
        <p className="mt-5 text-sm text-stone-600">
          <a href="/" className={LINK_CLASS}>
            Go to sign in
          </a>
        </p>
      </Card>
    ) : (
      <Card>
        <h1 className="font-display text-xl font-bold text-stone-900">Could not open this code</h1>
        <p role="alert" className="mt-2 text-sm text-stone-600">
          {resolveError.message}
        </p>
        <div className="mt-5 space-y-3">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={PRIMARY_BUTTON}>
            Try again
          </button>
          <p className="text-center text-sm text-stone-600">
            <a href="/" className={LINK_CLASS}>
              Go to sign in
            </a>
          </p>
        </div>
      </Card>
    )
  } else if (!venue) {
    body = <Spinner label="Opening your order screen…" />
  } else if (profileFailed && phase.kind === 'loading') {
    body = (
      <Card>
        <h1 className="font-display text-xl font-bold text-stone-900">Couldn't load your account</h1>
        <p role="alert" className="mt-2 text-sm text-stone-600">
          You're still signed in, but we couldn't reach the server. Check your connection and try again.
        </p>
        <div className="mt-5">
          <button type="button" onClick={() => void auth.retryProfile()} className={PRIMARY_BUTTON}>
            Try again
          </button>
        </div>
      </Card>
    )
  } else if (phase.kind === 'loading') {
    body = <Spinner label="Opening your order screen…" />
  } else if (phase.kind === 'entering') {
    body = auth.profileError ? (
      <Card>
        <p role="alert" className="text-sm text-stone-700">
          Unlocked, but we couldn't load your account. Check your connection and try again.
        </p>
        <div className="mt-4">
          <button type="button" onClick={() => void auth.retryProfile()} className={PRIMARY_BUTTON}>
            Try again
          </button>
        </div>
      </Card>
    ) : (
      <Spinner label="Unlocking…" />
    )
  } else if (phase.kind === 'other_user') {
    const name = auth.profile?.name ?? 'this account'
    body = (
      <Card>
        <h1 className="font-display text-xl font-bold text-stone-900">{venue.horecaName}</h1>
        <p className="mt-2 text-sm text-stone-600">
          Signed in as <strong className="text-stone-900">{name}</strong>
          {auth.profile?.role ? ` (${auth.profile.role})` : ''}.
        </p>
        <div className="mt-5 space-y-3">
          <button type="button" onClick={() => finish(false)} className={PRIMARY_BUTTON}>
            {`Continue as ${name}`}
          </button>
          <button type="button" onClick={() => void switchToPin()} className={SECONDARY_BUTTON}>
            Use staff PIN instead
          </button>
        </div>
      </Card>
    )
  } else {
    body = (
      <>
        <h1 className="text-center font-display text-2xl font-bold tracking-tight text-stone-900">{venue.horecaName}</h1>
        <p className="mb-6 mt-1 text-center text-sm text-stone-600">Enter your staff PIN to reorder.</p>
        <PinPad onSubmit={handlePin} busy={busy} disabled={lockActive} error={failure?.message ?? null} />
      </>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center bg-stone-50 px-4 py-8">
      <main className="flex w-full max-w-sm flex-1 flex-col items-center">
        {showHeader && (
          <header className="mb-6 flex items-center justify-center gap-3">
            {logo && (
              // The company name sits right beside it; a logo that repeats it is noise.
              <img src={logo} alt={company ? '' : 'Company logo'} className="h-12 w-auto max-w-[8rem] object-contain" />
            )}
            {showFallbackLogo && <img src={FALLBACK_LOGO} alt="Nex Order" className="h-12 w-auto object-contain" />}
            {company && <span className="text-base font-semibold text-stone-700">{company}</span>}
          </header>
        )}
        {body}
      </main>
      {phase.kind !== 'other_user' && !resolveError?.unknown && (
        <footer className="mt-8 text-center text-sm text-stone-600">
          Not venue staff?{' '}
          <a href="/" className={LINK_CLASS}>
            Sign in
          </a>
        </footer>
      )}
    </div>
  )
}

export default QrEntryScreen
