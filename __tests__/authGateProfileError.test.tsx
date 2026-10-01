import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// A valid session whose profile failed to LOAD must not be sent to LoginPage:
// signing in again re-runs the same failing fetch and says nothing.

const auth = {
    user: null as unknown,
    profile: null as unknown,
    isLoading: false,
    profileError: false,
    retryProfile: vi.fn(),
    signOut: vi.fn(),
}

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/components/auth/LoginPage', () => ({ default: () => React.createElement('div', null, 'LOGIN PAGE') }))

const { default: AuthGate } = await import('@/components/auth/AuthGate')

function gate() {
    return render(React.createElement(AuthGate, null, React.createElement('div', null, 'APP')))
}

beforeEach(() => {
    auth.user = null
    auth.profile = null
    auth.isLoading = false
    auth.profileError = false
    auth.retryProfile = vi.fn().mockResolvedValue(undefined)
    auth.signOut = vi.fn().mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('AuthGate', () => {
    it('shows LoginPage with no session', () => {
        gate()
        expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    })

    it('renders the app with a session and profile', () => {
        auth.user = { id: 'u' }
        auth.profile = { id: 'u' }
        gate()
        expect(screen.getByText('APP')).toBeTruthy()
    })

    it('offers a retry, not LoginPage, when the profile failed to load', () => {
        auth.user = { id: 'u' }
        auth.profileError = true
        gate()

        expect(screen.queryByText('LOGIN PAGE')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /try again/i }))
        expect(auth.retryProfile).toHaveBeenCalledTimes(1)
    })

    it('lets the user sign out from the error state', () => {
        auth.user = { id: 'u' }
        auth.profileError = true
        gate()

        fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
        expect(auth.signOut).toHaveBeenCalledTimes(1)
    })

    it('still shows LoginPage for a session with no profile row', () => {
        auth.user = { id: 'u' }
        gate()
        expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    })
})
