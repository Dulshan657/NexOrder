// scripts/demo-video/interact.mjs
//
// Human-looking interaction helpers built on top of overlay.js's
// window.__demo — a fake cursor that glides to a target before clicking,
// smooth scrolling, and (in the annotated cut only) callouts anchored to
// real elements via Playwright ElementHandles rather than CSS selector
// strings, so any locator engine (role=, text=, css=) can be annotated.
//
// Every function here is a no-op-safe wrapper: if window.__demo hasn't
// mounted yet (a navigation raced the addInitScript), the optional-chained
// calls just do nothing rather than throwing and aborting the recording.

import { pacing } from './config.mjs'

/** @param {import('@playwright/test').Locator} locator */
async function boundingCenter(locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Element has no bounding box — is it visible? (${locator})`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

/**
 * Smoothly scroll an element to the viewport centre before interacting with
 * it — real users scroll before they click, and an instant jump reads as an
 * automated recording rather than a demo.
 */
export async function scrollIntoViewSmooth(page, locator, { annotated = false } = {}) {
  const p = pacing(annotated)
  await locator.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {})
  await page.waitForTimeout(p.scrollMs)
}

/**
 * Move the fake cursor to `locator`'s centre. `first` places it instantly
 * (with a fade-in) rather than animating from wherever it last was — used
 * once per page load, before the cursor has an on-screen starting point.
 */
export async function moveCursorTo(page, locator, { annotated = false, first = false } = {}) {
  const p = pacing(annotated)
  const { x, y } = await boundingCenter(locator)
  if (first) {
    await page.evaluate(({ x, y }) => window.__demo?.placeCursor(x, y), { x, y })
    await page.waitForTimeout(150)
  } else {
    await page.evaluate(({ x, y, ms }) => window.__demo?.moveCursor(x, y, ms), { x, y, ms: p.cursorMoveMs })
  }
  return { x, y }
}

/**
 * The standard click: scroll into view, glide the cursor over, pause, pulse,
 * click for real (Playwright dispatches the actual event — the cursor is a
 * pointer-events:none decoy), then pause again before the next action.
 */
export async function clickWithCursor(page, locator, { annotated = false, first = false } = {}) {
  const p = pacing(annotated)
  await scrollIntoViewSmooth(page, locator, { annotated })
  await moveCursorTo(page, locator, { annotated, first })
  await page.waitForTimeout(p.preClickMs)
  await page.evaluate(() => window.__demo?.clickPulse())
  await locator.click()
  await page.waitForTimeout(p.postClickMs)
}

/** Type into a field with per-character delay, after moving the cursor there. */
export async function typeWithCursor(page, locator, text, { annotated = false, first = false } = {}) {
  await scrollIntoViewSmooth(page, locator, { annotated })
  await moveCursorTo(page, locator, { annotated, first })
  await locator.click()
  await locator.pressSequentially(text, { delay: annotated ? 55 : 35 })
}

/**
 * Draw a callout anchored to `locator` (annotated cut only — a silent-cut
 * caller can call this unconditionally and it's simply a no-op). Blocks for
 * the callout's full on-screen duration so the storyboard's pacing and the
 * video's pacing can never drift apart.
 *
 * @param {import('@playwright/test').Locator} locator
 * @param {{ title?: string, text: string, side?: 'top'|'bottom'|'left'|'right' }} copy
 */
export async function showCallout(page, locator, copy, { annotated = false } = {}) {
  if (!annotated) return
  const p = pacing(annotated)
  const handle = await locator.elementHandle()
  if (!handle) return
  try {
    await page.evaluate(
      ({ el, copy, ms }) => window.__demo?.callout({ ...copy, target: el, ms }),
      { el: handle, copy, ms: p.calloutMs },
    )
  } finally {
    await handle.dispose().catch(() => {})
  }
}

/** Update (or create) the persistent step banner. No-op in the silent cut. */
export async function setBanner(page, text, { annotated = false } = {}) {
  if (!annotated) return
  await page.evaluate(t => window.__demo?.banner(t), text)
}

/** Close any toasts on screen (e.g. the low-stock alerts fired at sign-in). */
export async function dismissToasts(page) {
  const closers = page.locator('[role="status"] button, [role="alert"] button').filter({ hasText: 'Close' })
  for (let i = 0; i < 10 && (await closers.count()) > 0; i++) {
    await closers.first().click().catch(() => {})
    await page.waitForTimeout(250)
  }
}

/** Generic settle pause between beats, scaled by pacing. */
export async function settle(page, { annotated = false } = {}) {
  await page.waitForTimeout(pacing(annotated).settleMs)
}
