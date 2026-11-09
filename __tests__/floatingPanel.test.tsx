// NX-0033 (C7): the Bin detail and Locations panels did not scroll with the mouse
// wheel. Measured on dev with a bin that holds 40 products, at 1280x720:
//
//   #wh-bin-detail-body   overflow-y: auto   scrollHeight 2193 == clientHeight 2193
//   its wrapper           overflow-y: hidden scrollHeight 2194 >  clientHeight 470
//
// The scroll body had no height bound, so it grew to its content inside an
// `overflow-hidden` wrapper that clipped it. Nothing was ever taller than its own
// box, so there was nothing for a wheel to scroll, and the wheel went on to the page.
//
// jsdom has no layout, so this pins the class chain that makes the body the bounded
// scroll box (the wrapper is a column that may shrink below its content, and the
// body fills it and scrolls). The browser proof is
// tests/e2e/rack-levels/bin-detail-wheel.spec.ts.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { FloatingPanel } from '@/components/inventory/warehouse/FloatingPanel'

afterEach(cleanup)

const classes = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean)

function mount(defaultOpen = true) {
  render(
    <FloatingPanel id="x" title="Bin detail" defaultOpen={defaultOpen}>
      <p>contents</p>
    </FloatingPanel>,
  )
  const body = document.getElementById('x-body')
  if (!body) throw new Error('the panel body #x-body was not rendered')
  const wrapper = body.parentElement
  if (!wrapper) throw new Error('the panel body has no wrapper')
  return { body, wrapper }
}

describe('FloatingPanel', () => {
  it('the body is bounded by its row, so it is the element that scrolls', () => {
    const { body, wrapper } = mount()

    // The body scrolls, and is sized by the row it sits in, not by its content.
    expect(classes(body)).toContain('overflow-y-auto')
    expect(classes(body)).toContain('min-h-0')
    expect(classes(body)).toContain('flex-1')

    // Its wrapper is the column that gives it that bound, and may shrink below it.
    expect(classes(wrapper)).toContain('flex')
    expect(classes(wrapper)).toContain('flex-col')
    expect(classes(wrapper)).toContain('min-h-0')
  })

  it('keeps clipping while it opens and closes, so the collapse animation shows no overflow', () => {
    const { wrapper } = mount()
    expect(classes(wrapper)).toContain('overflow-hidden')
  })

  it('collapses: the body is hidden (out of the tab order) and the row animates to 0fr', () => {
    const { body, wrapper } = mount()
    expect(body.hidden).toBe(false)
    expect(wrapper.parentElement?.style.gridTemplateRows).toBe('1fr')

    fireEvent.click(screen.getByRole('button', { name: /Bin detail/ }))

    expect(screen.getByRole('button', { name: /Bin detail/ }).getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
    expect(wrapper.parentElement?.style.gridTemplateRows).toBe('0fr')
  })

  it('starts collapsed when defaultOpen is false, and opens again on click', () => {
    const { body } = mount(false)
    expect(body.hidden).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Bin detail/ }))

    expect(body.hidden).toBe(false)
    expect(classes(body)).toContain('overflow-y-auto')
  })

  it('wires aria-controls to the body and keeps the caller\'s bodyClassName on it', () => {
    render(
      <FloatingPanel id="y" title="Locations" bodyClassName="p-0">
        <p>tree</p>
      </FloatingPanel>,
    )
    const toggle = screen.getByRole('button', { name: /Locations/ })
    expect(toggle.getAttribute('aria-controls')).toBe('y-body')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const body = document.getElementById('y-body')
    expect(body && classes(body)).toContain('p-0')
    expect(body && classes(body)).toContain('overflow-y-auto')
  })
})
