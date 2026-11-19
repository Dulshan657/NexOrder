// NX-0041 A5.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TimePeriodToggle from '@/components/dashboard/TimePeriodToggle'

afterEach(cleanup)

describe('TimePeriodToggle', () => {
  it('marks the selected period with aria-pressed', () => {
    const onChange = vi.fn()
    render(React.createElement(TimePeriodToggle, { value: 'this_week', onChange }))
    expect(screen.getByRole('button', { name: 'This Week' }).getAttribute('aria-pressed')).toBe('true')
    for (const name of ['Today', 'This Month', 'Custom']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenCalledWith('today')
  })
})
