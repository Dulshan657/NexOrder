// AssignedRepsPicker -- the rep checklist on the HoReCa edit form.
//
// The contract with the form: it reports a SAVER only when the selection differs
// from what is stored, and null when it does not, so a pristine form never fires a
// pointless `set_reps` and a put-back change clears the "unsaved" state. The saver
// sends the COMPLETE set, and the form never needs to know what it does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { reps, profiles, setReps, addToast } = vi.hoisted(() => ({
  reps: vi.fn(),
  profiles: vi.fn(),
  setReps: vi.fn(),
  addToast: vi.fn(),
}))

vi.mock('@/hooks/queries/useHoReCas', () => ({
  useHorecaReps: (...args: unknown[]) => reps(...args),
  useSetHorecaReps: () => ({ mutateAsync: setReps, isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast }),
  useToastActions: () => ({ addToast }),
}))
vi.mock('@/hooks/queries/useProfiles', () => ({
  useProfiles: () => profiles(),
}))

import AssignedRepsPicker from '@/components/qr/AssignedRepsPicker'

const people = [
  { id: 'r1', name: 'Amy', email: 'amy@x.com', role: 'Field Sales Rep' },
  { id: 'r2', name: 'Bob', email: 'bob@x.com', role: 'Office Sales Rep' },
  { id: 'c1', name: 'Cafe Owner', email: 'c@x.com', role: 'Restaurant/Hotel Customer' },
  { id: 'q1', name: 'Sam', email: 'qr@qr.nexorder.invalid', role: 'QR Staff' },
]

function renderPicker() {
  const onPendingSave = vi.fn()
  render(<AssignedRepsPicker horecaId={7} onPendingSave={onPendingSave} />)
  return onPendingSave
}

/** The saver the picker last reported, or null. */
const lastReported = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls[fn.mock.calls.length - 1][0] as { save: () => Promise<void> } | null

beforeEach(() => {
  reps.mockReset()
  profiles.mockReset()
  setReps.mockReset()
  addToast.mockReset()
  reps.mockReturnValue({ data: ['r1'], isLoading: false, isError: false })
  profiles.mockReturnValue({ data: people, isLoading: false })
  setReps.mockResolvedValue(['r1', 'r2'])
})

afterEach(() => cleanup())

describe('AssignedRepsPicker', () => {
  it('offers sales reps only, with the current assignment ticked', () => {
    renderPicker()

    expect((screen.getByLabelText('Amy') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Bob') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByLabelText('Cafe Owner')).toBeNull()
    expect(screen.queryByLabelText('Sam')).toBeNull()
  })

  it('reports nothing to save until the selection differs from what is stored', () => {
    const onPendingSave = renderPicker()
    expect(onPendingSave).not.toHaveBeenCalled()
  })

  it('reports a saver for the new set, which sends the COMPLETE set and says so', async () => {
    const onPendingSave = renderPicker()

    fireEvent.click(screen.getByLabelText('Bob'))

    const pending = lastReported(onPendingSave)
    expect(pending).not.toBeNull()
    expect(setReps).not.toHaveBeenCalled() // reporting is not saving
    await pending!.save()
    expect(setReps).toHaveBeenCalledWith({ horecaId: 7, repIds: ['r1', 'r2'] })
    expect(addToast).toHaveBeenCalledWith('Assigned reps updated', 'success')
  })

  it('lets a failed save reach the form, which decides what to show', async () => {
    setReps.mockRejectedValue(new Error('boom'))
    const onPendingSave = renderPicker()

    fireEvent.click(screen.getByLabelText('Bob'))

    await expect(lastReported(onPendingSave)!.save()).rejects.toThrow('boom')
    expect(addToast).not.toHaveBeenCalled()
  })

  it('reports null when the selection is put back to what is stored', () => {
    const onPendingSave = renderPicker()

    fireEvent.click(screen.getByLabelText('Bob'))
    fireEvent.click(screen.getByLabelText('Bob'))

    expect(lastReported(onPendingSave)).toBeNull()
  })

  it('can unassign everyone: an empty set is a real change', async () => {
    const onPendingSave = renderPicker()

    fireEvent.click(screen.getByLabelText('Amy'))

    await lastReported(onPendingSave)!.save()
    expect(setReps).toHaveBeenCalledWith({ horecaId: 7, repIds: [] })
  })

  it('will not change anything until the stored assignment has loaded', () => {
    reps.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    const onPendingSave = renderPicker()

    expect(screen.getByText('Loading reps...')).toBeTruthy()
    expect(onPendingSave).not.toHaveBeenCalled()
  })

  it('says so, and offers no boxes, when the stored assignment could not be loaded', () => {
    reps.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPicker()

    expect(screen.getByText('Could not load the assigned reps')).toBeTruthy()
    expect(screen.queryByLabelText('Amy')).toBeNull()
  })
})
