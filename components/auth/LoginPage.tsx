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
// SECURITY: before the first paying client, set `VITE_SHOW_DEMO_LOGINS=false`
// in the Vercel project env AND rotate the seeded account passwords. The flag
// defaults ON so demo behaviour is unchanged until that call is made.
//
// Vite statically replaces `import.meta.env.VITE_SHOW_DEMO_LOGINS`, so setting
// it to "false" folds the ternaries below to constants at build time and strips
// the emails and the password from the bundle. Guarding the *data* rather than
// only the JSX is deliberate: dropping an unreferenced module-level array
// relies on tree-shaking, whereas constant folding of a ternary is guaranteed.
// Verify with `grep -r Password123 dist/` after a build.
const SHOW_DEMO_LOGINS = import.meta.env.VITE_SHOW_DEMO_LOGINS !== 'false'

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
      {/* Brand pane. Flat charcoal field rather than a gradient: the previous blue
          gradient put stone-500 footer text at ~1.03:1 and a stone-400 eyebrow at
          ~1.95:1, both far under the 4.5:1 AA floor. On #0f172a the same greys
          measure 7.3:1 and 12.4:1. */}
      <aside className="relative hidden lg:flex flex-col overflow-hidden bg-nexgen-charcoal-dark text-stone-100 p-12 xl:p-16">
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
            <AuthEyebrow className="text-stone-400">Wholesale operations, end to end</AuthEyebrow>
          </div>
          <h2
            className="max-w-md font-display text-4xl leading-[1.05] tracking-tighter text-stone-50 xl:text-[2.75rem] auth-in"
            style={authStagger(2)}
          >
            From the order email to the loading dock.
          </h2>
          <ul className="mt-10 space-y-3">
            {CAPABILITIES.map((cap, i) => (
              <li
                key={cap}
                className="flex items-start gap-2.5 text-sm leading-relaxed text-stone-300 auth-in"
                style={authStagger(3 + i)}
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-nexgen-blue" strokeWidth={2} aria-hidden="true" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer
          className={`mt-12 flex items-center justify-between ${EYEBROW_CLASS} text-stone-400 auth-in`}
          style={authStagger(6)}
        >
          <span>v1.3 · demo build</span>
          <span>Sydney · 2026</span>
        </footer>
      </aside>

      {/* Form pane */}
      <main className="flex flex-col px-6 py-10 sm:px-10 lg:px-16 xl:px-24">
        <div className="flex items-center justify-between lg:hidden auth-in" style={authStagger(0)}>
          <img src={brand.logoSrc} alt={brand.displayName} className="h-9 w-auto object-contain" />
          <span
            className={`rounded-full border border-stone-200 bg-white px-2.5 py-1 ${EYEBROW_CLASS} text-stone-500`}
          >
            Demo build
          </span>
        </div>

        <div className="my-auto w-full max-w-md pt-12 lg:pt-0">
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
                    className="text-[11px] font-medium text-nexgen-blue hover:text-nexgen-blue-dark hover:underline disabled:opacity-50 cursor-pointer"
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
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className={`${EYEBROW_CLASS} text-stone-500`}>Demo accounts · click to fill</h2>
                <span className="font-mono text-[11px] text-stone-400">
                  pw{' '}
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">
                    {DEMO_PASSWORD}
                  </span>
                </span>
              </div>
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
