import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { Modal } from '../../components/ui/Modal'
import { Sheet } from '../../components/ui/Sheet'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import ToastContainer from '../../components/ToastContainer'
import { ToastProvider, useToasts } from '../../hooks/useToasts'
import { __resetModalStack } from '../../components/ui/useModalStack'
import { __resetScrollLock } from '../../components/ui/useScrollLock'
import { Field, Input } from '../../components/ui/Field'
import { expectNoA11yViolations } from '../support/axe'

// Overlays and the toast region. The overlay layer was already strong -- focus
// trap, focus restore, an Escape ownership stack -- so these are a regression
// net over behaviour worth keeping, plus the one gap that was real: the dialog
// description was rendered with no id and referenced by nothing.

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
  const main = document.createElement('div')
  main.setAttribute('data-scroll-container', '')
  document.body.appendChild(main)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

// Overlays portal to document.body, so the container returned by render() is
// empty and axe must be pointed at the body.
const overlayRoot = () => document.body

describe('Modal', () => {
  it('is a labelled, described dialog', async () => {
    render(
      <Modal open onClose={vi.fn()} title="Add Warehouse" description="Sites hold stock.">
        <Field label="Warehouse name">
          <Input />
        </Field>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Add Warehouse' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    // The description was rendered with no id and referenced by nothing, so a
    // screen reader announced the title and then silence.
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Sites hold stock.')

    await expectNoA11yViolations(overlayRoot())
  })
})

describe('Sheet', () => {
  it('is a labelled, described dialog', async () => {
    render(
      <Sheet open onClose={vi.fn()} title="Order detail" description="Lines and delivery.">
        <p>body</p>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Order detail' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(document.getElementById(describedBy!)?.textContent).toBe('Lines and delivery.')
    await expectNoA11yViolations(overlayRoot())
  })
})

describe('ConfirmDialog', () => {
  it('is an alertdialog whose message is announced with it', async () => {
    render(
      <ConfirmDialog
        open
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="Discard changes?"
        message="Your edits will be lost."
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    // An alertdialog announces its description on open; without the link the
    // user is asked to confirm something they were never told.
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Your edits will be lost.')
    await expectNoA11yViolations(overlayRoot())
  })
})

describe('ToastContainer', () => {
  function Pusher({ onReady }: { onReady: (api: ReturnType<typeof useToasts>) => void }) {
    onReady(useToasts())
    return null
  }

  it('mounts a live region before any toast exists', async () => {
    let api!: ReturnType<typeof useToasts>
    render(
      <ToastProvider>
        <Pusher onReady={(a) => (api = a)} />
        <ToastContainer />
      </ToastProvider>,
    )

    // The region has to be there BEFORE the toast arrives: assistive tech is
    // only obliged to watch a region it was already observing, so a role that
    // arrives with its own node is the unreliable half of the pattern.
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')

    await act(async () => {
      api.addToast('Order placed', 'success')
    })
    expect(region.textContent).toContain('Order placed')
    await expectNoA11yViolations(overlayRoot())
  })
})
