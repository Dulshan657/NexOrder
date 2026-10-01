import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import DataStatusBanner from '@/components/DataStatusBanner'

afterEach(cleanup)

describe('DataStatusBanner', () => {
    it('renders nothing when everything loaded', () => {
        const { container } = render(<DataStatusBanner status={{ failed: [], loading: [] }} onRetry={vi.fn()} />)
        expect(container.textContent).toBe('')
    })

    it('says which data failed, that the screen may be incomplete, and retries', () => {
        const onRetry = vi.fn()
        render(<DataStatusBanner status={{ failed: ['orders', 'products'], loading: [] }} onRetry={onRetry} />)

        const alert = screen.getByRole('alert')
        expect(alert.textContent).toMatch(/orders and products/)
        expect(alert.textContent).toMatch(/incomplete/i)
        fireEvent.click(screen.getByRole('button', { name: /retry/i }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('announces a first load politely', () => {
        render(<DataStatusBanner status={{ failed: [], loading: ['orders'] }} onRetry={vi.fn()} />)
        expect(screen.getByRole('status').textContent).toMatch(/loading orders/i)
    })

    it('a failure outranks loading', () => {
        render(<DataStatusBanner status={{ failed: ['orders'], loading: ['products'] }} onRetry={vi.fn()} />)
        expect(screen.getByRole('alert')).toBeTruthy()
        expect(screen.queryByRole('status')).toBeNull()
    })
})
