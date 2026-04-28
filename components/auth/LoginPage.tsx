import React, { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred. Please try again.'
}

interface DemoAccount {
  role: string
  email: string
}

const DEMO_PASSWORD = 'Password123!'

const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: 'Admin', email: 'alice@nexorder.com.au' },
  { role: 'Manager', email: 'bob@nexorder.com.au' },
  { role: 'Field Rep', email: 'charlie@nexorder.com.au' },
  { role: 'Office Rep', email: 'emma@nexorder.com.au' },
  { role: 'Customer · Seaside Bistro', email: 'david@seasidebistro.com' },
  { role: 'Customer · Lotus Garden', email: 'mei@lotusgarden.com.au' },
]

const CAPABILITIES: readonly string[] = [
  'Tier-aware pricing applied at checkout',
  'Field rep visits plotted on-route',
  'POs, stock, invoicing on one ledger',
]

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const easing = 'cubic-bezier(0.16,1,0.3,1)'

  return (
    <div className="min-h-[100dvh] bg-stone-50 grid grid-cols-1 lg:grid-cols-[5fr_7fr]">
      {/* Brand pane */}
      <aside className="relative hidden lg:flex flex-col overflow-hidden bg-stone-950 text-stone-100 p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-stone-700/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-[420px] w-[420px] rounded-full bg-stone-800/40 blur-3xl"
        />

        <header className="relative z-10 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-stone-50 text-stone-950 font-display text-base font-bold">
            N
          </div>
          <span className="font-display text-base tracking-tight text-stone-100">Nex Order</span>
        </header>

        <div className="relative z-10 mt-auto">
          <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.24em] text-stone-400">
            Wholesale ordering, end to end
          </p>
          <h2 className="max-w-md font-display text-4xl leading-[1.05] tracking-tighter text-stone-50 xl:text-[2.75rem]">
            Place orders, plan routes, and reconcile invoices in one operating layer.
          </h2>
          <ul className="mt-10 space-y-3">
            {CAPABILITIES.map((cap) => (
              <li key={cap} className="flex items-start gap-2.5 text-sm leading-relaxed text-stone-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2} />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="relative z-10 mt-12 flex items-center justify-between font-mono text-[11px] text-stone-500">
          <span>v1.3 · demo build</span>
          <span>Sydney · 2026</span>
        </footer>
      </aside>

      {/* Form pane */}
      <main className="flex flex-col px-6 py-10 sm:px-10 lg:px-16 xl:px-24">
        <div className="flex items-center justify-between lg:hidden">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-stone-950 text-stone-50 font-display text-sm font-bold">
              N
            </div>
            <span className="font-display text-sm tracking-tight text-stone-900">Nex Order</span>
          </div>
          <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-stone-500">
            Demo build
          </span>
        </div>

        <div className="my-auto w-full max-w-md pt-12 lg:pt-0">
          <div className="mb-9">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.24em] text-stone-500">
              Sign in to your account
            </p>
            <h1 className="font-display text-4xl leading-none tracking-tighter text-stone-900 md:text-5xl">
              Welcome back.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-stone-500">
              Sign in to manage orders and products — or pick a demo role below.
            </p>
          </div>

          {error !== null && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3"
            >
              <p className="text-sm leading-relaxed text-rose-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="grid gap-2">
              <label
                htmlFor="email"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={isSubmitting}
                style={{ transitionTimingFunction: easing }}
                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900
                           placeholder-stone-400
                           focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10
                           disabled:bg-stone-100 disabled:text-stone-400
                           transition-[border-color,box-shadow,background-color] duration-300"
              />
            </div>

            <div className="grid gap-2">
              <label
                htmlFor="password"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isSubmitting}
                style={{ transitionTimingFunction: easing }}
                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900
                           placeholder-stone-400
                           focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10
                           disabled:bg-stone-100 disabled:text-stone-400
                           transition-[border-color,box-shadow,background-color] duration-300"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || email === '' || password === ''}
              style={{ transitionTimingFunction: easing }}
              className="group mt-2 inline-flex w-full items-center justify-between gap-3 rounded-lg
                         bg-stone-900 px-5 py-3 text-sm font-semibold text-stone-50
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]
                         hover:bg-stone-800 active:translate-y-[1px]
                         focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 focus:ring-offset-stone-50
                         disabled:cursor-not-allowed disabled:opacity-40
                         transition-[background-color,transform,opacity] duration-300"
            >
              <span>{isSubmitting ? 'Signing in…' : 'Sign in'}</span>
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-disabled:translate-x-0"
                strokeWidth={2}
              />
            </button>
          </form>

          {/* Demo accounts */}
          <section className="mt-10">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-500">
                Demo accounts · click to fill
              </h2>
              <span className="font-mono text-[11px] text-stone-400">
                pw{' '}
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">
                  {DEMO_PASSWORD}
                </span>
              </span>
            </div>
            <ul className="border-y border-stone-200 divide-y divide-stone-200">
              {DEMO_ACCOUNTS.map((account, i) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => fillAccount(account)}
                    disabled={isSubmitting}
                    style={{ transitionTimingFunction: easing }}
                    className="group flex w-full items-center gap-4 py-3
                               text-left
                               hover:bg-stone-100/70 active:translate-y-[0.5px]
                               disabled:cursor-not-allowed disabled:opacity-50
                               transition-[background-color,transform] duration-300
                               px-2 -mx-2 rounded"
                  >
                    <span className="w-6 font-mono text-[11px] tabular-nums text-stone-400">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1 text-sm font-medium text-stone-800">
                      {account.role}
                    </span>
                    <span className="hidden font-mono text-[11px] text-stone-500 sm:inline">
                      {account.email}
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-stone-300 transition-[color,transform] duration-300 group-hover:translate-x-0.5 group-hover:text-stone-700"
                      strokeWidth={2}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="mt-12 font-sans text-xs leading-relaxed text-stone-400">
          Trouble signing in? Contact your administrator if you need access.
        </p>
      </main>
    </div>
  )
}
