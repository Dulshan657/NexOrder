// The customer dialogs, end to end through the components (NX-0018, found by the
// run against dev: scenario S6).
//
// Two defects, one cause. A billing email of `a@b` passed the browser's own check,
// the server refused it (400 "Invalid email"), and the dialog had already closed:
// the list view closed it the moment Save was pressed, without waiting to hear
// whether the save worked. The person saw "Edge Function returned a non-2xx status
// code" and the values they typed were gone.
//
//   - customer form validation: the form refuses what the server would refuse, on
//     the field, and sends nothing.
//   - customer save failure: a save that fails leaves the dialog open with the
//     values kept and says why, in every place the form is mounted.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { UserRole, type HoReCa, type User } from '@/types'

// The assigned-reps picker and the QR panels are covered by their own tests.
vi.mock('@/components/qr/AssignedRepsPicker', () => ({ default: () => null }))
vi.mock('@/components/qr/AssignedRepsSummary', () => ({ default: () => null }))
vi.mock('@/components/qr/QrAccessPanel', () => ({ default: () => null }))

import HoReCaForm from '@/components/HoReCaForm'
import HoReCaAdmin from '@/components/HoReCaAdmin'
import HoReCaListView from '@/components/HoReCaListView'
import HoReCaProfile from '@/components/HoReCaProfile'

const venue: HoReCa = {
  id: 7,
  name: 'Example Cafe Pty Ltd',
  address: '1 High St',
  phone: '0400 000 001',
  billingEmail: 'accounts@example.com',
}

const admin: User = { id: 1, name: 'Ada Admin', email: 'ada@example.com', role: UserRole.ADMIN }

const refused = { ok: false as const, message: 'Invalid request body: Invalid email' }

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save HoReCa' }))

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('customer form validation', () => {
  function renderForm(onSave = vi.fn()) {
    render(<HoReCaForm hoReCaToEdit={venue} onSave={onSave} onClose={vi.fn()} userRole={UserRole.ADMIN} />)
    return onSave
  }

  it('refuses a billing email of a@b on the field and sends nothing', () => {
    const onSave = renderForm()
    type('Billing email', 'a@b')
    save()

    expect(onSave).not.toHaveBeenCalled()
    const field = screen.getByLabelText('Billing email')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/email/i)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    // The message belongs to the field, and what was typed is still there to fix.
    expect(field.getAttribute('aria-describedby')).toBe(alert.id)
    expect(value('Billing email')).toBe('a@b')

    // Fixing it clears the message and lets the save through.
    type('Billing email', 'ap@example.com')
    expect(screen.queryByRole('alert')).toBeNull()
    save()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('refuses a phone or contact name over its limit on its own field', () => {
    const onSave = renderForm()
    type('Phone', '0'.repeat(41))
    type('Contact name', 'x'.repeat(101))
    save()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText('Phone').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Contact name').getAttribute('aria-invalid')).toBe('true')
    // Billing email was fine and is not flagged.
    expect(screen.getByLabelText('Billing email').getAttribute('aria-invalid')).not.toBe('true')

    type('Phone', '0'.repeat(40))
    type('Contact name', 'x'.repeat(100))
    expect(screen.queryByRole('alert')).toBeNull()
    save()
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe('customer save failure', () => {
  it('keeps the form open with what was typed and says why when the save fails', async () => {
    const onSave = vi.fn().mockResolvedValue(refused)
    const onClose = vi.fn()
    render(<HoReCaForm hoReCaToEdit={venue} onSave={onSave} onClose={onClose} userRole={UserRole.ADMIN} />)

    type('Phone', '0400 000 000')
    type('Billing email', 'ap@example.com')
    save()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid request body: Invalid email')
    expect(value('Phone')).toBe('0400 000 000')
    expect(value('Billing email')).toBe('ap@example.com')
    expect(onClose).not.toHaveBeenCalled()

    // It can be tried again, and a later success clears the message.
    onSave.mockResolvedValue({ ok: true })
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('treats a save that throws the same way as one that reports a failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Network down'))
    render(<HoReCaForm hoReCaToEdit={venue} onSave={onSave} onClose={vi.fn()} userRole={UserRole.ADMIN} />)

    type('Phone', '0400 000 000')
    save()

    expect((await screen.findByRole('alert')).textContent).toContain('Network down')
    expect(value('Phone')).toBe('0400 000 000')
  })

  it('keeps the edit dialog in the customer list open, then closes it once a save works', async () => {
    const onUpdateHoReCa = vi.fn().mockResolvedValue(refused)
    render(
      <HoReCaListView hoReCas={[venue]} orders={[]} invoices={[]} currentUser={admin} onUpdateHoReCa={onUpdateHoReCa} />,
    )

    const row = screen.getByText('Example Cafe Pty Ltd').closest('tr') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[0])
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    type('Phone', '0400 000 000')
    save()

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email')
    expect(value('Phone')).toBe('0400 000 000')
    expect(onUpdateHoReCa).toHaveBeenCalledTimes(1)

    onUpdateHoReCa.mockResolvedValue({ ok: true })
    save()
    await waitFor(() => expect(screen.queryByLabelText('Phone')).toBeNull())
    expect(onUpdateHoReCa).toHaveBeenCalledTimes(2)
  })

  it('keeps the add dialog in the customer list open when the save fails', async () => {
    const onAddHoReCa = vi.fn().mockResolvedValue(refused)
    render(<HoReCaListView hoReCas={[]} orders={[]} invoices={[]} currentUser={admin} onAddHoReCa={onAddHoReCa} />)

    fireEvent.click(screen.getByRole('button', { name: /Add HoReCa/ }))
    type('HoReCa Name', 'Example Cafe Bondi')
    type('Address', '2 Beach Rd')
    type('Phone', '0400 000 000')
    save()

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email')
    expect(value('HoReCa Name')).toBe('Example Cafe Bondi')
    expect(value('Phone')).toBe('0400 000 000')
  })

  it('keeps the edit dialog on the customer profile open when the save fails', async () => {
    const onUpdateHoReCa = vi.fn().mockResolvedValue(refused)
    render(
      <HoReCaProfile
        hoReCa={venue}
        orders={[]}
        invoices={[]}
        currentUser={admin}
        hoReCas={[venue]}
        onBack={vi.fn()}
        onUpdateHoReCa={onUpdateHoReCa}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }))
    type('Phone', '0400 000 000')
    save()

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email')
    expect(value('Phone')).toBe('0400 000 000')
  })

  it('keeps the dialog of the customer table open when the save fails', async () => {
    const onUpdateHoReCa = vi.fn().mockResolvedValue(refused)
    render(
      <HoReCaAdmin
        hoReCas={[venue]}
        currentUser={admin}
        onAddHoReCa={vi.fn()}
        onUpdateHoReCa={onUpdateHoReCa}
        onDeleteHoReCa={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    type('Phone', '0400 000 000')
    save()

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email')
    expect(value('Phone')).toBe('0400 000 000')
  })
})
