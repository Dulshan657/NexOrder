// NX-0041 A2. A KPI tile is a button only when it leads somewhere.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import KPICard from '@/components/dashboard/KPICard'

afterEach(cleanup)

describe('KPICard', () => {
  it('renders no button when it has no onClick', () => {
    render(React.createElement(KPICard, { label: 'Revenue', value: '$1,200' }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Revenue')).toBeTruthy()
    expect(screen.getByText('$1,200')).toBeTruthy()
  })

  it('is a named button when it has an onClick', () => {
    const onClick = vi.fn()
    render(React.createElement(KPICard, { label: 'Orders', value: '42', delta: 12.5, onClick }))
    const button = screen.getByRole('button', { name: /orders/i })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/vs prev/i)).toBeTruthy()
  })
})
