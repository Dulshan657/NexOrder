import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { __resetModalStack } from '../../components/ui/useModalStack'
import { __resetScrollLock } from '../../components/ui/useScrollLock'

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('ConfirmDialog', () => {
  it('is an alertdialog labelled by its title', () => {
    render(<ConfirmDialog open title="Delete warehouse?" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(document.getElementById(titleId!)?.textContent).toBe('Delete warehouse?')
  })

  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="T" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('confirms and cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="T" confirmLabel="Discard" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByText('Discard'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and on a backdrop click', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="T" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('alertdialog').parentElement!)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  // MailboxesMenu's sign-out dialog blocked Escape while the request was in flight.
  // The primitive has to preserve that or a mid-flight dismiss silently orphans it.
  it('cannot be dismissed while busy', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<ConfirmDialog open title="T" busy onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('alertdialog').parentElement!)
    expect(onCancel).not.toHaveBeenCalled()

    // Both buttons are inert too: Cancel disabled, Confirm shows a spinner.
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog').querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('accepts a rich ReactNode message', () => {
    render(
      <ConfirmDialog
        open
        title="Sign out?"
        message={<a href="https://example.com">revoke access</a>}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('revoke access').tagName).toBe('A')
  })

  // This was the ONE overlay primitive in the app with no height cap and no
  // internal scroller. `Overlay` is explicitly never a scroll container and the
  // panel is centred, so a long message grew it past the viewport in both
  // directions at once and pushed Confirm/Cancel off the bottom with no way to
  // reach them. Measured in Chrome at 360x664 before the fix: the panel spanned
  // -57..722 and the Confirm button sat at 661..697, i.e. 3px of it visible.
  //
  // jsdom has no layout, so this asserts the SHAPE that makes the geometry come
  // out right -- the same contract components/ui/chrome.tsx applies to Modal and
  // Sheet, and the reason those two never had this bug.
  it('caps its height and scrolls the message, so the buttons stay reachable', () => {
    render(
      <ConfirmDialog
        open
        title="Cancel this order?"
        message={'a very long explanation. '.repeat(80)}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const panel = screen.getByRole('alertdialog')

    expect(panel.className).toMatch(/max-h-\[90svh\]/)
    expect(panel.className).toMatch(/flex flex-col/)
    // `vh` would be the URL-bar-retracted height and is what F36 was about.
    expect(panel.className).not.toMatch(/max-h-\[\d+vh\]/)

    // Only the message scrolls. `min-h-0` is load-bearing: without it flexbox's
    // `min-height: auto` refuses to shrink the body, the panel outgrows its cap
    // and the button row is pushed out again -- which is exactly the Add
    // Warehouse bug, in a different primitive.
    const body = panel.querySelector('.overflow-y-auto')
    expect(body, 'the message must be the scroller').not.toBeNull()
    expect(body!.className).toMatch(/min-h-0/)
    expect(body!.className).toMatch(/flex-1/)

    // The buttons must sit OUTSIDE that scroller, and never shrink.
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(body!.contains(confirm)).toBe(false)
    expect(confirm.closest('div')!.className).toMatch(/shrink-0/)
  })
})
