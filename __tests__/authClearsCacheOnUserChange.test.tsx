import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { queryClient } from '@/lib/queryClient'
import { readPendingPasswordSet, writePendingPasswordSet } from '@/lib/auth/pendingPasswordSet'

// NX-0045. Found on dev: after one rep signed out and another signed in in the
// same tab, the second rep's dashboard held the first rep's 130 orders. Query
// keys carry no user and staleTime is 5 minutes, so the cache must be dropped
// whenever the signed-in user changes — and only then.

let onAuthStateChangeCallback: ((event: string, session: unknown) => unknown) | null = null
const profileQuery = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => unknown) => {
        onAuthStateChangeCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: profileQuery }) }) }),
  },
}))

const reloadPage = vi.fn()
vi.mock('@/lib/auth/reloadPage', () => ({ reloadPage: () => reloadPage() }))

const { AuthProvider } = await import('@/hooks/useAuth')

const session = (id: string) => ({ user: { id } })
const ORDERS_KEY = ['orders', 'list']

async function signedInAs(id: string) {
  render(React.createElement(AuthProvider, null, 'child'))
  await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())
  onAuthStateChangeCallback!('SIGNED_IN', session(id))
  queryClient.setQueryData(ORDERS_KEY, [{ id: 'o1', submittedBy: id }])
  expect(queryClient.getQueryData(ORDERS_KEY)).toBeTruthy()
}

beforeEach(() => {
  onAuthStateChangeCallback = null
  queryClient.clear()
  reloadPage.mockReset()
  profileQuery.mockReset()
  profileQuery.mockResolvedValue({ data: { id: 'x', role: 'Field Sales Rep' }, error: null })
})

describe('AuthProvider', () => {
  it('drops cached data when the user signs out', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('SIGNED_OUT', null)
    expect(queryClient.getQueryData(ORDERS_KEY)).toBeUndefined()
  })

  it('drops cached data when a different user signs in', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('SIGNED_IN', session('rep-emma'))
    expect(queryClient.getQueryData(ORDERS_KEY)).toBeUndefined()
  })

  it('reloads everything as the next user after a sign-out, never keeping what loaded while signed out', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('SIGNED_OUT', null)
    // Anything a screen fetched while nobody was signed in (RLS: nothing).
    queryClient.setQueryData(['profiles'], [])
    onAuthStateChangeCallback!('SIGNED_IN', session('rep-emma'))
    expect(queryClient.getQueryState(['profiles'])?.isInvalidated).toBe(true)
  })

  it('reloads the page when a different user signs in without a sign-out', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('SIGNED_IN', session('rep-emma'))
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('does not reload while an invite or recovery link is being handled', async () => {
    await signedInAs('rep-charlie')
    window.location.hash = '#access_token=t&refresh_token=r&type=invite'
    try {
      onAuthStateChangeCallback!('SIGNED_IN', session('new-hire'))
      expect(reloadPage).not.toHaveBeenCalled()
      expect(queryClient.getQueryData(ORDERS_KEY)).toBeUndefined()
    } finally {
      window.location.hash = ''
    }
  })

  it('still reloads when another tab left a password-owed marker', async () => {
    // Tab B opened an invite for someone else; this tab only hears the switch.
    // Reloading is the safe move here: the reloaded page reads the marker and
    // shows the set-password screen instead of the app.
    await signedInAs('rep-charlie')
    writePendingPasswordSet({ userId: 'new-hire', flow: 'invite', issuedAt: Date.now() })
    expect(readPendingPasswordSet()).not.toBeNull()
    try {
      onAuthStateChangeCallback!('SIGNED_IN', session('new-hire'))
      expect(reloadPage).toHaveBeenCalledTimes(1)
    } finally {
      localStorage.clear()
    }
  })

  it('does not reload on a plain sign-out, the next sign-in or a refresh', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('TOKEN_REFRESHED', session('rep-charlie'))
    onAuthStateChangeCallback!('SIGNED_OUT', null)
    onAuthStateChangeCallback!('SIGNED_IN', session('rep-emma'))
    expect(reloadPage).not.toHaveBeenCalled()
  })

  it('keeps cached data on a token refresh for the same user', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('TOKEN_REFRESHED', session('rep-charlie'))
    onAuthStateChangeCallback!('SIGNED_IN', session('rep-charlie'))
    expect(queryClient.getQueryData(ORDERS_KEY)).toBeTruthy()
  })
})
