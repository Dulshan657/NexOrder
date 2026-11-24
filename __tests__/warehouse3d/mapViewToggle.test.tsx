// NX-0035 A7: who is offered the 2D/3D toggle.
//
// Desktop Admin/Manager only. The RS35 handheld (360px, coarse pointer) and the
// Warehouse role keep the 2D map, and a browser that cannot make a WebGL context
// is never offered a view that would render blank.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { UserRole } from '@/types'

vi.mock('@/lib/modules', async (original) => ({ ...(await original<object>()), MODULE_WAREHOUSE_3D: true }))

import { can3d, useCan3d } from '@/components/inventory/warehouse/three/useCan3d'
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

// NX-0046 A9: the offer follows the window. It used to be decided once per role,
// so dragging the window below 1024px left the toggle (and the 3D view) in place.
describe('useCan3d', () => {
  function Probe() {
    return <output data-testid="can">{String(useCan3d(UserRole.ADMIN))}</output>
  }

  it('withdraws 3D when the window stops being a wide fine-pointer screen', () => {
    const listeners = new Set<() => void>()
    const mq = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }
    vi.stubGlobal('matchMedia', () => mq)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
    try {
      const { unmount } = render(<Probe />)
      expect(screen.getByTestId('can').textContent).toBe('true')

      act(() => { mq.matches = false; listeners.forEach((fn) => fn()) })
      expect(screen.getByTestId('can').textContent).toBe('false')

      act(() => { mq.matches = true; listeners.forEach((fn) => fn()) })
      expect(screen.getByTestId('can').textContent).toBe('true')

      unmount()
      expect(listeners.size).toBe(0)
    } finally {
      getContext.mockRestore()
      vi.unstubAllGlobals()
    }
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
