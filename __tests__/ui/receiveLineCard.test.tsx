// The receipt line stopped being a 1100px table row and became a two-tier card
// below `xl`. That buys a usable screen on the RS35 and introduces exactly one
// new way to be wrong: a field the operator cannot see because it is collapsed.
//
// Hold is the field that matters. It decides whether the stock lands in
// quarantine or on the shelf, it lives in the collapsed tier, and an operator
// who cannot tell a held line from an ordinary one while scrolling a receipt is
// worse off than they were with the horizontal scroll. Most of what follows is
// about that.
//
// Note on what CANNOT be asserted here: jsdom applies no Tailwind, so `hidden`
// and `xl:contents` have no computed effect and `toBeVisible()` would pass for
// everything. The class list IS the mechanism, so it is asserted directly; the
// real rendering is checked in a browser at 360px.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReceiveLineCard, RECEIVE_ROW_COLUMNS } from '@/components/inventory/receive/ReceiveLineCard'
import { newDraft, newPlate, type DraftLine, type DraftPlate } from '@/components/inventory/receive/receiveDraft'
import type { Product } from '@/types'

afterEach(cleanup)

const plate: DraftPlate = newPlate('pallet')

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sku: 'AYM-COC-001', name: 'Coconut Milk', description: '', price: 1,
    category: 'Other', inventory: 0, available: 0, unit: 'each', cartonSize: 1,
    supplierId: 1,
    suppliers: [{ supplierId: 1, supplierSku: 'ACME-77', isPrimary: true, sortOrder: 0 }],
    ...overrides,
  } as Product
}

function renderCard(
  line: Partial<DraftLine> = {},
  onUpdate = vi.fn(),
  extra: { inGroup?: boolean; onSetPlateType?: (huType: 'pallet' | 'carton') => void } = {},
) {
  const draft: DraftLine = { ...newDraft(plate.key), productId: 1, ...line }
  const onSetPlateType = extra.onSetPlateType ?? vi.fn()
  const utils = render(
    <ReceiveLineCard
      line={draft}
      product={product()}
      supplierId={1}
      plates={[plate]}
      plateDestinationLabel={(hu) => (hu === 'pallet' ? 'Pallet — reserve' : 'Carton — pick face')}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
      onSetPlateType={onSetPlateType}
      inGroup={extra.inGroup}
    />,
  )
  return { ...utils, onUpdate, onSetPlateType, draft }
}

const toggle = () => screen.getByRole('button', { name: /lot, expiry, barcode/i })

describe('the always-visible tier', () => {
  it('shows the product, its SKU and the supplier part number', () => {
    renderCard()
    expect(screen.getByText('Coconut Milk')).toBeTruthy()
    expect(screen.getByText(/AYM-COC-001/)).toBeTruthy()
    expect(screen.getByText(/their ACME-77/)).toBeTruthy()
  })

  it('puts quantity where it never needs a tap to reach', () => {
    // The one field of the eight that must never be behind the disclosure.
    renderCard()
    expect(screen.getByPlaceholderText('0')).toBeTruthy()
  })

  it('keeps remove reachable while collapsed', () => {
    renderCard()
    expect(screen.getByRole('button', { name: 'Remove line' })).toBeTruthy()
  })
})

describe('the disclosure', () => {
  it('starts collapsed', () => {
    renderCard()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens and closes', () => {
    renderCard()
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('hides the secondary tier when narrow and flattens it into cells when wide', () => {
    // `hidden` is what collapses it; `contents` at the container width is what
    // makes the SAME nodes become grid cells of the row, which is the whole
    // reason there is one render here rather than two.
    //
    // A CONTAINER query, not a viewport breakpoint: the row's own container is
    // ~283px narrower than the viewport once the sidebar and page padding are
    // taken out, and encoding the measured 1180px as `xl:` (1280px viewport)
    // starved the product column to 0px on an ordinary laptop.
    const { container } = renderCard()
    // getElementById, not querySelector: React's useId emits ids like `:r0:`,
    // which are not valid CSS selectors without escaping.
    const details = container.ownerDocument.getElementById(
      toggle().getAttribute('aria-controls')!,
    )!
    expect(details.className).toContain('hidden')
    expect(details.className).toContain('@min-[1180px]:contents')

    fireEvent.click(toggle())
    expect(details.className).toContain('grid')
    expect(details.className).not.toMatch(/(^|\s)hidden(\s|$)/)
  })

  it('leaves every secondary control in the DOM and labelled at both widths', () => {
    // They are only ever hidden by CSS, never unmounted — so a scan, a screen
    // reader or a form submit finds the same controls at any width.
    renderCard()
    for (const name of [
      /Lot code for line/i,
      /Expiry for line/i,
      /Batch barcode for line/i,
      /Arrived on, for line/i,
      /Quarantine line/i,
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy()
    }
  })
})

describe('nothing hides silently', () => {
  it('says Hold on the collapsed summary, and says it FIRST', () => {
    // The only one of the five with a consequence for the stock.
    renderCard({ quarantine: true })
    expect(toggle().textContent).toMatch(/^Hold/)
  })

  it('does not say Hold when the line is not held', () => {
    renderCard({ quarantine: false })
    expect(toggle().textContent).not.toMatch(/Hold/)
  })

  it('tints a held line so it is recognisable while scrolling past', () => {
    const { container } = renderCard({ quarantine: true })
    expect(container.firstElementChild!.className).toContain('bg-amber-50')
  })

  it('does not tint an ordinary line', () => {
    const { container } = renderCard({ quarantine: false })
    expect(container.firstElementChild!.className).not.toContain('bg-amber-50')
  })

  it('names the plate the line will land on', () => {
    renderCard()
    expect(toggle().textContent).toMatch(/Pallet 1/)
  })

  it('surfaces a lot code, an expiry and a barcode that are set', () => {
    renderCard({ lotCode: 'L-4471', expiryDate: '2027-03-01', barcode: '9312345678907' })
    const text = toggle().textContent ?? ''
    expect(text).toMatch(/Lot L-4471/)
    expect(text).toMatch(/Exp 2027-03-01/)
    expect(text).toMatch(/Barcode set/)
  })

  it('ignores whitespace-only values rather than claiming they are set', () => {
    renderCard({ lotCode: '   ', barcode: '  ' })
    const text = toggle().textContent ?? ''
    expect(text).not.toMatch(/Lot/)
    expect(text).not.toMatch(/Barcode set/)
  })
})

describe('touch targets', () => {
  // Every control on this card gets pressed with a gloved thumb at a dock. The
  // batch barcode field was the worst offender: it used ScanField's `compact`
  // variant, which drops the 44px floor to py-1.5 AND suppresses the camera
  // button outright — on the one screen where someone is certainly holding a
  // barcode.
  it('gives the barcode field a full-height control, i.e. is not `compact`', () => {
    // ScanField picks exactly one of `py-1.5` (compact) or `min-h-[44px]`, so
    // the floor being present IS the proof the compact variant was dropped —
    // and with it the suppressed camera button, which jsdom cannot show either
    // way since it exposes neither BarcodeDetector nor getUserMedia.
    renderCard()
    expect(screen.getByLabelText(/Batch barcode for line/i).className).toContain('min-h-[44px]')
  })

  it('gives quantity, lot, expiry and the selects a 44px floor', () => {
    renderCard()
    for (const el of [
      screen.getByPlaceholderText('0'),
      screen.getByLabelText(/Lot code for line/i),
      screen.getByLabelText(/Expiry for line/i),
      screen.getByLabelText(/Arrived on, for line/i),
    ]) {
      expect(el.className).toContain('min-h-[44px]')
    }
  })

  it('wraps the Hold checkbox in a full-height label instead of a 16px box', () => {
    renderCard()
    const label = screen.getByLabelText(/Quarantine line/i).closest('label')!
    expect(label.className).toContain('min-h-[44px]')
  })
})

describe('editing', () => {
  it('reports a quantity change', () => {
    const { onUpdate } = renderCard()
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } })
    expect(onUpdate).toHaveBeenCalledWith({ quantity: '12' })
  })

  it('reports a hold toggle', () => {
    const { onUpdate } = renderCard()
    fireEvent.click(screen.getByLabelText(/Quarantine line/i))
    expect(onUpdate).toHaveBeenCalledWith({ quarantine: true })
  })
})

// ── THE REPORTED BUG ────────────────────────────────────────────────────────
//
// This cell used to stack a plate PICKER over a TYPE selector. It read specific
// → general while the data ran general → specific: the type select's value came
// off the PLATE, not the line, so on a shared plate changing one line silently
// retyped every sibling. One select, and a normal line owning its plate
// one-for-one, is what removes the whole class.

describe('arrived on', () => {
  it('offers ONE select, not the old picker-over-type pair', () => {
    renderCard()
    expect(screen.getAllByLabelText(/Arrived on, for line/i)).toHaveLength(1)
    // The plate picker and its "+ New unit…" escape hatch are gone: sharing a
    // plate is what the mixed-pallet card is for.
    expect(screen.queryByLabelText(/Pallet or carton for line/i)).toBeNull()
    expect(screen.queryByLabelText(/Unit type for line/i)).toBeNull()
    expect(screen.queryByText(/New unit/i)).toBeNull()
  })

  it('reads its value from the line own plate, and offers both types', () => {
    renderCard()
    const select = screen.getByLabelText(/Arrived on, for line/i) as HTMLSelectElement
    expect(select.value).toBe('pallet')
    expect([...select.options].map((o) => o.value)).toEqual(['pallet', 'carton'])
  })

  it('shows where each type is USUALLY steered, phrased as a prediction', () => {
    // The destination is the level-role routing (mig 00081), not a decision the
    // operator is making here — putaway may place this anywhere.
    renderCard()
    const select = screen.getByLabelText(/Arrived on, for line/i)
    expect(select.textContent).toMatch(/Pallet — reserve/)
    expect(select.textContent).toMatch(/Carton — pick face/)
  })

  it('reports a type change for THIS line only', () => {
    const onSetPlateType = vi.fn()
    renderCard({}, vi.fn(), { onSetPlateType })
    fireEvent.change(screen.getByLabelText(/Arrived on, for line/i), {
      target: { value: 'carton' },
    })
    expect(onSetPlateType).toHaveBeenCalledWith('carton')
    expect(onSetPlateType).toHaveBeenCalledTimes(1)
  })
})

describe('inside a mixed pallet', () => {
  // The container owns the type. A member line offering the choice would let one
  // line claim to have arrived as a carton while sharing a pallet with three
  // others — the same contradiction the old shared-plate dropdown produced.
  it('withholds the Arrived on select', () => {
    renderCard({}, vi.fn(), { inGroup: true })
    expect(screen.queryByLabelText(/Arrived on, for line/i)).toBeNull()
  })

  it('keeps every other field, because a SKU on a mixed pallet still has a lot', () => {
    renderCard({}, vi.fn(), { inGroup: true })
    for (const name of [
      /Lot code for line/i,
      /Expiry for line/i,
      /Batch barcode for line/i,
      /Quarantine line/i,
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy()
    }
    expect(screen.getByPlaceholderText('0')).toBeTruthy()
  })

  it('drops the plate from the collapsed summary — the card header names it', () => {
    renderCard({ lotCode: 'L-9', inGroup: undefined } as Partial<DraftLine>, vi.fn(), {
      inGroup: true,
    })
    const text = toggle().textContent ?? ''
    expect(text).toMatch(/Lot L-9/)
    expect(text).not.toMatch(/Pallet 1/)
  })

  it('still says Hold, which has a consequence for the stock either way', () => {
    renderCard({ quarantine: true }, vi.fn(), { inGroup: true })
    expect(toggle().textContent).toMatch(/^Hold/)
  })
})

describe('tooltips', () => {
  // The dock device is a CipherLab RS35, which has no pointer to hover with —
  // so every hint has to be reachable by press and by keyboard.
  it('explains Arrived on, Hold, and each of lot / expiry / barcode', () => {
    renderCard()
    for (const name of [
      /What does Arrived on mean/i,
      /What does Hold do/i,
      /What is a lot code/i,
      /What is the expiry for/i,
      /What is this barcode for/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('says arrival is not a storage decision, which is the whole point', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /What does Arrived on mean/i }))
    expect(screen.getByRole('tooltip').textContent).toMatch(/not a storage decision/i)
  })

  it('does not answer to the disclosure selector the mobile suite uses', () => {
    // `tests/e2e/mobile/receive-stock.spec.ts` finds the line disclosure with
    // `button[aria-expanded][aria-controls]`. A tooltip is described-by, not a
    // disclosure, so it must never match — or `.first()` picks a hint instead.
    const { container } = renderCard()
    const matches = container.querySelectorAll('button[aria-expanded][aria-controls]')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe(toggle())
  })
})

// ── THE COLUMN TEMPLATE IS CONTAINER-SCOPED, NOT VIEWPORT-SCOPED ────────────
//
// jsdom applies no Tailwind and computes no layout, so the only thing that can
// be asserted here is the class string. That is enough, because the bug was in
// the class string: the row needs 1180px of its OWN CONTAINER, and encoding
// that as `xl:` (a 1280px VIEWPORT) was wrong by the width of the sidebar --
// the container is ~283px narrower than the viewport, so at 1280 the product
// column computed to 0px and the row overflowed.
//
// The real behaviour is verified in a browser by forcing the container width
// and reading `gridTemplateColumns`; this guards the decision from being
// quietly reverted to a breakpoint that looks equivalent and is not.

describe('the row responds to its container, not the viewport', () => {
  it('scopes the eight-column template to a container query at the measured width', () => {
    expect(RECEIVE_ROW_COLUMNS).toContain('@min-[1180px]:grid-cols-')
    expect(RECEIVE_ROW_COLUMNS).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/)
  })

  it('keeps all eight columns in the template', () => {
    // Product, Qty, Lot code, Expiry, Barcode, Arrived on, Hold, remove.
    const inside = RECEIVE_ROW_COLUMNS.slice(
      RECEIVE_ROW_COLUMNS.indexOf('[', RECEIVE_ROW_COLUMNS.indexOf('grid-cols-')) + 1,
      RECEIVE_ROW_COLUMNS.lastIndexOf(']'),
    )
    expect(inside.split('_')).toHaveLength(8)
  })

  it('uses no viewport breakpoint anywhere on the row', () => {
    // Every layout class on this card has to switch on the same signal, or the
    // header row and the cells beneath it can disagree about which layout is
    // showing -- which is a misaligned grid, not a graceful degradation.
    const { container } = renderCard()
    const classes = [...container.querySelectorAll('*')]
      .flatMap((el) => (el.getAttribute('class') || '').split(/\s+/))
      .filter(Boolean)
    expect(classes.filter((c) => /^(sm|md|lg|xl|2xl):/.test(c))).toEqual([])
  })
})
