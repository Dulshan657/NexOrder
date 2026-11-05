import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { StockModeTabs } from '../components/stock/StockModeTabs'

afterEach(cleanup)

describe('StockModeTabs', () => {
  it('is underlined, and keeps aria-pressed and full-width tap targets', () => {
    const onChange = vi.fn()
    render(<StockModeTabs mode="lookup" onChange={onChange} />)

    const lookup = screen.getByRole('button', { name: 'Look up' })
    expect(lookup.getAttribute('aria-pressed')).toBe('true')
    expect(lookup.className).toContain('border-b-2')
    expect(lookup.className).toContain('border-stone-900')
    expect(lookup.className).toContain('flex-1')
    expect(lookup.className).toContain('touch-target-y')

    const browse = screen.getByRole('button', { name: 'Browse' })
    expect(browse.getAttribute('aria-pressed')).toBe('false')
    expect(browse.className).toContain('border-transparent')

    fireEvent.click(browse)
    expect(onChange).toHaveBeenCalledWith('levels')
  })
})
