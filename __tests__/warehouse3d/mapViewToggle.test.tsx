// NX-0035 A7: who is offered the 2D/3D toggle.
//
// Desktop Admin/Manager only. The RS35 handheld (360px, coarse pointer) and the
// Warehouse role keep the 2D map, and a browser that cannot make a WebGL context
// is never offered a view that would render blank.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { UserRole } from '@/types'
import { can3d } from '@/components/inventory/warehouse/three/useCan3d'
import { MapViewToggle } from '@/components/inventory/warehouse/three/MapViewToggle'

afterEach(() => cleanup())

const OK = { moduleOn: true, role: UserRole.ADMIN, wideFinePointer: true, webgl: true }

describe('can3d', () => {
  it('is true for a desktop Admin or Manager with WebGL', () => {
    expect(can3d(OK)).toBe(true)
    expect(can3d({ ...OK, role: UserRole.MANAGER })).toBe(true)
  })

  it('is false for the Warehouse role', () => {
    expect(can3d({ ...OK, role: UserRole.WAREHOUSE })).toBe(false)
    expect(can3d({ ...OK, role: UserRole.FIELD_REP })).toBe(false)
  })

  it('is false on a coarse pointer or without WebGL', () => {
    expect(can3d({ ...OK, wideFinePointer: false })).toBe(false)
    expect(can3d({ ...OK, webgl: false })).toBe(false)
  })

  it('is false when the module is not in this build', () => {
    expect(can3d({ ...OK, moduleOn: false })).toBe(false)
  })
})

describe('MapViewToggle', () => {
  it('marks the current view and switches on click', () => {
    const onChange = vi.fn()
    render(<MapViewToggle view="2d" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '2D' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(onChange).toHaveBeenCalledWith('3d')
  })

  it('cannot be used while disabled', () => {
    const onChange = vi.fn()
    render(<MapViewToggle view="2d" onChange={onChange} disabled />)
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
