// NX-0050: "Not this product?" on a receive line.
//
// The label (barcode) on a carton said one product, but the carton holds
// another. The worker picks the real product; the line becomes that product,
// is held back (quarantine), its count is cleared so it is re-entered in the
// real product's units, and the line says what happened. Undo puts it back.
// Made-up products only.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReceiveLineCard } from '@/components/inventory/receive/ReceiveLineCard'
import { newDraft, newPlate, type DraftLine, type DraftPlate } from '@/components/inventory/receive/receiveDraft'
import type { Product } from '@/types'

afterEach(cleanup)

const plate: DraftPlate = newPlate('carton')

function product(o: Partial<Product>): Product {
  return {
    id: 1, sku: 'TST-CHL-200', name: 'Test Chilli Powder 200g', description: '', price: 1,
    category: 'Other', inventory: 0, available: 0, unit: 'each', cartonSize: 40,
    supplierId: 1, suppliers: [], barcode: '9999000000139', ...o,
  } as Product
}

const label = product({})
const real = product({ id: 2, sku: 'TST-GRK-100', name: 'Test Goraka 100g', cartonSize: 70, barcode: '9999000000511' })

function renderCard(line: Partial<DraftLine>, shown: Product, onUpdate = vi.fn()) {
  const draft: DraftLine = { ...newDraft(plate.key), productId: shown.id, quantity: '3', barcode: '', ...line }
  render(
    <ReceiveLineCard
      line={draft}
      product={shown}
      supplierId={1}
      plates={[plate]}
      plateDestinationLabel={() => 'Carton — pick face'}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
      onSetPlateType={vi.fn()}
      productPool={[label, real]}
      onChooseProduct={vi.fn()}
    />,
  )
  return { onUpdate, draft }
}

describe('ReceiveLineCard', () => {
  it('Not this product? swaps the line to the chosen product, holds it and says so', () => {
    const { onUpdate } = renderCard({}, label)
    fireEvent.click(screen.getByRole('button', { name: 'Not this product?' }))
    fireEvent.change(screen.getByLabelText('What is really in the carton'), { target: { value: 'Goraka' } })
    fireEvent.click(screen.getByRole('option', { name: /Test Goraka 100g/ }))

    expect(onUpdate).toHaveBeenCalledWith({
      productId: 2,
      quantity: '',
      uomId: null,
      quarantine: true,
      labelMismatch: {
        labelProductId: 1,
        labelSku: 'TST-CHL-200',
        scannedCode: '9999000000139',
        previous: { productId: 1, quantity: '3', uomId: null, quarantine: false },
      },
    })

    // The line as it now is: the real product, held, saying what the label said.
    cleanup()
    renderCard({
      productId: 2, quantity: '', quarantine: true,
      labelMismatch: {
        labelProductId: 1, labelSku: 'TST-CHL-200', scannedCode: '9999000000139',
        previous: { productId: 1, quantity: '3', uomId: null, quarantine: false },
      },
    }, real)
    expect(screen.getByText('Label says TST-CHL-200 — recorded as TST-GRK-100, held')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Not this product?' })).toBeNull()
  })

  it('Undo puts the line back as it was', () => {
    const { onUpdate } = renderCard({
      productId: 2, quantity: '2', quarantine: true,
      labelMismatch: {
        labelProductId: 1, labelSku: 'TST-CHL-200', scannedCode: '9999000000139',
        previous: { productId: 1, quantity: '3', uomId: null, quarantine: false },
      },
    }, real)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUpdate).toHaveBeenCalledWith({
      productId: 1, quantity: '3', uomId: null, quarantine: false, labelMismatch: undefined,
    })
  })
})
