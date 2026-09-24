// scripts/demo-video/config.mjs
//
// Everything record.mjs needs to know that isn't "how to drive a browser":
// the four showcase POs, pacing constants, callout copy and banner steps.
// Kept separate so the storyboard in record.mjs reads as steps, not data.

/**
 * The four showcase POs, seeded by `npm run po-inject -- --showcase`
 * (tests/fixtures/po-samples/inject.mjs + specs.mjs, owned by another
 * agent). This file only needs to know how to FIND and TALK ABOUT them on
 * screen, not how they got into the queue.
 *
 * The task brief's original customer names (The Grand Hotel / The Spice
 * Room / Lotus Garden Restaurant) don't exist in the demo database as
 * rebuilt 2026-08-13 — see specs.mjs's "Showcase set" comment. The fixture
 * substitutes three of the current roster's HoReCas instead, and keeps the
 * brief's numeric PO suffixes with the prefix swapped to match:
 *   The Grand Hotel        -> Mountain Retreat Inn   (GH -> MR)
 *   The Spice Room         -> Seaside Bistro         (SR -> SB)
 *   Lotus Garden Restaurant -> Young & Jacksons       (LG -> YJ)
 *   Harbour View Café      -> Harbour View Café       (unchanged)
 */
export const SHOWCASE_POS = {
  A: {
    poNumber: 'MR-2409-117',
    customer: 'Mountain Retreat Inn',
    format: 'pdf',
    formatLabel: 'PDF attachment',
    outcome: 'auto_approved',
  },
  B: {
    poNumber: 'HV-2409-042',
    customer: 'Harbour View Café',
    format: 'email-body',
    formatLabel: 'PO in the email body',
    outcome: 'auto_approved',
  },
  C: {
    poNumber: 'SB-2409-310',
    customer: 'Seaside Bistro',
    format: 'fax-pdf',
    formatLabel: 'fax-styled scan',
    outcome: 'auto_approved',
  },
  D: {
    poNumber: 'YJ-2409-088',
    customer: 'Young & Jacksons',
    format: 'pdf',
    formatLabel: 'PDF attachment',
    outcome: 'needs_review',
    // The one deliberately-ambiguous line on this PO (specs.mjs
    // SHOWCASE_YOUNG_JACKSONS_REVIEW: code 'YJ-410', "Chilli sauce - big
    // bottle" — the AYM catalog carries nine 275/435ml chilli-sauce
    // variants, so this is genuinely ambiguous) and what the reviewer maps
    // it to. See resolveAmbiguousLine() in storyboard.mjs for the
    // interaction itself.
    ambiguousLineText: 'YJ-410 Chilli sauce - big bottle',
    resolvedProductText: 'Sweet Chilli Sauce 435ml',
    /** Picked by SKU: the search also returns "Ginger Sweet Chilli Sauce
     *  435ml" and "Thai Sweet Chilli Sauce 435ml" ahead of the plain one. */
    resolvedSku: 'AYM-CHL-001',
  },
}

/** Demo admin login (dev/demo host only — see LoginPage.tsx SHOW_DEMO_LOGINS). */
export const DEMO_ADMIN = {
  email: 'alice@nexorder.com.au',
  password: 'Password123!',
  role: 'Admin',
}

export const DEFAULT_BASE_URL = 'https://nexorder.vercel.app'
export const DEFAULT_OUT_DIR = 'demo-video-out'

export const VIEWPORT = { width: 1920, height: 1080 }
export const FPS = 30

/**
 * Pacing constants. The annotated cut runs slower and dwells longer on each
 * target so a callout has time to read — the silent cut is the same actions
 * at a brisker, still-human pace.
 */
export function pacing(annotated) {
  return {
    /** Fake-cursor travel time between two on-screen points. */
    cursorMoveMs: annotated ? 1000 : 800,
    /** Pause after the cursor arrives, before it "clicks". */
    preClickMs: annotated ? 320 : 280,
    /** Pause after a click before the next action starts. */
    postClickMs: annotated ? 800 : 700,
    /** How long a callout stays on screen (also blocks the storyboard, so
     *  the paced action underneath it doesn't race ahead of the video). */
    calloutMs: annotated ? 4200 : 0,
    /** Extra dwell on a newly-opened panel/modal before the next action. */
    settleMs: annotated ? 1400 : 2200,
    /** How long an opened source document stays on screen (the guided cut's
     *  callout adds its own time on top). */
    docDwellMs: annotated ? 2500 : 7000,
    /** Smooth-scroll duration used by scrollIntoViewSmooth(). */
    scrollMs: annotated ? 700 : 600,
  }
}

/** Callout copy for the guided cut. Each key names the step in record.mjs
 *  that fires it, purely for readability — nothing here is looked up
 *  dynamically by key. */
export const CALLOUTS = {
  orderImport: {
    title: 'Order Import',
    text: 'All four POs are now orders — three untouched by a person, one checked in seconds.',
    side: 'left',
  },
  inboxOverview: {
    title: 'PO Inbox',
    text: 'Orders arrive from anywhere — PDF, email, fax.',
    side: 'bottom',
  },
  sourcePdf: {
    title: 'Source: PDF',
    text: 'AI reads the PDF: customer, lines, quantities.',
    side: 'right',
  },
  sourceEmailBody: {
    title: 'Source: email body',
    text: 'No attachment? It reads the email itself.',
    side: 'right',
  },
  sourceFax: {
    title: 'Source: fax',
    text: 'Faxed order — scanned image, still read.',
    side: 'right',
  },
  autoApprovedRow: {
    title: 'Auto-approved',
    text: '100% match: customer ✓ every product ✓ trusted sender ✓ → approved automatically.',
    side: 'top',
  },
  needsReviewRow: {
    title: 'Needs review',
    text: 'Anything uncertain is flagged for a person.',
    side: 'top',
  },
  mapLine: {
    title: 'One click to fix',
    text: 'One click maps the line — then approve.',
    side: 'top',
  },
  erpQueue: {
    title: 'Parked for your ERP',
    text: 'Approved orders are parked in a standard file for your ERP / accounting system to pick up.',
    side: 'top',
  },
}

/** Step-banner copy, shown bottom-left throughout the guided cut. */
export const BANNER_STEPS = {
  arrive: '1 · Orders arrive',
  validate: '2 · AI validates',
  parked: '3 · Parked for your ERP',
}

/** The mock ERP page is served from a neutral, non-existent host via
 *  page.route() so it never collides with a real site and never needs a
 *  local dev server. */
export const ERP_MOCK_ORIGIN = 'https://erp.example.local'
export const ERP_MOCK_URL = `${ERP_MOCK_ORIGIN}/order-import`

/**
 * Data for the mock ERP's "Ready to import" table. Plausible-but-fixed
 * values rather than scraped from the live run — the real orders' totals
 * depend on catalogue prices the other agent's fixtures own, and a pure
 * render of known-good data is more reliable on camera than a best-effort
 * scrape of a UI whose exact numbers this script doesn't control.
 */
export function buildErpOrders() {
  const today = new Date().toISOString().slice(0, 10)
  // Line items mirror specs.mjs's SHOWCASE_* fixtures (same SKUs/products,
  // plausible AUD prices) so what's on the parked file matches what the
  // earlier beats of the video showed on the actual PO.
  return [
    {
      poNumber: SHOWCASE_POS.A.poNumber,
      customer: SHOWCASE_POS.A.customer,
      orderDate: today,
      totalExGst: 468.6,
      receivedAgo: '4 min ago',
      lines: [
        { sku: 'AYM-COC-003', description: 'Coconut Milk 400ml', qty: 12, unitPrice: 3.2 },
        { sku: 'AYM-SAU-001', description: 'Oyster Sauce 210ml', qty: 12, unitPrice: 5.1 },
        { sku: 'AYM-SAU-004', description: 'Fish Sauce 210ml', qty: 12, unitPrice: 5.4 },
        { sku: 'AYM-CHL-001', description: 'Sweet Chilli Sauce 435ml', qty: 12, unitPrice: 6.75 },
        { sku: 'AYM-CUR-005', description: 'Thai Panang Curry Paste 195g', qty: 6, unitPrice: 7.9 },
      ],
    },
    {
      poNumber: SHOWCASE_POS.B.poNumber,
      customer: SHOWCASE_POS.B.customer,
      orderDate: today,
      totalExGst: 172.8,
      receivedAgo: '3 min ago',
      lines: [
        { sku: 'AYM-COC-002', description: 'Coconut Milk 270ml', qty: 12, unitPrice: 2.6 },
        { sku: 'AYM-SOY-001', description: 'Light Soy Sauce 210ml', qty: 6, unitPrice: 4.8 },
        { sku: 'AYM-CHL-001', description: 'Thai Sweet Chilli Sauce 435ml', qty: 6, unitPrice: 6.75 },
        { sku: 'AYM-SAT-001', description: 'Satay Sauce 250ml', qty: 6, unitPrice: 5.9 },
      ],
    },
    {
      poNumber: SHOWCASE_POS.C.poNumber,
      customer: SHOWCASE_POS.C.customer,
      orderDate: today,
      totalExGst: 213.9,
      receivedAgo: '2 min ago',
      lines: [
        { sku: 'AYM-SAU-001', description: 'Oyster Sauce 210ml', qty: 6, unitPrice: 5.1 },
        { sku: 'AYM-CUR-001', description: 'Thai Red Curry Paste 195g', qty: 6, unitPrice: 7.4 },
        { sku: 'AYM-SOY-004', description: 'Dark Soy Sauce 210ml', qty: 6, unitPrice: 4.9 },
        { sku: 'AYM-NOO-001', description: 'Rice Noodles 200g', qty: 6, unitPrice: 3.1 },
        { sku: 'AYM-CUR-007', description: 'Malaysian Rendang Curry Paste 185g', qty: 6, unitPrice: 8.2 },
      ],
    },
    {
      poNumber: SHOWCASE_POS.D.poNumber,
      customer: SHOWCASE_POS.D.customer,
      orderDate: today,
      totalExGst: 134.1,
      receivedAgo: 'just now',
      lines: [
        { sku: 'AYM-SAU-004', description: 'Fish Sauce 210ml', qty: 6, unitPrice: 5.4 },
        { sku: 'AYM-CUR-004', description: 'Thai Massaman Curry Paste 195g', qty: 6, unitPrice: 7.6 },
        { sku: 'AYM-NOO-003', description: 'Rice Noodle Nests 300g', qty: 6, unitPrice: 3.3 },
        { sku: 'AYM-CHL-001', description: SHOWCASE_POS.D.resolvedProductText, qty: 6, unitPrice: 6.75 },
      ],
    },
  ]
}
