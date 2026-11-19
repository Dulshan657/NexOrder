import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HelpLink } from '@/components/help/HelpLink'

afterEach(cleanup)

describe('HelpLink', () => {
  it('opens the article in a new tab with a named topic', () => {
    render(<HelpLink slug="receive-a-delivery" topic="receiving a delivery" />)
    const link = screen.getByRole('link', { name: 'Help: receiving a delivery' })
    expect(link.getAttribute('href')).toBe('/help/receive-a-delivery')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
    expect(link.className).toMatch(/touch-target/)
  })
})
