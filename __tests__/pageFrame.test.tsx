import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PageFrame } from '../components/ui/PageFrame'

afterEach(cleanup)

describe('PageFrame', () => {
  it('applies the standard padding and spacing', () => {
    render(<PageFrame><p>Body</p></PageFrame>)

    const frame = screen.getByText('Body').parentElement!
    expect(frame.className).toContain('bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6')
  })

  it('column swaps the spacing for a flex column', () => {
    render(<PageFrame column><p>Body</p></PageFrame>)

    // The gap replaces space-y rather than joining it: space-y puts a margin on
    // every child but the last in the DOM, which a re-ordered dock is not.
    const frame = screen.getByText('Body').parentElement!
    expect(frame.className).toContain('bg-white min-h-svh p-4 sm:p-6 lg:p-8 flex flex-col gap-5 sm:gap-6')
    expect(frame.className).not.toContain('space-y')
  })
})
