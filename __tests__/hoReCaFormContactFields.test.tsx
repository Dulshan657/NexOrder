// HoReCaForm -- the contact name, phone, ABN, billing email and brands-bought fields (NX-0018).
//
// What the form guarantees: the saved values are shown when editing, what is typed
// reaches onSave, a blank clears a saved value rather than being dropped, and an ABN
// that is not 11 digits is refused here with a reason instead of coming back from the
// server as a bare "non-2xx status code".

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { UserRole, type HoReCa } from '@/types'

// The assigned-reps picker is covered by assignedRepsPicker.test.tsx and is not what
// this file is about.
vi.mock('@/components/qr/AssignedRepsPicker', () => ({ default: () => null }))

import HoReCaForm from '@/components/HoReCaForm'

const venue: HoReCa = {
  id: 7,
  name: 'Example Cafe Pty Ltd',
  address: '1 High St',
  contactName: 'Jane Citizen',
  phone: '0400 000 001',
  abn: '51824753556',
  billingEmail: 'accounts@example.com',
  buysBrands: ['McCURRIE'],
}

function renderForm(hoReCaToEdit: HoReCa | null = venue) {
  const onSave = vi.fn()
  render(
    <HoReCaForm hoReCaToEdit={hoReCaToEdit} onSave={onSave} onClose={vi.fn()} userRole={UserRole.ADMIN} />,
  )
  return { onSave }
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save HoReCa' }))

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('HoReCaForm: contact fields', () => {
  it('shows the saved contact name, phone, ABN, billing email and brands when editing', () => {
    renderForm()
    expect((screen.getByLabelText('Contact name') as HTMLInputElement).value).toBe('Jane Citizen')
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('0400 000 001')
    expect((screen.getByLabelText('ABN') as HTMLInputElement).value).toBe('51824753556')
    expect((screen.getByLabelText('Billing email') as HTMLInputElement).value).toBe('accounts@example.com')
    expect((screen.getByLabelText('Brands bought') as HTMLInputElement).value).toBe('McCURRIE')
  })

  it('sends what was typed: the ABN as typed, the brands as a clean list', () => {
    const { onSave } = renderForm(null)
    type('HoReCa Name', 'Example Cafe Bondi')
    type('Address', '2 Beach Rd')
    type('Contact name', 'Jane Citizen')
    type('Phone', '0400 000 001')
    type('ABN', '51 824 753 556')
    type('Billing email', 'accounts@example.com')
    type('Brands bought', 'McCURRIE, Bega,, McCURRIE ')
    save()

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Example Cafe Bondi',
      contactName: 'Jane Citizen',
      phone: '0400 000 001',
      abn: '51 824 753 556',
      billingEmail: 'accounts@example.com',
      buysBrands: ['McCURRIE', 'Bega'],
    })
  })

  it('sends a cleared field as blank, so an edit can remove a saved value', () => {
    const { onSave } = renderForm()
    type('Contact name', '')
    type('Phone', '')
    type('ABN', '')
    type('Billing email', '')
    type('Brands bought', '')
    save()

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({
      id: 7,
      contactName: '',
      phone: '',
      abn: '',
      billingEmail: '',
      buysBrands: [],
    })
  })

  it('refuses an ABN that is not 11 digits, says why, and saves nothing', () => {
    const { onSave } = renderForm()
    type('ABN', '123')
    save()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('11 digits')
    expect(screen.getByLabelText('ABN').getAttribute('aria-invalid')).toBe('true')

    // Fixing it clears the message and lets the save through.
    type('ABN', '51 824 753 556')
    expect(screen.queryByRole('alert')).toBeNull()
    save()
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
