import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PageHeader } from '../components/ui/PageHeader'

afterEach(cleanup)

describe('PageHeader', () => {
  it('renders a level 1 title and its description', () => {
    render(<PageHeader title="Stock" description="Live stock by product." />)

    const title = screen.getByRole('heading', { level: 1, name: 'Stock' })
    expect(title.className).toContain('text-lg sm:text-xl font-display font-bold text-stone-900')

    const description = screen.getByText('Live stock by product.')
    expect(description.className).toContain('text-xs text-stone-500 mt-0.5')
  })

  it('keeps wrapped actions on the right from sm up', () => {
    render(<PageHeader title="PO Inbox" actions={<button type="button">Mailboxes</button>} />)

    // Menus in the header open leftwards from the button, so a row that wraps to
    // the left would push them off the page on a tablet.
    expect(screen.getByRole('button', { name: 'Mailboxes' }).parentElement!.className).toContain('sm:ml-auto')
  })

  it('hides the text below md but keeps it accessible, and always shows actions', () => {
    render(
      <PageHeader title="Stock" description="Live stock by product." actions={<button type="button">Import</button>} />,
    )

    // sr-only rather than display:none: the top bar's title is a span, so this
    // stays the page's one heading for a screen reader on the handheld.
    const text = screen.getByRole('heading', { name: 'Stock' }).parentElement!
    expect(text.className).toContain('sr-only')
    expect(text.className).toContain('md:not-sr-only')
    expect(text.contains(screen.getByText('Live stock by product.'))).toBe(true)

    const actions = screen.getByRole('button', { name: 'Import' }).parentElement!
    expect(text.contains(actions)).toBe(false)
    expect(actions.className).not.toContain('sr-only')
    expect(actions.className).toContain('flex-wrap')
    expect(actions.className).toContain('max-w-full')
  })

  it('visibleOnMobile keeps the text visible', () => {
    render(<PageHeader title="Good morning, Sam" description="Thursday" visibleOnMobile />)

    const text = screen.getByRole('heading', { name: 'Good morning, Sam' }).parentElement!
    expect(text.className).not.toContain('sr-only')
  })

  it('leaves no empty row on a phone when there is nothing to show', () => {
    const { container, rerender } = render(<PageHeader title="Stock" description="Live stock by product." />)
    expect((container.firstElementChild as HTMLElement).className).toContain('max-md:absolute')

    rerender(<PageHeader title="Stock" description="d" actions={<button type="button">Import</button>} />)
    expect((container.firstElementChild as HTMLElement).className).not.toContain('max-md:absolute')

    rerender(<PageHeader title="Stock" description="d" visibleOnMobile />)
    expect((container.firstElementChild as HTMLElement).className).not.toContain('max-md:absolute')
  })
})
