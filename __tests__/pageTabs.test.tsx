import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PageTabs } from '../components/ui/PageTabs'

afterEach(cleanup)

const TABS = [
  { id: 'assign', label: 'Assign' },
  { id: 'walk', label: 'Walk', badge: 3 },
  { id: 'setup', label: 'Setup', badge: 0 },
]

describe('PageTabs', () => {
  it('a disabled tab cannot be chosen and says why', () => {
    const onChange = vi.fn()
    render(
      <PageTabs
        ariaLabel="Shop"
        tabs={[
          { id: 'catalogue', label: 'Catalogue' },
          { id: 'pantry', label: 'Pantry List', disabled: true, title: 'Select a HoReCa first' },
        ]}
        activeId="catalogue"
        onChange={onChange}
      />,
    )

    const pantry = screen.getByRole('button', { name: 'Pantry List' })
    fireEvent.click(pantry)
    expect(onChange).not.toHaveBeenCalled()
    expect(pantry.getAttribute('title')).toBe('Select a HoReCa first')
  })

  it('marks the selected tab and reports a change', () => {
    const onChange = vi.fn()
    render(<PageTabs ariaLabel="Putaway stage" tabs={TABS} activeId="assign" onChange={onChange} />)

    expect(screen.getByRole('navigation', { name: 'Putaway stage' })).toBeTruthy()

    const assign = screen.getByRole('button', { name: 'Assign' })
    expect(assign.getAttribute('aria-current')).toBe('true')
    expect(assign.className).toContain('border-stone-900')

    const walk = screen.getByRole('button', { name: /Walk/ })
    expect(walk.getAttribute('aria-current')).toBeNull()
    expect(walk.className).toContain('border-transparent')

    fireEvent.click(walk)
    expect(onChange).toHaveBeenCalledWith('walk')
  })

  it('shows a count badge and the tap floor', () => {
    render(<PageTabs ariaLabel="Putaway stage" tabs={TABS} activeId="assign" onChange={() => {}} />)

    const walk = screen.getByRole('button', { name: /Walk/ })
    expect(walk.textContent).toContain('3')
    expect(walk.className).toContain('touch-target-y')

    // No count means no badge, rather than a badge reading 0.
    expect(screen.getByRole('button', { name: 'Setup' }).textContent).toBe('Setup')
  })
})
