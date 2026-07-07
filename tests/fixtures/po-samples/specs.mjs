// Purchase-order document specs shared by the on-disk generator (generate.mjs)
// and the live injector (inject.mjs). Each spec is the content of one PO
// document; the injector wraps specs in email envelopes and adds footer images.
//
// Product references use real seeded AYM catalog names/SKUs (see constants.ts)
// so the resolver's deterministic + fuzzy paths have something to match.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// Real Young & Jacksons logo (fetched from their site) — drawn on the PO letterhead.
const YJ_LOGO = resolve(HERE, 'young-jacksons-logo.png')

/** Exact AYM SKUs + a real customer → high-confidence auto-approve path. */
export const GRAND_HOTEL = {
  company: 'THE GRAND HOTEL',
  tagline: 'Hospitality Group · Sydney',
  addressLines: ['123 Luxury Ave', 'Sydney NSW 2000', 'orders@grandhotelsydney.com.au'],
  poNumber: 'GH-2026-0712',
  orderDate: '2026-05-19',
  requestedDate: '2026-05-23',
  buyer: 'Charles Lim · Procurement',
  shipTo: ['The Grand Hotel', '123 Luxury Ave', 'Sydney NSW 2000'],
  notes: 'Standard weekly order. Please deliver to loading dock B between 6:30am–9:00am.',
  lines: [
    { code: 'AYM-COC-003', name: 'Coconut Milk 400ml', qty: 12, uom: 'cans', pack: '1 carton (12)' },
    { code: 'AYM-CUR-001', name: 'Thai Red Curry Paste 195g', qty: 6, uom: 'jars', pack: '1 carton (6)' },
    { code: 'AYM-SAU-001', name: 'Oyster Sauce 210ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: 'AYM-SAU-004', name: 'Fish Sauce 210ml', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
  ],
}

/** Customer-side codes + free text → per-line AI fuzzy matching. */
export const LOTUS_GARDEN = {
  company: 'LOTUS GARDEN RESTAURANT',
  tagline: 'Chinatown · Sydney',
  addressLines: ['12 Dixon St', 'Chinatown NSW 2000', 'kitchen@lotusgarden.com.au'],
  poNumber: 'LG-PO-558',
  orderDate: '2026-05-21',
  requestedDate: '2026-05-26',
  buyer: 'Mei Tan · Head Chef',
  shipTo: ['Lotus Garden Restaurant', '12 Dixon St', 'Chinatown NSW 2000'],
  notes: 'Please deliver via the rear lane entrance. Call kitchen on arrival.',
  lines: [
    { code: 'LG-301', name: 'Coconut milk small can', qty: 24, uom: 'cans', pack: '2 cartons (12)' },
    { code: 'LG-302', name: 'Coconut milk big can', qty: 12, uom: 'cans', pack: '1 carton (12)' },
    { code: 'LG-501', name: 'Green curry paste', qty: 12, uom: 'jars', pack: '2 cartons (6)' },
    { code: 'LG-501-R', name: 'Red curry paste', qty: 6, uom: 'jars', pack: '1 carton (6)' },
    { code: 'LG-701', name: 'Fish sauce big', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: 'LG-702', name: 'Light soy sauce', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
    { code: 'LG-901', name: 'Rice noodles', qty: 6, uom: 'packets', pack: '1 carton (12)' },
    { code: 'LG-OTH', name: 'Sweet corn 425g', qty: 12, uom: 'cans', pack: '1 carton (12)' },
  ],
}

/** Free-text descriptions, no customer codes → description-based matching. */
export const SPICE_ROOM = {
  company: 'THE SPICE ROOM',
  tagline: 'Modern Indian Kitchen · Melbourne',
  addressLines: ['88 Chapel St', 'Melbourne VIC 3141', 'procurement@thespiceroom.com.au'],
  poNumber: 'SR-04-2026',
  orderDate: '2026-05-19',
  requestedDate: '2026-05-30',
  buyer: 'Priya Iyer · Operations Manager',
  shipTo: ['The Spice Room', '88 Chapel St', 'Melbourne VIC 3141'],
  notes:
    'Please split this delivery — half by 30 May, the remainder by 6 June. Kitchen door access only between 10am and 2pm.',
  lines: [
    { code: '', name: 'Satay Sauce 250ml', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
    { code: '', name: 'Sweet Chilli Sauce 435ml', qty: 18, uom: 'bottles', pack: '3 cartons (6)' },
    { code: '', name: 'Oyster Sauce 210ml', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
    { code: '', name: 'Fish Sauce 420ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: '', name: 'Rice Noodles 200g', qty: 24, uom: 'packets', pack: '2 cartons (12)' },
    { code: '', name: 'Coconut Milk 400ml', qty: 12, uom: 'cans', pack: '1 carton (12)' },
    { code: '', name: 'Light Soy Sauce 210ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
  ],
}

/** Real customer (Harbour View Café), exact product names → image/vision path. */
export const HARBOUR_VIEW_IMAGE = {
  company: 'HARBOUR VIEW CAFÉ',
  tagline: 'Circular Quay · Sydney',
  addressLines: ['5 Circular Quay', 'Sydney NSW 2000', 'hello@harbourviewcafe.com.au'],
  poNumber: 'HV-2026-031',
  orderDate: '2026-05-20',
  requestedDate: '2026-05-24',
  buyer: 'Tom Reeves · Café Manager',
  shipTo: ['Harbour View Café', '5 Circular Quay', 'Sydney NSW 2000'],
  notes: 'Scanned from our order pad — please confirm by reply.',
  lines: [
    { code: '', name: 'Coconut Milk 400ml', qty: 12, uom: 'cans', pack: '1 carton (12)' },
    { code: '', name: 'Thai Green Curry Paste 195g', qty: 6, uom: 'jars', pack: '1 carton (6)' },
    { code: '', name: 'Sweet Chilli Sauce 435ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
  ],
}

/** Company not in the HoReCa catalog → customer unresolved → needs_review. */
export const ZENITH_UNKNOWN = {
  company: 'ZENITH CATERING CO',
  tagline: 'Event Catering · Brisbane',
  addressLines: ['200 River Tce', 'Brisbane QLD 4000', 'buying@zenithcatering.example'],
  poNumber: 'ZC-9001',
  orderDate: '2026-05-18',
  requestedDate: '2026-05-25',
  buyer: 'Dana Whitfield · Buyer',
  shipTo: ['Zenith Catering Co', '200 River Tce', 'Brisbane QLD 4000'],
  notes: 'New supplier trial order.',
  lines: [
    { code: 'ZC-11', name: 'Coconut Milk 400ml', qty: 24, uom: 'cans', pack: '2 cartons (12)' },
    { code: 'ZC-12', name: 'Oyster Sauce 210ml', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
  ],
}

// Known customer (Grand Hotel) but line items absent from the AYM catalog
// (which is coconut / curry pastes / Asian sauces / noodles). Realistic grocery
// items so the classifier still recognises a PO, yet none resolve to a product.
export const GRAND_HOTEL_BOGUS = {
  ...GRAND_HOTEL,
  poNumber: 'GH-2026-0799',
  notes: 'Please supply the following Japanese pantry items for the degustation menu.',
  lines: [
    { code: 'JP-101', name: 'Wasabi Paste 200g', qty: 6, uom: 'tubes', pack: '1 carton (6)' },
    { code: 'JP-102', name: 'White Miso Paste 500g', qty: 4, uom: 'tubs', pack: '1 carton (4)' },
    { code: 'JP-103', name: 'Tempura Flour 1kg', qty: 8, uom: 'bags', pack: '2 cartons (4)' },
    { code: 'JP-104', name: 'Nori Seaweed Sheets 100pk', qty: 3, uom: 'packs', pack: '1 carton (3)' },
  ],
}

// ============================================================================
// Demo set (live-demo handout — see DEMO.md). Complete, clean, exact in-stock
// SKUs so the auto-approve pair clears the ≥0.95 confidence gate. Both auto POs
// are The Grand Hotel so a single trusted sender (dulshan37gt@gmail.com,
// registered via demo-seed) resolves + trusts them.
// ============================================================================

/** Auto-approve #1 (PDF). */
export const GRAND_HOTEL_DEMO_PDF = {
  company: 'THE GRAND HOTEL',
  tagline: 'Hospitality Group · Sydney',
  addressLines: ['123 Luxury Ave', 'Sydney NSW 2000', 'orders@grandhotelsydney.com.au'],
  poNumber: 'GH-DEMO-001',
  orderDate: '2026-06-02',
  requestedDate: '2026-06-06',
  buyer: 'Charles Lim · Procurement',
  shipTo: ['The Grand Hotel', 'Loading Dock B', '123 Luxury Ave', 'Sydney NSW 2000'],
  notes: 'Standard weekly order. Deliver to loading dock B between 6:30am–9:00am.',
  lines: [
    { code: 'AYM-COC-003', name: 'Coconut Milk 400ml', qty: 12, uom: 'cans', pack: '1 carton (12)' },
    { code: 'AYM-SAU-001', name: 'Oyster Sauce 210ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: 'AYM-SAU-004', name: 'Fish Sauce 210ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: 'AYM-CHL-001', name: 'Sweet Chilli Sauce 435ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
  ],
}

/** Auto-approve #2 (Word/DOCX) — same customer, different PO + items. */
export const GRAND_HOTEL_DEMO_DOCX = {
  ...GRAND_HOTEL_DEMO_PDF,
  poNumber: 'GH-DEMO-002',
  orderDate: '2026-06-02',
  requestedDate: '2026-06-09',
  notes: 'Top-up order for the function centre. Same delivery window as our standing order.',
  lines: [
    { code: 'AYM-SOY-001', name: 'Light Soy Sauce 210ml', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
    { code: 'AYM-NOO-001', name: 'Rice Noodles 200g', qty: 12, uom: 'packets', pack: '1 carton (12)' },
    { code: 'AYM-SAT-001', name: 'Satay Sauce 250ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: 'AYM-CUR-001', name: 'Thai Red Curry Paste 195g', qty: 6, uom: 'jars', pack: '1 carton (6)' },
  ],
}

/** Needs-review (image/vision) — real customer, but one line is a non-catalog
 *  item, so that line stays unresolved and the PO routes to review. */
export const CAFE_DEMO_IMAGE = {
  company: 'LOTUS GARDEN RESTAURANT',
  tagline: 'Chinatown · Sydney',
  addressLines: ['12 Dixon St', 'Chinatown NSW 2000', 'kitchen@lotusgarden.com.au'],
  poNumber: 'LG-DEMO-013',
  orderDate: '2026-06-02',
  requestedDate: '2026-06-05',
  buyer: 'Mei Tan · Head Chef',
  shipTo: ['Lotus Garden Restaurant', '12 Dixon St', 'Chinatown NSW 2000'],
  notes: 'Scanned from the order pad — rear lane delivery please.',
  lines: [
    { code: '', name: 'Coconut Milk 400ml', qty: 12, uom: 'cans', pack: '1 carton (12)' },
    { code: '', name: 'Light Soy Sauce 210ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
    { code: '', name: 'House-made Chilli Oil 1L', qty: 4, uom: 'bottles', pack: '1 carton (4)' },
  ],
}

// ============================================================================
// V2food client demo — Young & Jacksons (Melbourne pub) orders V2food plant-
// based products. Both POs are emailed from the trusted sender
// (dulshanb@nexgeninnovations.com.au, registered by young-jacksons-seed.mjs);
// line codes are V2food SKUs aliased to the catalog (see constants.ts).
// ============================================================================

const YOUNG_JACKSONS_BASE = {
  company: 'YOUNG & JACKSONS',
  tagline: 'Established 1861 · Cnr Swanston & Flinders St, Melbourne',
  addressLines: ['Corner Swanston & Flinders Streets', 'Melbourne VIC 3000', 'orders@youngandjacksons.com.au'],
  buyer: 'Jordan Pike · Bar & Kitchen Manager',
  shipTo: ['Young & Jacksons', 'Cnr Swanston & Flinders St', 'Melbourne VIC 3000'],
  logoPath: YJ_LOGO,
}

/** Auto-approve — every line is a V2food SKU aliased + in stock → clears the gate. */
export const YOUNG_JACKSONS_AUTO = {
  ...YOUNG_JACKSONS_BASE,
  poNumber: 'YJ-2026-0617',
  orderDate: '2026-06-17',
  requestedDate: '2026-06-20',
  notes: 'Weekly plant-based order for the kitchen. Deliver to the Flinders St loading dock between 7–10am.',
  lines: [
    { code: 'V2F-MINCE-001', name: 'v2food Plant-Based Mince 1kg', qty: 6, uom: 'packs', pack: '1 carton (6)' },
    { code: 'V2F-BURG-001', name: 'v2food Plant-Based Burger Patties 1.13kg', qty: 4, uom: 'boxes', pack: '1 carton (4)' },
    { code: 'V2F-SCHN-001', name: 'v2food Plant-Based Schnitzel 1kg', qty: 6, uom: 'packs', pack: '1 carton (6)' },
  ],
}

/** Needs-review — everything matches a catalog SKU and the trusted sender resolves
 *  the customer, BUT the party-pie line over-orders (200 vs ~60 on hand). approve-po
 *  declines the auto-approval on the stock shortfall and leaves the PO in review with
 *  the "Short on stock" banner. (Party Pies / Tenders are absent from the auto PO, so
 *  the two POs stay independent.) */
export const YOUNG_JACKSONS_REVIEW = {
  ...YOUNG_JACKSONS_BASE,
  poNumber: 'YJ-2026-0618',
  orderDate: '2026-06-17',
  requestedDate: '2026-06-24',
  notes: 'Large function this weekend — note the party-pie volume. Please confirm availability before dispatch.',
  lines: [
    { code: 'V2F-PIES-001', name: 'v2food Plant-Based Party Pies 1kg', qty: 200, uom: 'packs', pack: 'bulk — function order' },
    { code: 'V2F-MINCE-001', name: 'v2food Plant-Based Mince 1kg', qty: 6, uom: 'packs', pack: '1 carton (6)' },
    { code: 'V2F-TEND-001', name: 'v2food Plant-Based Chicken-Style Tenders 1kg', qty: 6, uom: 'packs', pack: '1 carton (6)' },
  ],
}

/** Not-a-PO (plain-text email body) — classifier should skip it. */
export const NEWSLETTER_BODY = [
  'FOOD TRENDS WEEKLY — Issue 142',
  '',
  'Hello from Food Trends Weekly! This week:',
  '  • 5 plating trends sweeping fine dining',
  '  • A profile of a Melbourne pastry chef',
  '  • Our reader photo gallery',
  '',
  'Not a subscriber yet? Forward this to a friend and tell them to sign up.',
  'Unsubscribe any time from the link below.',
].join('\n')
