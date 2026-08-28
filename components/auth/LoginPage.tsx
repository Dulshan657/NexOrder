import React, { useState } from 'react'
import { Check } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getBrandByKey } from '@/lib/demoAccounts'
import { wantsResetRequest } from '@/lib/auth/recoveryLink'
import ForgotPasswordDialog from './ForgotPasswordDialog'
import {
  AuthAlert,
  AuthEyebrow,
  AuthField,
  AuthSubmit,
  AUTH_EASING,
  EYEBROW_CLASS,
  authStagger,
} from './authChrome'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred. Please try again.'
}

interface DemoAccount {
  role: string
  email: string
}

// The click-to-fill demo roster publishes working credentials for real accounts
// — including an Admin (alice@nexorder.com.au) — to anyone who loads the login
// page. That is deliberate while the deployment is a sales-demo surface, and is
// documented as a launch blocker in PRODUCTION-READINESS-AUDIT.md.
//
// `__DEMO_HOST__` is `true` only where config/environments.mjs says
// `kind: 'demo'`, folded to a literal by vite.config.ts exactly as the
// `__MODULE_*__` flags are. A tenant build therefore cannot carry these
// credentials, and it takes no action by anyone to keep it that way.
//
// It replaced VITE_SHOW_DEMO_LOGINS, read here as `!== 'false'` -- an opt-out,
// so the roster shipped unless someone set an env var in a Vercel dashboard.
// Nobody did, and a paying client's login page published an Admin account and
// its password. Rotating those credentials is still a separate, outstanding
// action: hiding a credential does not invalidate it.
//
// Guarding the *data* rather than only the JSX is deliberate: dropping an
// unreferenced module-level array relies on tree-shaking, whereas constant
// folding of a ternary is guaranteed. scripts/check-demo-surface.mjs asserts
// this on the built artifact for every target, in both directions.
const SHOW_DEMO_LOGINS = __DEMO_HOST__

const DEMO_PASSWORD = SHOW_DEMO_LOGINS ? 'Password123!' : ''

const DEMO_ACCOUNTS: readonly DemoAccount[] = SHOW_DEMO_LOGINS
  ? [
      { role: 'Admin', email: 'alice@nexorder.com.au' },
      { role: 'Manager', email: 'bob@nexorder.com.au' },
      { role: 'Field Rep', email: 'charlie@nexorder.com.au' },
      { role: 'Office Rep', email: 'emma@nexorder.com.au' },
      { role: 'Warehouse', email: 'warehouse@nexorder.com.au' },
      { role: 'Customer · Seaside Bistro', email: 'david@seasidebistro.com' },
      { role: 'Customer · Lotus Garden', email: 'mei@lotusgarden.com.au' },
    ]
  : []

// Each line names something the app actually does — inbound-PO extraction, WIE
// directed picking, the shared ledger. Keep them checkable: an operator reading
// this panel can go and find the screen behind every claim.
//
// These rotate one at a time on the rail (.auth-proof in index.css). THE COUNT IS
// COUPLED TO THAT CSS: the slot width is baked into the keyframe percentages
// (33.333% = one of three) and there is one :nth-child delay per line. Adding a
// fourth means 25% slots, an 18s duration and a fourth delay — the rotation will
// not adapt on its own, it will just skip.
//
// Keep them within a line or two of each other in length. They share one grid cell
// sized to the tallest, so a much longer line leaves dead space under the others.
const CAPABILITIES: readonly string[] = [
  'Purchase orders read straight from your inbox',
  'Pickers routed bin by bin through the racks',
  'Tier pricing, stock and invoicing on one ledger',
]

// Login renders before auth, so the brand can't key on the user — it's selected
// by the `?brand=<key>` query param (e.g. `/?brand=v2food`). Falls back to the
// neutral Nex Order brand when the param is absent or unknown.
const DEFAULT_BRAND = { logoSrc: '/assets/Nex-Order-no-bg-logo.png', displayName: 'Nex Order' }

function resolveBrand(): { logoSrc: string; displayName: string } {
  if (typeof window === 'undefined') return DEFAULT_BRAND
  const key = new URLSearchParams(window.location.search).get('brand')
  return getBrandByKey(key) ?? DEFAULT_BRAND
}

/** `Customer · Seaside Bistro` → `['Customer', 'Seaside Bistro']`; plain roles → `[role]`. */
function splitRole(role: string): readonly string[] {
  return role.split('·').map((part) => part.trim())
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Open straight into the request dialog when we arrived from a dead recovery
  // link's "Request a new link" (ResetPasswordView leaves the marker behind).
  const [forgotOpen, setForgotOpen] = useState(
    () => typeof window !== 'undefined' && wantsResetRequest(window.location.search),
  )
  const brand = resolveBrand()
  const isDefaultBrand = brand.logoSrc === DEFAULT_BRAND.logoSrc

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await signIn(email, password)
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const fillAccount = (account: DemoAccount) => {
    setEmail(account.email)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  return (
    <div className="min-h-[100dvh] bg-stone-50 grid grid-cols-1 lg:grid-cols-[5fr_7fr]">
      {/* Brand pane. Deep navy (#0A2E52, a darkened #2988de) under one soft wash of
          brand blue — see .auth-rail-wash in index.css, which carries the full
          contrast table. This pane was flat charcoal because an earlier blue
          gradient measured contrast against the base colour and left stone-500
          footer text at ~1.03:1 on the bright end. The wash is capped at 14% and
          the greys below were promoted stone-400 -> stone-300 so the worst point
          on the gradient is 7.76:1, not 4.12:1. Re-measure if you touch either. */}
      <aside className="relative hidden lg:flex flex-col overflow-hidden bg-nexgen-navy auth-rail-wash text-stone-100 p-12 xl:p-16">
        {/* The Nex Order mark is monochrome blue on transparent, so it inverts cleanly
            to white and can sit straight on the charcoal — no white plate needed. The
            `?brand=` client logos (Tridon, V2food) are full-colour and drawn for light
            backgrounds, so inverting them would destroy the brand; those keep a plate. */}
        <header className="flex items-center auth-in" style={authStagger(0)}>
          {isDefaultBrand ? (
            <img
              src={brand.logoSrc}
              alt={brand.displayName}
              className="h-22 w-auto object-contain"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          ) : (
            <div className="rounded-xl bg-white p-3">
              <img src={brand.logoSrc} alt={brand.displayName} className="h-18 w-auto object-contain" />
            </div>
          )}
        </header>

        <div className="mt-auto">
          <div className="mb-6 auth-in" style={authStagger(1)}>
            <AuthEyebrow className="text-stone-300">Wholesale operations, end to end</AuthEyebrow>
          </div>
          <h2
            className="max-w-md font-display text-4xl leading-[1.05] tracking-tighter text-stone-50 xl:text-[2.75rem] auth-in"
            style={authStagger(2)}
          >
            From the order email to the loading dock.
          </h2>
          {/* One line at a time, on a 13.5s CSS loop (.auth-proof in index.css).
              All three stay in the DOM and in the accessibility tree throughout, so
              a screen reader gets the whole list at once rather than waiting out a
              carousel — which is why there is no aria-live here and why the
              off-slot lines must NOT be aria-hidden.

              The entrance and the rotation are on DIFFERENT elements on purpose.
              `.auth-in` and `.auth-proof-item` are both single-class, both
              unlayered, and both set the `animation` shorthand — on one element the
              later rule in index.css wins outright and silently drops the other
              (plus the --auth-i delay). So the <ul> rises in once as a block and the
              <li>s cycle inside it. */}
          <ul className="auth-proof mt-10 max-w-[36ch] auth-in" style={authStagger(3)}>
            {CAPABILITIES.map((cap) => (
              <li
                key={cap}
                className="auth-proof-item flex items-start gap-2.5 text-sm leading-relaxed text-stone-300"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-nexgen-blue" strokeWidth={2} aria-hidden="true" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Stagger index 4, not 6: the three capability lines collapsed into one
            <ul> at index 3, and leaving a gap here would stall the entrance 80ms. */}
        <footer
          className={`mt-12 flex items-center justify-between ${EYEBROW_CLASS} text-stone-300 auth-in`}
          style={authStagger(4)}
        >
          {/* Gated on the same flag as the credentials below. This said
              "v1.3 · demo build" unconditionally, so the first thing a paying
              client saw on their own login page was the word DEMO. Caught on
              nexorder.com.au the day it went live. */}
          <span>{SHOW_DEMO_LOGINS ? 'v1.3 · demo build' : ''}</span>
          <span>Sydney · 2026</span>
        </footer>
      </aside>

      {/* Form pane */}
      <main className="flex flex-col px-6 py-10 sm:px-10 lg:px-16 xl:px-24">
        {/* Mobile brand band. The rail is desktop-only, so without this a phone sees
            no brand colour at all. Negative margins cancel <main>'s padding to bleed
            edge to edge, then the band re-pads itself; it reuses the rail's own
            background so the two can never drift apart. Same logo branching as the
            rail — the mono Nex Order mark inverts to white, full-colour `?brand=`
            logos keep a plate. */}
        <div
          className="-mx-6 -mt-10 mb-8 bg-nexgen-navy auth-rail-wash px-6 py-7 sm:-mx-10 sm:px-10 lg:hidden auth-in"
          style={authStagger(0)}
        >
          <div className="flex items-center justify-between gap-4">
            {isDefaultBrand ? (
              <img
                src={brand.logoSrc}
                alt={brand.displayName}
                className="h-10 w-auto object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            ) : (
              <div className="rounded-lg bg-white p-2">
                <img src={brand.logoSrc} alt={brand.displayName} className="h-8 w-auto object-contain" />
              </div>
            )}
            {SHOW_DEMO_LOGINS && (
              <span
                className={`shrink-0 rounded-full border border-white/20 px-2.5 py-1 ${EYEBROW_CLASS} text-stone-300`}
              >
                Demo build
              </span>
            )}
          </div>
          <p className="mt-5 max-w-[22ch] font-display text-2xl leading-tight tracking-tighter text-stone-50">
            From the order email to the loading dock.
          </p>
        </div>

        {/* No top padding: the mobile band supplies its own mb-8, and on lg the band
            is gone and my-auto centres the form in the pane. */}
        <div className="my-auto w-full max-w-md">
          <div className="mb-9 auth-in" style={authStagger(1)}>
            <AuthEyebrow className="mb-3 text-stone-500">Sign in to your account</AuthEyebrow>
            <h1 className="font-display text-4xl leading-none tracking-tighter text-stone-900">
              Welcome back.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-stone-500">
              Sign in to manage orders and products
              {SHOW_DEMO_LOGINS ? ' — or pick a demo role below.' : '.'}
            </p>
          </div>

          {error !== null && (
            <div className="mb-5">
              <AuthAlert tone="error">{error}</AuthAlert>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="auth-in" style={authStagger(2)}>
              <AuthField
                id="email"
                label="Email address"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={setEmail}
                placeholder="you@company.com"
                disabled={isSubmitting}
              />
            </div>

            <div className="auth-in" style={authStagger(3)}>
              <AuthField
                id="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                disabled={isSubmitting}
                action={
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    disabled={isSubmitting}
                    // 11px is small text, so it needs 4.5:1, not the 3:1 that large text and
                    // non-text get. Brand `nexgen-blue` is 3.70:1 on white and fails
                    // here -- which is NOT the brand exception recorded in the
                    // accessibility statement; that one is scoped to large and
                    // non-text uses. `nexgen-blue-dark` is 4.93:1 and passes.
                    className="text-[11px] font-medium text-nexgen-blue-dark hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Forgot your password?
                  </button>
                }
              />
            </div>

            <div className="pt-2 auth-in" style={authStagger(4)}>
              <AuthSubmit disabled={isSubmitting || email === '' || password === ''}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </AuthSubmit>
            </div>
          </form>

          {/* Demo accounts — dev/demo builds only (see SHOW_DEMO_LOGINS above).
              Chips rather than a numbered list: a roster of roles is a set, not a
              sequence, so the old 01…07 markers encoded nothing. */}
          {SHOW_DEMO_LOGINS && (
            <section className="mt-10 auth-in" style={authStagger(5)}>
              {/* The password used to be printed next to this heading. It is gone
                  from the UI because clicking a chip already fills it — but note
                  that is a display change only: DEMO_PASSWORD is still a module
                  constant and still ships in the bundle. The fix is the env flag
                  above, not this. */}
              <h2 className={`mb-3 ${EYEBROW_CLASS} text-stone-500`}>Demo accounts · click to fill</h2>
              <ul className="flex flex-wrap gap-2">
                {DEMO_ACCOUNTS.map((account) => {
                  const [primary, secondary] = splitRole(account.role)
                  return (
                    <li key={account.email}>
                      <button
                        type="button"
                        onClick={() => fillAccount(account)}
                        disabled={isSubmitting}
                        title={account.email}
                        aria-label={`Fill the form with the ${account.role} account, ${account.email}`}
                        style={{ transitionTimingFunction: AUTH_EASING }}
                        className="inline-flex items-baseline gap-1.5 rounded-full border border-stone-200 bg-white
                                   px-3 py-1.5 text-xs font-medium text-stone-700
                                   hover:border-nexgen-blue hover:bg-nexgen-blue/5 hover:text-nexgen-blue
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40
                                   active:translate-y-[0.5px]
                                   disabled:cursor-not-allowed disabled:opacity-50
                                   transition-[color,background-color,border-color,transform] duration-300"
                      >
                        <span>{primary}</span>
                        {secondary !== undefined && (
                          <span className="font-normal text-stone-400">{secondary}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>

        <p className="mt-12 text-xs leading-relaxed text-stone-400">
          Trouble signing in? Contact your administrator if you need access.
        </p>
      </main>

      <ForgotPasswordDialog
        open={forgotOpen}
        onClose={() => {
          setForgotOpen(false)
          // Drop the marker so a refresh doesn't reopen a dialog the user just
          // dismissed.
          if (wantsResetRequest(window.location.search)) {
            window.history.replaceState(null, '', window.location.pathname)
          }
        }}
        initialEmail={email}
      />
    </div>
  )
}
