// scripts/demo-video/storyboard.mjs
//
// The recorded flow (everything AFTER login.mjs's pre-roll, i.e. everything
// that ends up on camera). Written as a sequence of named steps matching the
// brief's ~2:00 beat sheet:
//
//   1. 0:00–0:35  Inbox overview, three source types (A/B/C)
//   2. 0:35–1:20  Auto Approved (A/B/C) vs Needs Review (D) + the D-fix
//   3. 1:20–2:00  Order Import tab (real), then parked for the ERP (mock)
//
// Selectors favour role/text over CSS wherever the component tree allows it
// (see components/admin/POInboxTab.tsx, POInboxDetailModal.tsx,
// ProductSearchDropdown.tsx) so this survives incidental className churn.

import { SHOWCASE_POS, CALLOUTS, BANNER_STEPS, ERP_MOCK_URL } from './config.mjs'
import { clickWithCursor, showCallout, setBanner, settle, dismissToasts } from './interact.mjs'
import { pacing } from './config.mjs'

const STATUS_NAV = 'nav[aria-label="PO status filter"]'

function filterTab(page, label) {
  return page.locator(STATUS_NAV).getByRole('button', { name: label })
}

/** Locate a queue row by the customer name it resolved to — stable across
 *  whatever exact subject line the fixture ends up using. */
function poRow(page, poKey) {
  const { customer } = SHOWCASE_POS[poKey]
  return page.getByRole('button').filter({ hasText: customer }).first()
}

async function openRow(page, poKey, opts) {
  await clickWithCursor(page, poRow(page, poKey), opts)
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })
  return dialog
}

/** Wait until the original document (PDF frame, image or email body) has
 *  actually rendered in the left pane, not the "Loading document…" spinner. */
async function waitForOriginal(page, dialog) {
  const original = dialog.locator('iframe[title="PO document"], img[alt="PO document"], pre, iframe[title="PO email body"]').first()
  await original.waitFor({ state: 'visible', timeout: 30_000 })
  await original.evaluate(el =>
    el.tagName === 'IMG' && !el.complete
      ? new Promise(res => el.addEventListener('load', res, { once: true }))
      : null,
  )
  // Chrome's PDF viewer paints a beat after the frame is visible.
  await page.waitForTimeout(2000)
  return original
}

async function closeDialog(page, dialog, opts) {
  await clickWithCursor(page, dialog.getByRole('button', { name: 'Close' }), opts)
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
}

/**
 * Young & Jacksons' one ambiguous line: raw code `YJ-410`, description
 * "Chilli sauce - big bottle" (specs.mjs SHOWCASE_YOUNG_JACKSONS_REVIEW).
 * The AYM catalog carries nine 275/435ml chilli-sauce variants, so
 * extract-po deliberately leaves this line unmatched rather than guessing —
 * that single line is the only reason this PO needs review at all.
 *
 * Finds the line by "product picker still unresolved" rather than by the
 * raw text, which is true by construction (the showcase has exactly one
 * unmatched line on this PO) and is robust to the fixture's copy changing
 * under this — the text-based match below is only a fallback. Searches the
 * FULL resolved product name (not just "Sweet Chilli") because a short
 * query would return more than one of the nine variants.
 */
async function resolveAmbiguousLine(page, dialog, opts) {
  const { resolvedProductText, ambiguousLineText } = SHOWCASE_POS.D
  const lineItems = dialog.locator('fieldset').filter({ hasText: 'Line items' }).locator('li')

  let target = lineItems.filter({ has: page.getByRole('button', { name: /^select product$/i }) }).first()
  if ((await target.count()) === 0) {
    const keyword = ambiguousLineText.replace(/^\S+\s*/, '').split(/\s+/)[0] // "Chilli" out of "YJ-410 Chilli sauce…"
    target = dialog.locator('fieldset li', { hasText: new RegExp(keyword, 'i') }).first()
  }

  await showCallout(page, target, CALLOUTS.mapLine, opts)

  const picker = target.getByRole('button', { name: /select product/i }).first()
  await clickWithCursor(page, picker, opts)

  const searchInput = page.getByPlaceholder('Search by SKU or name…')
  await searchInput.waitFor({ state: 'visible', timeout: 5_000 })
  await searchInput.pressSequentially(resolvedProductText, { delay: opts.annotated ? 55 : 35 })

  const option = page
    .getByRole('button', { name: new RegExp(escapeRegex(resolvedProductText), 'i') })
    .filter({ hasText: SHOWCASE_POS.D.resolvedSku })
    .first()
  await clickWithCursor(page, option, opts)
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ annotated: boolean }} runOpts
 */
export async function runStoryboard(page, runOpts) {
  const opts = { annotated: runOpts.annotated, first: true }
  const next = () => {
    opts.first = false
  }

  // ── Step 1 · Orders arrive (three sources) ──────────────────────────────
  await setBanner(page, BANNER_STEPS.arrive, opts)
  await showCallout(page, page.locator(STATUS_NAV), CALLOUTS.inboxOverview, opts)

  const autoApprovedTab = filterTab(page, 'Auto Approved')
  await clickWithCursor(page, autoApprovedTab, opts)
  next()
  await settle(page, opts)

  for (const [poKey, callout] of [
    ['A', CALLOUTS.sourcePdf],
    ['B', CALLOUTS.sourceEmailBody],
    ['C', CALLOUTS.sourceFax],
  ]) {
    const dialog = await openRow(page, poKey, opts)
    const original = await waitForOriginal(page, dialog)
    await showCallout(page, original, callout, opts)
    await page.waitForTimeout(pacing(opts.annotated).docDwellMs)
    await closeDialog(page, dialog, opts)
  }

  // ── Step 2 · AI validates (auto vs. needs review) ───────────────────────
  await setBanner(page, BANNER_STEPS.validate, opts)
  await showCallout(page, poRow(page, 'A'), CALLOUTS.autoApprovedRow, opts)

  const needsReviewTab = filterTab(page, 'Needs Review')
  await clickWithCursor(page, needsReviewTab, opts)
  await settle(page, opts)

  await showCallout(page, poRow(page, 'D'), CALLOUTS.needsReviewRow, opts)
  const dialogD = await openRow(page, 'D', opts)
  await resolveAmbiguousLine(page, dialogD, opts)

  const approveButton = dialogD.getByRole('button', { name: /Approve & create order/i })
  await clickWithCursor(page, approveButton, opts)
  await dialogD.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
  await settle(page, opts)

  // ── Step 3a · The approved orders in NexOrder's own Order Import tab ─────
  // Real screen, real orders: all four POs (three auto, one human-approved)
  // now sit here as ordinary orders.
  await setBanner(page, BANNER_STEPS.parked, opts)
  // The approval toast links straight to the new order; fall back to the
  // sidebar if it has already timed out.
  const toastLink = page.getByRole('button', { name: 'View in Order Import' })
  const navTarget = (await toastLink.count()) > 0 ? toastLink.first() : page.getByRole('button', { name: 'Order Import', exact: true }).first()
  await clickWithCursor(page, navTarget, opts)
  await dismissToasts(page)
  await page.getByRole('main').getByText(SHOWCASE_POS.A.customer).first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page, opts)
  await showCallout(page, page.getByRole('main').getByText(SHOWCASE_POS.D.customer).first(), CALLOUTS.orderImport, opts)
  await settle(page, opts)

  // ── Step 3b · Parked for the ERP (recording-only mock) ──────────────────
  await page.goto(ERP_MOCK_URL, { waitUntil: 'domcontentloaded' })
  await runOpts.recorder?.restart()
  await setBanner(page, BANNER_STEPS.parked, opts)
  await page.waitForTimeout(300)

  await showCallout(page, page.getByRole('heading', { name: 'Ready to import' }), CALLOUTS.erpQueue, opts)
  const lastRow = page.locator('#order-rows tr').last()
  await clickWithCursor(page, lastRow, { ...opts, first: true })
  await page.waitForTimeout(runOpts.annotated ? 5000 : 6000)
}
