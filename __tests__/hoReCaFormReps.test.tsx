// HoReCaForm -- saving the assigned reps alongside the venue.
//
// `set_reps` and the venue update are different tables with different audit
// trails, so they are two calls. The form never learns what the reps section
// does; it is handed a pending saver and decides WHEN. What it guarantees:
//   - the reps are saved first, and a failure keeps the form open with the
//     reason, before anything else has been saved;
//   - a reps-only change sends NO venue update (it would be an empty audit row);
//   - a form that never touched the reps never saves them at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { UserRole, type HoReCa } from '@/types'

const { saveReps } = vi.hoisted(() => ({ saveReps: vi.fn() }))

// The real picker is covered by assignedRepsPicker.test.tsx. This one reports a
// pending saver when poked, which is all the form needs from it.
vi.mock('@/components/qr/AssignedRepsPicker', () => ({
  default: ({ onPendingSave }: { onPendingSave: (p: { save: () => Promise<void> } | null) => void }) => (
    <div>
      <button type="button" onClick={() => onPendingSave({ save: saveReps })}>pick-reps</button>
      <button type="button" onClick={() => onPendingSave(null)}>unpick-reps</button>
    </div>
  ),
}))

import HoReCaForm from '@/components/HoReCaForm'

const venue: HoReCa = { id: 7, name: 'Cafe Roma', address: '1 High St', creditLimit: 1000, tier: 'Silver', discountPercent: 5 }

function renderForm(props: { role?: UserRole; venue?: HoReCa | null } = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <HoReCaForm
      hoReCaToEdit={props.venue === undefined ? venue : props.venue}
      onSave={onSave}
      onClose={onClose}
      userRole={props.role ?? UserRole.ADMIN}
    />,
  )
  return { onSave, onClose }
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save HoReCa' }))

beforeEach(() => {
  saveReps.mockReset()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('HoReCaForm: assigned reps', () => {
  it('offers the section to an admin editing an existing venue', async () => {
    renderForm()
    expect(await screen.findByRole('button', { name: 'pick-reps' })).toBeTruthy()
  })

  it('offers it to a manager too, but not to anyone else, and not on a new venue', async () => {
    renderForm({ role: UserRole.MANAGER })
    expect(await screen.findByRole('button', { name: 'pick-reps' })).toBeTruthy()
    cleanup()

    renderForm({ role: UserRole.FIELD_REP })
    expect(screen.queryByRole('button', { name: 'pick-reps' })).toBeNull()
    cleanup()

    renderForm({ venue: null })
    expect(screen.queryByRole('button', { name: 'pick-reps' })).toBeNull()
  })

  it('never saves reps when the section was not touched', () => {
    const { onSave } = renderForm()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '2 High St' } })
    save()

    expect(saveReps).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('saves only the reps when only the reps changed, and closes without a venue update', async () => {
    saveReps.mockResolvedValue(undefined)
    const { onSave, onClose } = renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'pick-reps' }))
    save()

    await waitFor(() => expect(saveReps).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves the reps THEN the venue when both changed', async () => {
    saveReps.mockResolvedValue(undefined)
    const { onSave } = renderForm()

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '2 High St' } })
    fireEvent.click(await screen.findByRole('button', { name: 'pick-reps' }))
    save()

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(saveReps.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0])
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 7, address: '2 High St' })
  })

  it('keeps the form open and saves nothing else when the reps cannot be saved', async () => {
    saveReps.mockRejectedValue(new Error('Only Field Sales Reps and Office Sales Reps can be assigned'))
    const { onSave, onClose } = renderForm()

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '2 High St' } })
    fireEvent.click(await screen.findByRole('button', { name: 'pick-reps' }))
    save()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Only Field Sales Reps and Office Sales Reps can be assigned')
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('treats a put-back selection as no change', async () => {
    const { onSave } = renderForm()
    fireEvent.click(await screen.findByRole('button', { name: 'pick-reps' }))
    fireEvent.click(screen.getByRole('button', { name: 'unpick-reps' }))
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '2 High St' } })
    save()

    expect(saveReps).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
