// NX-0039 A13: the Locations list beside the place detail starts collapsed.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocationsPanel } from '@/components/inventory/warehouse/LocationsPanel'

afterEach(() => cleanup())

describe('LocationsPanel', () => {
  it('starts collapsed and opens on a click', () => {
    const onOpenChange = vi.fn()
    render(
      <LocationsPanel onOpenChange={onOpenChange}>
        <p>the tree</p>
      </LocationsPanel>,
    )
    const header = screen.getByRole('button', { name: /locations/i })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('the tree').closest('[hidden]')).not.toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('the tree').closest('[hidden]')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
  })
})
