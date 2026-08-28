import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Field, Input, NumberInput, Select, Textarea } from '../../components/ui/Field'
import { expectNoA11yViolations } from '../support/axe'

// The form primitives. Before this, `<Field>` rendered a <label> and left the
// control unconnected to it, and the `invalid` prop changed a border colour and
// nothing else -- so a screen-reader user tabbing back to a failed field heard
// the field's name, no error, and no indication it had failed.

afterEach(cleanup)

describe('Field — programmatic association', () => {
  it('names the control from the label with no htmlFor supplied', async () => {
    const { container } = render(
      <Field label="Delivery date">
        <Input />
      </Field>,
    )
    expect(screen.getByRole('textbox', { name: 'Delivery date' })).toBeTruthy()
    await expectNoA11yViolations(container)
  })

  it('keeps the caller htmlFor/id pairing when one is supplied', async () => {
    const { container } = render(
      <Field label="Company name" htmlFor="company">
        <Input id="company" />
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Company name' })
    expect(input.getAttribute('id')).toBe('company')
    // The native association survives, so clicking the label still focuses.
    expect(container.querySelector('label')?.getAttribute('for')).toBe('company')
    await expectNoA11yViolations(container)
  })

  it('reports an error through aria-invalid and aria-describedby', () => {
    render(
      <Field label="Minimum order" error="Must be a positive number">
        <NumberInput invalid />
      </Field>,
    )
    const input = screen.getByRole('spinbutton', { name: 'Minimum order' })
    expect(input.getAttribute('aria-invalid')).toBe('true')

    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Must be a positive number')
    // Errors are announced, not merely coloured.
    expect(screen.getByRole('alert').textContent).toBe('Must be a positive number')
  })

  it('describes the control with helper text when there is no error', () => {
    render(
      <Field label="Order prefix" helper="Shown at the start of every order id">
        <Input />
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Order prefix' })
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Shown at the start of every order id',
    )
    // Not an error, so nothing claims to be one.
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets a control that names itself win over the wrapper', () => {
    render(
      <Field label="Search">
        <Input aria-label="Search products by SKU" />
      </Field>,
    )
    expect(screen.getByRole('textbox', { name: 'Search products by SKU' })).toBeTruthy()
  })

  it('does not emit duplicate ids when one Field wraps several controls', async () => {
    // WarehouseForm wraps two controls in a single Field. Handing out one id
    // from the wrapper would put the same id on both, which is invalid HTML and
    // breaks every id-based lookup on the page. Pointing inward from each
    // control at one shared label is legal at any arity.
    const { container } = render(
      <Field label="Location">
        <Input />
        <Select>
          <option>A</option>
        </Select>
      </Field>,
    )
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.getByRole('textbox', { name: 'Location' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Location' })).toBeTruthy()
    await expectNoA11yViolations(container)
  })

  it('covers every primitive', async () => {
    const { container } = render(
      <div>
        <Field label="Text">
          <Input />
        </Field>
        <Field label="Number">
          <NumberInput />
        </Field>
        <Field label="Notes">
          <Textarea />
        </Field>
        <Field label="Warehouse">
          <Select>
            <option>MAIN</option>
          </Select>
        </Field>
      </div>,
    )
    await expectNoA11yViolations(container)
  })
})
