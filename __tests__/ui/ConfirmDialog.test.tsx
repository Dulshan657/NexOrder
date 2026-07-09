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
})
