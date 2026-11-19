import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { queryClient } from '@/lib/queryClient'

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

  it('keeps cached data on a token refresh for the same user', async () => {
    await signedInAs('rep-charlie')
    onAuthStateChangeCallback!('TOKEN_REFRESHED', session('rep-charlie'))
    onAuthStateChangeCallback!('SIGNED_IN', session('rep-charlie'))
    expect(queryClient.getQueryData(ORDERS_KEY)).toBeTruthy()
  })
})
