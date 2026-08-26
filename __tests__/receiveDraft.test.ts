// The staged shape of a goods receipt. Small surface, but `plateLabel` is what
// an operator reads to match a row on screen to the physical unit in front of
// them, and the numbering rule is the part that is easy to get subtly wrong.

import { describe, expect, it } from 'vitest'
import {
  newDraft,
  newMixedPlate,
  newPlate,
  plateLabel,
  type DraftPlate,
} from '@/components/inventory/receive/receiveDraft'

describe('plate identity', () => {
  it('mints a unique key every time, which is what makes the payload safe', () => {
    // Lines name their plate by key, and `receive-stock`'s `createPlates`
    // rejects the WHOLE receipt on a plate_key it was not given — so two plates
    // sharing a key would fail a real delivery at the dock.
    const keys = [newPlate(), newPlate(), newMixedPlate(), newPlate('carton')].map((p) => p.key)
    expect(new Set(keys).size).toBe(4)
  })

  it('defaults an ordinary plate to a pallet, and honours an explicit carton', () => {
    expect(newPlate().huType).toBe('pallet')
    expect(newPlate('carton').huType).toBe('carton')
  })

  it('makes a mixed plate a pallet, and marks it as mixed', () => {
    // A carton holds one product, so a "mixed carton" names nothing on a real
    // dock. The card carries no type selector for exactly this reason.
    const plate = newMixedPlate()
    expect(plate.huType).toBe('pallet')
    expect(plate.mixed).toBe(true)
  })

  it('does not mark an ordinary plate as mixed', () => {
    expect(newPlate().mixed).toBeFalsy()
  })
})

describe('plateLabel', () => {
  it('names an ordinary plate by its type and position', () => {
    const plates: DraftPlate[] = [newPlate('pallet'), newPlate('carton')]
    expect(plateLabel(plates, plates[0].key)).toBe('Pallet 1')
    expect(plateLabel(plates, plates[1].key)).toBe('Carton 2')
  })

  it('numbers mixed pallets among THEMSELVES, not among all plates', () => {
    // The operator counts the pallets they built. The first mixed pallet has to
    // read "Mixed pallet 1" whether or not six ordinary lines were keyed in
    // ahead of it, because that is the label they say out loud beside it.
    const a = newPlate()
    const b = newPlate()
    const first = newMixedPlate()
    const c = newPlate()
    const second = newMixedPlate()
    const plates = [a, b, first, c, second]

    expect(plateLabel(plates, first.key)).toBe('Mixed pallet 1')
    expect(plateLabel(plates, second.key)).toBe('Mixed pallet 2')
    // …and the ordinary plates keep counting by absolute position.
    expect(plateLabel(plates, c.key)).toBe('Pallet 4')
  })

  it('falls back rather than throwing on a key it does not hold', () => {
    // A line can outlive its plate for a render — the summary must still say
    // something rather than crash the whole receipt.
    expect(plateLabel([newPlate()], 'gone')).toBe('Plate')
  })
})

describe('newDraft', () => {
  it('binds the line to its plate and starts every field empty', () => {
    const plate = newPlate()
    const line = newDraft(plate.key)
    expect(line.plateKey).toBe(plate.key)
    expect(line.productId).toBeNull()
    expect(line.quantity).toBe('')
    expect(line.uomId).toBeNull()
    expect(line.quarantine).toBe(false)
  })

  it('inherits the delivery-wide hold, or "hold this delivery" stops applying', () => {
    // Including a line added by SCAN, which reaches the same helper.
    expect(newDraft(newPlate().key, true).quarantine).toBe(true)
  })

  it('gives each line its own key', () => {
    const plate = newPlate()
    expect(newDraft(plate.key).key).not.toBe(newDraft(plate.key).key)
  })
})
