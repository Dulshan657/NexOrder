import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PinPad from '@/components/qr/PinPad'
import { expectNoA11yViolations } from './support/axe'

afterEach(cleanup)

const key = (name: string) => screen.getByRole('button', { name })
const press = (digits: string) => digits.split('').forEach((d) => fireEvent.click(key(d)))
const unlock = () => screen.getByRole('button', { name: /^unlock$/i }) as HTMLButtonElement
const input = () => screen.getByLabelText(/staff pin \(4 to 6 digits\)/i) as HTMLInputElement

describe('PinPad — entry', () => {
  it('starts empty with the unlock button off', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    expect(input().value).toBe('')
    expect(unlock().disabled).toBe(true)
    expect(screen.getByText('No digits entered')).toBeTruthy()
  })

  it('takes digits from the keypad and masks them', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    press('135')
    expect(screen.getByText('3 digits entered')).toBeTruthy()
    // The PIN is in a password input only; it is never written into the page as text.
    expect(input().type).toBe('password')
    expect(input().value).toBe('135')
    expect(document.body.textContent).not.toContain('135')
  })

  it('turns the unlock button on at four digits, not before', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    press('123')
    expect(unlock().disabled).toBe(true)
    press('4')
    expect(unlock().disabled).toBe(false)
  })

  it('stops at six digits', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    press('1234567')
    expect(input().value).toBe('123456')
  })

  it('deletes the last digit, and clears all', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    press('1234')
    fireEvent.click(key('Delete last digit'))
    expect(input().value).toBe('123')
    fireEvent.click(key('Clear PIN'))
    expect(input().value).toBe('')
  })

  it('does not offer delete or clear on an empty pad', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    expect((key('Delete last digit') as HTMLButtonElement).disabled).toBe(true)
    expect((key('Clear PIN') as HTMLButtonElement).disabled).toBe(true)
  })

  it('accepts a physical keyboard: digits, Backspace, Enter', async () => {
    const onSubmit = vi.fn()
    render(<PinPad onSubmit={onSubmit} />)
    for (const k of ['2', '4', '6', '8', '9']) fireEvent.keyDown(window, { key: k })
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(input().value).toBe('2468')
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('2468'))
  })

  it('ignores keys with a modifier held (browser shortcuts stay shortcuts)', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    expect(input().value).toBe('')
  })

  it('strips anything but digits typed into the real input (autofill, paste, screen reader)', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    fireEvent.change(input(), { target: { value: '12ab34-56789' } })
    expect(input().value).toBe('123456')
  })

  it('keeps the OS keyboard away: nothing is auto-focused', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    expect(document.activeElement).toBe(document.body)
  })

  it('declares the input numeric, un-autofilled and password-masked', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    expect(input().getAttribute('inputmode')).toBe('numeric')
    expect(input().getAttribute('autocomplete')).toBe('off')
    expect(input().type).toBe('password')
  })
})

describe('PinPad — submit', () => {
  it('submits the PIN from the button', async () => {
    const onSubmit = vi.fn()
    render(<PinPad onSubmit={onSubmit} />)
    press('1357')
    fireEvent.click(unlock())
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('1357'))
  })

  it('empties the pad when the caller says it was wrong (resolves false)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false)
    render(<PinPad onSubmit={onSubmit} />)
    press('1357')
    fireEvent.click(unlock())
    await waitFor(() => expect(input().value).toBe(''))
  })

  it('leaves the pad alone when it resolves true (the caller unmounts it)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(<PinPad onSubmit={onSubmit} />)
    press('1357')
    fireEvent.click(unlock())
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(input().value).toBe('1357')
  })

  it('will not submit under four digits, by button or Enter', () => {
    const onSubmit = vi.fn()
    render(<PinPad onSubmit={onSubmit} />)
    press('123')
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.submit(input().closest('form') as HTMLFormElement)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('PinPad — busy, locked, error', () => {
  it('goes inert while an attempt is in flight', () => {
    const onSubmit = vi.fn()
    render(<PinPad onSubmit={onSubmit} busy />)
    expect((key('5') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: '5' })
    expect(input().value).toBe('')
    expect(screen.getByRole('button', { name: /unlocking/i })).toBeTruthy()
  })

  it('goes inert while the code is locked', () => {
    render(<PinPad onSubmit={vi.fn()} disabled />)
    expect((key('5') as HTMLButtonElement).disabled).toBe(true)
    expect(unlock().disabled).toBe(true)
  })

  it('announces an error assertively and ties it to the input', () => {
    render(<PinPad onSubmit={vi.fn()} error="Incorrect PIN" />)
    const region = screen.getByText('Incorrect PIN')
    expect(region.getAttribute('aria-live')).toBe('assertive')
    expect(input().getAttribute('aria-describedby')).toBe(region.id)
    expect(input().getAttribute('aria-invalid')).toBe('true')
  })

  it('keeps an (empty) live region mounted so the first error is announced', () => {
    const { container } = render(<PinPad onSubmit={vi.fn()} />)
    expect(container.querySelector('[aria-live="assertive"]')).toBeTruthy()
  })
})

describe('PinPad — touch and accessibility', () => {
  it('gives every key the 44px touch floor (and is 56px tall)', () => {
    render(<PinPad onSubmit={vi.fn()} />)
    for (const name of ['1', '5', '9', '0', 'Clear PIN', 'Delete last digit']) {
      const cls = key(name).className
      expect(cls).toContain('touch-target')
      expect(cls).toContain('h-14')
    }
  })

  it('has no WCAG 2.2 AA violations (empty, filled, and with an error)', async () => {
    const { container, rerender } = render(<PinPad onSubmit={vi.fn()} />)
    await expectNoA11yViolations(container)
    press('1234')
    await expectNoA11yViolations(container)
    rerender(<PinPad onSubmit={vi.fn()} error="Too many attempts. Try again at 14:05." />)
    await expectNoA11yViolations(container)
  })
})
