// Cookie-cutter Tridon hardware-demo PO specs.
//
// Two purchase orders that Sydney Tools "emails" to the Tridon PO Inbox during a
// live demo. Both come FROM the same trusted sender (see seed.mjs → DEMO_SENDER),
// so both resolve to the Sydney Tools customer and clear the sender-trust gate.
// The auto PO's lines are all seeded SKUs → it AUTO-APPROVES. The review PO adds
// one brand-new tool that isn't in the catalog → that line can't map to a product
// → the PO is held for NEEDS_REVIEW.
//
// Spec shape matches tests/fixtures/po-samples/specs.mjs (rendered by the shared
// renderPdf in ../tests/fixtures/po-samples/render.mjs):
//   { company, tagline, addressLines, poNumber, orderDate, requestedDate, buyer,
//     shipTo, notes, logoPath, lines:[{ code, name, qty, uom, pack }] }
//
// The line `code`s below are the Sydney Tools part numbers seeded by seed.mjs
// (identical SKUs to tests/fixtures/po-samples/sydney-tools-seed.mjs). Keep the
// AUTO lines a subset of the seeded SKUs, and keep REVIEW_UNKNOWN_CODE absent
// from the catalog, or the review PO would stop flagging.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// Tridon letterhead branding, drawn top-right on the PO PDF.
const TRIDON_LOGO = resolve(HERE, '../public/assets/tridon-logo.png')

const SYDNEY_TOOLS_BASE = {
  company: 'SYDNEY TOOLS',
  tagline: 'Trade Tools & Equipment · Wollongong NSW',
  addressLines: ['63 Flinders St', 'Wollongong NSW 2500', 'orders@sydneytools.com.au'],
  buyer: 'Ray Dawson · Purchasing',
  shipTo: ['Sydney Tools Wollongong', '63 Flinders St', 'Wollongong NSW 2500'],
  logoPath: TRIDON_LOGO,
}

/** The part code intentionally left OUT of the catalog so the review PO flags.
 *  seed.mjs actively guarantees no product/alias exists for this code. */
export const REVIEW_UNKNOWN_CODE = 'MILW-M18-FUEL-2767'

/** Auto-approve — every line is a seeded Sydney Tools SKU, in stock and aliased,
 *  so the PO clears the ≥0.95 confidence + all-lines-resolved gate. */
export const TRIDON_SYDNEY_AUTO = {
  ...SYDNEY_TOOLS_BASE,
  poNumber: 'ST-PO-88214',
  orderDate: '2026-07-01',
  requestedDate: '2026-07-04',
  notes: 'Weekly trade replenishment. Deliver to the Flinders St trade counter between 7–10am.',
  lines: [
    { code: '8801300SB', name: 'KNIPEX Pliers Alligator Multigrip 300mm', qty: 4, uom: 'each', pack: '1 each' },
    { code: '0201200SB', name: 'KNIPEX Combination Pliers Hi Leverage 200mm', qty: 6, uom: 'each', pack: '1 each' },
    { code: '7402200SB', name: 'KNIPEX Diagonal Cutters High Leverage 200mm', qty: 4, uom: 'each', pack: '1 each' },
    { code: '2612200SB', name: 'KNIPEX Needle Nose Pliers Stork Beak 200mm', qty: 6, uom: 'each', pack: '1 each' },
    { code: '309035', name: 'TOLEDO Tyre Lever 600mm', qty: 10, uom: 'each', pack: '1 each' },
    { code: '150B6', name: 'TOLEDO Rule Stainless Steel 150mm', qty: 12, uom: 'each', pack: '1 each' },
  ],
}

/** Needs-review — the first two lines are seeded SKUs (so the customer resolves
 *  and the sender is trusted), but the third is a brand-new tool that isn't in
 *  the catalog. That line can't map to a product, so all-lines-resolved fails and
 *  the PO is held for a human to map the new SKU. */
export const TRIDON_SYDNEY_REVIEW = {
  ...SYDNEY_TOOLS_BASE,
  poNumber: 'ST-PO-88231',
  orderDate: '2026-07-01',
  requestedDate: '2026-07-05',
  notes: 'Counter order — includes a new Milwaukee line we have not bought from you before.',
  lines: [
    { code: '8801300SB', name: 'KNIPEX Pliers Alligator Multigrip 300mm', qty: 4, uom: 'each', pack: '1 each' },
    { code: '321100', name: 'TOLEDO Air Blow Gun High Flow Safety 100mm', qty: 6, uom: 'each', pack: '1 each' },
    { code: REVIEW_UNKNOWN_CODE, name: 'Milwaukee M18 FUEL 1/2" High-Torque Impact Wrench', qty: 3, uom: 'each', pack: '1 each' },
  ],
}
