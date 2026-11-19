import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Shot } from '@/components/help/primitives'

afterEach(cleanup)

describe('Shot', () => {
  it('hides the badges and lists every callout as text', () => {
    const { container } = render(
      <Shot
        src="/x.png"
        alt="The Receive Stock screen"
        caption="Receive Stock"
        markers={[
          { label: 'A', x: 10, y: 20, text: 'Supplier' },
          { label: 'B', x: 50, y: 80, text: 'Scan field' },
        ]}
      />,
    )
    expect(screen.getByRole('img', { name: 'The Receive Stock screen' })).toBeTruthy()
    const badges = container.querySelectorAll('[data-shot-badge]')
    expect(badges.length).toBe(2)
    for (const b of badges) expect(b.closest('[aria-hidden="true"]')).toBeTruthy()
    const legend = screen.getByRole('list', { name: /callouts/i })
    expect(legend.textContent).toMatch(/A.*Supplier/)
    expect(legend.textContent).toMatch(/B.*Scan field/)
  })
})
