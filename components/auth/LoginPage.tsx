import React, { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred. Please try again.'
}

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

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-stone-800 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold font-display">A</span>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 font-display tracking-tight">
            AYAM Order System
          </h1>
          <p className="mt-1 text-sm text-stone-500 font-sans">
            Sign in to manage orders and products
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-6 font-display">
            Sign in to your account
          </h2>

          {error !== null && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-700 font-sans">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-stone-700 mb-1.5 font-sans"
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
                className="w-full px-3.5 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-900
                           placeholder-stone-400 text-sm font-sans
                           focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent
                           disabled:bg-stone-50 disabled:text-stone-400 transition"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-stone-700 mb-1.5 font-sans"
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
                className="w-full px-3.5 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-900
                           placeholder-stone-400 text-sm font-sans
                           focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent
                           disabled:bg-stone-50 disabled:text-stone-400 transition"
                disabled={isSubmitting}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || email === '' || password === ''}
              className="w-full py-2.5 px-4 rounded-lg bg-stone-800 text-white text-sm font-semibold font-sans
                         hover:bg-stone-700 active:bg-stone-900
                         focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400 font-sans">
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  )
}
