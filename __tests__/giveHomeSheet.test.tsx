// NX-0033: the chooser a Manager or Admin uses to give a product with no home bin
// one, from the Walk. The bins it lists come from home-bin-choices, which has
// already dropped every bin putaway could not use, one that is full, and another
// product's home. So the sheet only has to let the manager name one of them: by
// scanning its label, by typing its code, or by picking it from a list.
//
// It chooses; it does not save. The home is set when the stock is put away
// (the stop card sends make_home with the move), so closing this leaves nothing
// behind.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { choicesMock } = vi.hoisted(() => ({ choicesMock: vi.fn() }))

vi.mock('@/hooks/queries/useHomeBinChoices', () => ({
  useHomeBinChoices: (...args: unknown[]) => choicesMock(...args),
}))

import { GiveHomeSheet } from '@/components/inventory/putaway/GiveHomeSheet'
import type { HomeBinChoice } from '@/services/supabase/homeBinHealthService'

const N1: HomeBinChoice = { binId: 6001, binCode: 'TST-WALK-N1', binName: 'TST-WALK Bay One' }
const N2: HomeBinChoice = { binId: 6002, binCode: 'TST-WALK-N2', binName: null }

function loaded(bins: HomeBinChoice[]) {
  choicesMock.mockReturnValue({ data: bins, isLoading: false, isError: false, error: null })
}

function mount() {
  const onChoose = vi.fn()
  const onClose = vi.fn()
  render(
    <GiveHomeSheet
      open
      warehouseId={2873}
      productId={77}
      sku="TST-WALK-200"
      recommendationId={901}
      onClose={onClose}
      onChoose={onChoose}
    />,
  )
  return { onChoose, onClose }
}

const FIELD = 'Scan or type the bin code'

function scan(code: string) {
  const input = screen.getByLabelText(FIELD)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  choicesMock.mockReset()
})

describe('GiveHomeSheet', () => {
  it('is titled with the product', () => {
    loaded([N1])
    mount()
    expect(screen.getByText('Give TST-WALK-200 a home bin')).toBeTruthy()
  })

  it("asks for the bins of this product, on this line's own terms, only while open", () => {
    loaded([N1])
    mount()
    expect(choicesMock).toHaveBeenCalledWith(2873, 77, true, 901)
  })

  it('a scanned code that is offered is chosen', () => {
    loaded([N1, N2])
    const { onChoose } = mount()
    scan('tst-walk-n2')

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(N2)
  })

  it('a scanned code that is not offered is refused with the copy', () => {
    loaded([N1, N2])
    const { onChoose } = mount()
    scan('TST-WALK-X9')

    expect(screen.getByRole('alert').textContent).toBe(
      "TST-WALK-X9 can't be this product's home. Pick one of the bins listed.",
    )
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('typing a code and pressing Make this its home chooses it', () => {
    loaded([N1, N2])
    const { onChoose } = mount()
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: ' tst-walk-n1 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make this its home' }))

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(N1)
  })

  it('typing a code that is not offered and pressing Make this its home refuses it', () => {
    loaded([N1])
    const { onChoose } = mount()
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: 'tst-walk-x9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make this its home' }))

    expect(screen.getByRole('alert').textContent).toBe(
      "TST-WALK-X9 can't be this product's home. Pick one of the bins listed.",
    )
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('picking from the dropdown and pressing Make this its home chooses it', () => {
    loaded([N1, N2])
    const { onChoose } = mount()
    fireEvent.change(screen.getByLabelText('Or pick a bin'), { target: { value: 'TST-WALK-N2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make this its home' }))

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(N2)
  })

  it('lists each bin as its code and its name, or the code alone when it has no name', () => {
    loaded([N1, N2])
    mount()
    const options = Array.from(screen.getByLabelText('Or pick a bin').querySelectorAll('option'))
      .map((o) => o.textContent)
    expect(options).toContain('TST-WALK-N1 — TST-WALK Bay One')
    expect(options).toContain('TST-WALK-N2')
  })

  it('does nothing until a bin is named', () => {
    loaded([N1])
    const { onChoose } = mount()
    const button = screen.getByRole('button', { name: 'Make this its home' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('prefers the typed code over the dropdown when both are filled', () => {
    loaded([N1, N2])
    const { onChoose } = mount()
    fireEvent.change(screen.getByLabelText('Or pick a bin'), { target: { value: 'TST-WALK-N2' } })
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: 'TST-WALK-N1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make this its home' }))

    expect(onChoose).toHaveBeenCalledWith(N1)
  })

  it('a refused code is cleared when a bin is picked from the list instead', () => {
    loaded([N1, N2])
    const { onChoose } = mount()
    scan('TST-WALK-X9')
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Or pick a bin'), { target: { value: 'TST-WALK-N1' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Make this its home' }))
    expect(onChoose).toHaveBeenCalledWith(N1)
  })

  it('says when no bin can be a home', () => {
    loaded([])
    const { onChoose } = mount()

    expect(screen.getByText('No bin in this warehouse can be its home right now.')).toBeTruthy()
    expect(screen.queryByLabelText(FIELD)).toBeNull()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('says it is loading rather than that no bin can be a home', () => {
    choicesMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null })
    mount()

    expect(screen.queryByText('No bin in this warehouse can be its home right now.')).toBeNull()
    expect(screen.getByText('Loading bins…')).toBeTruthy()
  })

  it("shows the server's words when the list could not be read", () => {
    choicesMock.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('Could not list bins for a home, try again.'),
    })
    mount()

    expect(screen.getByRole('alert').textContent).toBe('Could not list bins for a home, try again.')
    expect(screen.queryByText('No bin in this warehouse can be its home right now.')).toBeNull()
  })

  it('closes without choosing', () => {
    loaded([N1])
    const { onChoose, onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChoose).not.toHaveBeenCalled()
  })
})
