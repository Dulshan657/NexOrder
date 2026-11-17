import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import HelpCentre from '@/components/help/HelpCentre'
import { HELP_ARTICLES } from '@/components/help/manifest'

afterEach(cleanup)

describe('HelpCentre', () => {
  it('floor readers do not see the supervisor article until they ask', () => {
    render(<HelpCentre route={{ kind: 'index' }} audience="floor" />)
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: /receive a delivery/i })).toBeTruthy()
    expect(within(main).queryByRole('link', { name: /assign putaway/i })).toBeNull()
    expect(screen.getByRole('link', { name: /show all articles/i }).getAttribute('href')).toBe('/help')
    cleanup()
    render(<HelpCentre route={{ kind: 'index' }} audience={null} />)
    expect(within(screen.getByRole('main')).getByRole('link', { name: /assign putaway/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /show all articles/i })).toBeNull()
  })

  it('an article shows its steps and a way back', () => {
    render(<HelpCentre route={{ kind: 'article', slug: 'receive-a-delivery' }} audience="floor" />)
    expect(screen.getByRole('heading', { level: 1, name: /receive a delivery/i })).toBeTruthy()
    expect(screen.getAllByRole('list', { name: /steps/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /all articles/i }).getAttribute('href')).toBe('/help?for=floor')
  })

  it('the print guide has a cover and every article in order', () => {
    const { container } = render(<HelpCentre route={{ kind: 'print' }} audience={null} />)
    expect(container.querySelector('[data-print-cover]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /how it works/i })).toBeTruthy()
    const sections = Array.from(container.querySelectorAll('[data-print-article]'))
    expect(sections.map((s) => s.getAttribute('data-print-article'))).toEqual(HELP_ARTICLES.map((a) => a.slug))
    for (const s of sections) expect(s.className).toMatch(/break-before-page/)
  })
})
