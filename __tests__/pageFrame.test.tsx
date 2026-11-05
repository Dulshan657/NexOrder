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
})
