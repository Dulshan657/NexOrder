import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { __resetModalStack } from '../../components/ui/useModalStack'
import { __resetScrollLock } from '../../components/ui/useScrollLock'

// The overlay primitive. These assert the behaviours that were absent from all ~35
// hand-rolled dialogs: Escape, focus containment, scroll lock, dirty guarding, and
// the flex structure that makes a tall modal unable to clip its own header.

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-scroll-container]')!
}

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

describe('Modal — structure', () => {
  it('portals out of the parent tree onto document.body', () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} title="Add Warehouse">
        <p>body</p>
      </Modal>,
    )
    // Nothing rendered inline; the dialog lives on body.
    expect(container.childNodes).toHaveLength(0)
    expect(screen.getByRole('dialog').closest('[data-scroll-container]')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('labels the dialog with its title', () => {
    render(
      <Modal open onClose={vi.fn()} title="Add Warehouse">
        <p>body</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(document.getElementById(titleId!)?.textContent).toBe('Add Warehouse')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('becomes a <form> when onSubmit is supplied, and submits', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    render(
      <Modal open onClose={vi.fn()} title="T" onSubmit={onSubmit} footer={<button type="submit">Save</button>}>
        <p>body</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.tagName).toBe('FORM')
    fireEvent.click(screen.getByText('Save'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  // The regression guard for the Add Warehouse bug. The overlay must never be the
  // scroll container, the panel must cap its height and be a flex column, and the
  // body must carry `min-h-0` so it can shrink instead of pushing the panel past
  // the viewport (which is what put the header at a negative offset).
  it('caps the panel and scrolls only the body — never the overlay', () => {
    render(
      <Modal open onClose={vi.fn()} title="Add Warehouse" footer={<span>footer</span>}>
        <p>body</p>
      </Modal>,
    )
    const panel = screen.getByRole('dialog')
    const overlay = panel.parentElement!

    expect(overlay.className).not.toMatch(/overflow-y-auto/)
    expect(overlay.className).toMatch(/items-center/)

    // `svh`, not `vh` — and the distinction is the whole point, so this asserts
    // the unit rather than just "is capped". `vh` is the URL-bar-retracted
    // height, which on a handheld never happens (the shell is `overflow-hidden`
    // and the body never scrolls), so a 90vh panel was 648px inside a 664px
    // visible area and its `shrink-0` footer went under the fold. Register F36.
    expect(panel.className).toMatch(/max-h-\[90svh\]/)
    expect(panel.className).not.toMatch(/max-h-\[\d+vh\]/)
    expect(panel.className).toMatch(/flex flex-col/)
    expect(panel.className).toMatch(/overflow-hidden/)

    const body = panel.querySelector('.overflow-y-auto')!
    expect(body.className).toMatch(/min-h-0/)
    expect(body.className).toMatch(/flex-1/)
    expect(body.textContent).toBe('body')
  })
})

describe('Modal — dismissal', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T">
        <p>body</p>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a backdrop click but not on a click inside the panel', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T">
        <p>body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()

    const overlay = screen.getByRole('dialog').parentElement!
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('honours dismissOnBackdrop={false}', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T" dismissOnBackdrop={false}>
        <p>body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not leak clicks to the component that rendered it', () => {
    // React events bubble through the React tree across a portal, so a click inside
    // the panel would otherwise fire a clickable ancestor's handler.
    const onAncestorClick = vi.fn()
    render(
      <div onClick={onAncestorClick}>
        <Modal open onClose={vi.fn()} title="T">
          <p>body</p>
        </Modal>
      </div>,
    )
    fireEvent.click(screen.getByText('body'))
    expect(onAncestorClick).not.toHaveBeenCalled()
  })
})

describe('Modal — dirty guard', () => {
  it('prompts to discard instead of closing, and Escape then targets the confirm only', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Add Warehouse" dirty>
        <p>body</p>
      </Modal>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    // The form behind it is still mounted.
    expect(screen.getByRole('dialog')).toBeTruthy()

    // Escape belongs to the topmost overlay: it dismisses the confirm, not the form.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes once the discard is confirmed', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T" dirty>
        <p>body</p>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('guards a backdrop click too', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T" dirty>
        <p>body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('routes a function-form footer Cancel through the guard', () => {
    // A footer is supplied by the caller, so a Cancel wired straight to `onClose`
    // would skip the guard entirely. The `requestClose` handle prevents that.
    const onClose = vi.fn()
    render(
      <Modal
        open
        onClose={onClose}
        title="T"
        dirty
        footer={({ requestClose }) => <button onClick={requestClose}>Cancel</button>}
      >
        <p>body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('closes outright when the form is clean', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T" dirty={false}>
        <p>body</p>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('fires onClose exactly once (a state updater may run twice)', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T" dirty>
        <p>body</p>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Modal — focus', () => {
  it('moves focus into the panel and restores it to the trigger on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Add warehouse</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Add Warehouse">
            <input aria-label="Code" />
          </Modal>
        </>
      )
    }
    render(<Harness />)

    const trigger = screen.getByText('Add warehouse')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    // First tabbable inside the panel is the close button.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps Tab inside the panel', () => {
    render(
      <Modal open onClose={vi.fn()} title="T" footer={<button>Save</button>}>
        <input aria-label="Code" />
      </Modal>,
    )
    const panel = screen.getByRole('dialog')
    const tabbables = panel.querySelectorAll('button, input')
    const last = tabbables[tabbables.length - 1] as HTMLElement
    last.focus()

    fireEvent.keyDown(panel, { key: 'Tab' })
    // Wrapped back to the first control rather than escaping to the page.
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(tabbables[0])
  })
})

describe('Modal — scroll lock', () => {
  it('freezes the app scroller while open and restores it on close', () => {
    const { rerender } = render(
      <Modal open onClose={vi.fn()} title="T">
        <p>body</p>
      </Modal>,
    )
    expect(scroller().style.overflow).toBe('hidden')

    rerender(
      <Modal open={false} onClose={vi.fn()} title="T">
        <p>body</p>
      </Modal>,
    )
    expect(scroller().style.overflow).toBe('')
  })

  it('stays locked until the last overlay closes', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="T" dirty>
        <p>body</p>
      </Modal>,
    )
    expect(scroller().style.overflow).toBe('hidden')

    // Nested confirm acquires the lock a second time.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(scroller().style.overflow).toBe('hidden')

    // Closing only the confirm must not unfreeze the page behind the form.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(scroller().style.overflow).toBe('hidden')
  })
})
