import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Package } from 'lucide-react'

import SidebarNavItem from '../components/SidebarNavItem'

// One definition of a sidebar row. The rows were hand-copied 47 times and had
// drifted into two label shapes and two badge shapes, which is what made them
// fail to line up.

afterEach(cleanup)

describe('SidebarNavItem', () => {
  it('keeps the icon from shrinking and the label from wrapping', () => {
    render(<SidebarNavItem icon={Package} onClick={() => {}}>Scheduled Visits</SidebarNavItem>)
    const button = screen.getByRole('button', { name: 'Scheduled Visits' })

    const icon = button.querySelector('svg')
    expect(icon?.getAttribute('class')).toContain('shrink-0')

    const label = screen.getByText('Scheduled Visits')
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('min-w-0')
  })

  it('marks only the active row as the current page and fires onClick', () => {
    const onClick = vi.fn()
    render(
      <>
        <SidebarNavItem icon={Package} active onClick={onClick}>Stock</SidebarNavItem>
        <SidebarNavItem icon={Package} active={false} onClick={() => {}}>Products</SidebarNavItem>
      </>,
    )
    const active = screen.getByRole('button', { name: 'Stock' })
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Products' }).hasAttribute('aria-current')).toBe(false)

    fireEvent.click(active)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('draws every badge in one shape and hides a zero count', () => {
    render(
      <>
        <SidebarNavItem icon={Package} onClick={() => {}} badge={{ count: 3, colorClass: 'bg-amber-500' }}>Putaway</SidebarNavItem>
        <SidebarNavItem icon={Package} onClick={() => {}} badge={{ count: 12, colorClass: 'bg-teal-500' }}>Visits</SidebarNavItem>
        <SidebarNavItem icon={Package} onClick={() => {}} badge={{ count: 0, colorClass: 'bg-indigo-500' }}>Replenishment</SidebarNavItem>
      </>,
    )
    const shape = (el: HTMLElement) => el.className.split(/\s+/).filter((c) => !/^bg-/.test(c)).sort().join(' ')
    const amber = screen.getByText('3')
    const teal = screen.getByText('12')

    expect(amber.className).toContain('bg-amber-500')
    expect(teal.className).toContain('bg-teal-500')
    expect(shape(amber)).toBe(shape(teal))
    expect(screen.queryByText('0')).toBeNull()
  })
})
