// What does the app's backdrop-blur actually cost? — KNOWN-ERRORS-REGISTER.md O14.
//
// ── THE CLAIM UNDER TEST ────────────────────────────────────────────────────
//
// Every `backdrop-blur` in this codebase is 8 px (Tailwind v4 renumbered the
// scale: `blur-sm` IS 8 px, and bare `blur` is a compat alias for the same
// figure — which is what made F23's first fix a no-op). Five of them sit on
// sticky or fixed chrome, and `ProductCard.tsx:115,126` puts two more on every
// product tile, dozens of which cross the viewport on a single Shop scroll.
//
// The register has said "unmeasured" since it opened. Changing seven surfaces
// on a hunch is how you end up unable to say which one mattered, so the
// deliverable here is a NUMBER, not a diff.
//
// ── WHY THE PREVIOUS ATTEMPT COULD NOT WORK ─────────────────────────────────
//
// It ran in a browser-automation tab, which is always `document.hidden`. Chrome
// throttles requestAnimationFrame in a hidden page to roughly 1 fps, so every
// frame time it collected was scheduler noise. It also could not throttle the
// CPU, so no RS35 proxy was ever established either.
//
// Playwright fixes both, and this file leans on both:
//   • a HEADED window with backgrounding disabled (playwright.config.ts) —
//     rAF runs at display rate;
//   • `Emulation.setCPUThrottlingRate` over CDP — the throttle the old harness
//     lacked.
//
// ── TWO PASSES, BECAUSE TRACING IS NOT FREE ─────────────────────────────────
//
// `backdrop-filter` is a RASTER cost, and CPU throttling slows the main thread,
// where the blur is not. So the primary metric has to come from a trace, summed
// over the compositor and GPU threads.
//
// But a trace perturbs exactly the thing the SECONDARY metric measures: the
// first version of this file recorded frame intervals inside the traced window
// and reported a p95 of 1.7 SECONDS, with the three conditions in random order
// — a number that says nothing about blur and everything about the tracer. So
// each condition is now measured twice: once traced (compositor busy time) and
// once clean (frame intervals). Cheaper than it sounds, and the alternative is
// a perceptual metric that is pure artefact.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
// It is not a CipherLab RS35. It is desktop Chromium with a throttle multiplier
// standing in for one, and any conclusion has to be stated in those terms.
//
// The decision rule is pre-registered in docs/runbooks/measure-backdrop-blur.md
// and restated below. It was written BEFORE the harness was first run, which is
// the only thing that stops the threshold being chosen to fit the data.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { loginAsAdmin } from '../e2e/fixtures/auth'

/** How much slower than this machine to pretend to be. */
const CPU_THROTTLE_RATE = Number(process.env.PERF_CPU_THROTTLE ?? 6)

/** Trials per condition. Interleaved and rotated, never blocked. */
const TRIALS = Number(process.env.PERF_TRIALS ?? 9)

/** How long one scroll pass runs. */
const PASS_MS = Number(process.env.PERF_PASS_MS ?? 4_000)

/**
 * Scroll speed, in pixels per SECOND of wall time — not per frame.
 *
 * Per-frame would confound the whole experiment: a condition that costs more
 * produces fewer frames, so it would also scroll less far, and its lower
 * repaint total would read as it being cheaper. Driving position from elapsed
 * time means every condition covers exactly the same ground over exactly the
 * same interval, and the only thing left to differ is what that cost.
 */
const SCROLL_PX_PER_SEC = 600

interface Condition {
  readonly key: 'shipped' | 'four' | 'none'
  readonly label: string
  readonly css: string | null
}

/**
 * Three conditions, injected as CSS so nothing ships to obtain a reading.
 *
 * `four` exists to answer the follow-up rather than the question: if the
 * shipped 8 px does cost something, is halving it enough or must the blur go?
 * Without it a failing result has no next step.
 */
const CONDITIONS: readonly Condition[] = [
  { key: 'shipped', label: 'shipped (8px)', css: null },
  {
    key: 'four',
    label: 'forced 4px',
    // Matched on the class rather than on the computed property, because there
    // is no selector for "elements with a backdrop-filter". Every blur in this
    // app arrives through a `backdrop-blur*` utility; `check:overlays` and the
    // overlay ban are what keep that true.
    css: '[class*="backdrop-blur"]{backdrop-filter:blur(4px)!important;-webkit-backdrop-filter:blur(4px)!important}',
  },
  {
    key: 'none',
    label: 'no blur',
    css: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  },
]

/** Threads whose busy time is where a backdrop-filter actually lands. */
const RASTER_THREADS = /Compositor|CrGpuMain|CompositorTileWorker|VizCompositorThread/

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

interface PassResult {
  /** Frame-to-frame intervals in ms, first entry dropped. */
  readonly intervals: number[]
  /** Wall time the pass actually took, in seconds. */
  readonly elapsedSec: number
  /** Total pixels scrolled — equal work per condition, or the pass is invalid. */
  readonly scrolledPx: number
}

/**
 * One scroll pass, driven from inside the page.
 *
 * Deliberately NOT thirty `page.mouse.wheel` round trips: each of those is a
 * CDP hop whose latency lands in the frame timings, and under a 6× throttle
 * that noise swamps the signal. A rAF-driven scroll of the app's real scroll
 * container (`main[data-scroll-container]` — the AppShell root is
 * `h-screen overflow-hidden`, so the document never scrolls) moves the same
 * content past the same sticky chrome with nothing else in the loop.
 *
 * It ping-pongs at the ends rather than wrapping to the top: a wrap is one
 * enormous repaint that lands in whichever condition happened to reach the
 * bottom first.
 */
async function scrollPass(page: Page, durationMs: number): Promise<PassResult> {
  return page.evaluate(
    ({ durationMs, speed }) =>
      new Promise<PassResult>(resolve => {
        const scroller =
          (document.querySelector('main[data-scroll-container]') as HTMLElement | null) ??
          document.scrollingElement!
        scroller.scrollTop = 0

        const intervals: number[] = []
        const started = performance.now()
        let last = started

        const tick = (now: number) => {
          intervals.push(now - last)
          last = now

          // A triangle wave over the scroller's range: down to the bottom, back
          // up, repeat. Position comes from ELAPSED TIME, so a slow condition
          // does not quietly get an easier ride by rendering fewer frames.
          const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight)
          const travelled = ((now - started) / 1000) * speed
          const phase = travelled % (2 * max)
          scroller.scrollTop = phase <= max ? phase : 2 * max - phase

          const elapsed = now - started
          if (elapsed >= durationMs) {
            resolve({
              // The first interval is measured against the recorder's own start
              // and is not a frame gap.
              intervals: intervals.slice(1),
              elapsedSec: elapsed / 1000,
              scrolledPx: (elapsed / 1000) * speed,
            })
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { durationMs, speed: SCROLL_PX_PER_SEC },
  )
}

/**
 * The harness's own health check, and it is not optional.
 *
 * The reason O14 has no number is that a previous harness produced numbers
 * while being throttled to 1 fps and nothing in it noticed. Measure an idle
 * second first; if the page is hidden, or frames are not arriving at anything
 * like display rate, refuse to report rather than report noise.
 */
async function assertHarnessIsAwake(page: Page): Promise<number> {
  const probe = await page.evaluate(
    () =>
      new Promise<{ hidden: boolean; frames: number }>(resolve => {
        let frames = 0
        const started = performance.now()
        const tick = () => {
          frames += 1
          if (performance.now() - started >= 1_000) {
            resolve({ hidden: document.hidden, frames })
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )

  expect(
    probe.hidden,
    'the page reports document.hidden — rAF is throttled and every number this ' +
      'harness produces would be scheduler noise. This is exactly how O14 failed ' +
      'to get an answer the first time. Run headed and foregrounded.',
  ).toBe(false)

  expect(
    probe.frames,
    `only ${probe.frames} animation frames in a second. The window is being ` +
      'throttled (occluded, minimised, or on a battery saver). Numbers taken now ' +
      'would be meaningless.',
  ).toBeGreaterThanOrEqual(30)

  return probe.frames
}

/** Applies a condition, replacing whatever was applied before. */
async function applyCondition(page: Page, condition: Condition): Promise<void> {
  await page.evaluate(
    ({ css }) => {
      const id = 'perf-blur-override'
      document.getElementById(id)?.remove()
      if (!css) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = css
      document.head.appendChild(style)
    },
    { css: condition.css },
  )
  // Style recalc plus a couple of frames, so the first scrolled frame is not
  // measuring the change itself.
  await page.waitForTimeout(300)
}

interface Traced {
  readonly compositorMsPerSec: number
  readonly scrolledPx: number
}

/** A scroll pass wrapped in a CDP trace, reporting raster-thread busy time. */
async function tracedPass(page: Page, cdp: CDPSession): Promise<Traced> {
  const events: any[] = []
  const collect = (payload: any) => events.push(...payload.value)
  cdp.on('Tracing.dataCollected', collect)

  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      includedCategories: ['disabled-by-default-devtools.timeline', 'devtools.timeline'],
    },
  })

  const pass = await scrollPass(page, PASS_MS)

  const traceComplete = new Promise<void>(resolve =>
    cdp.once('Tracing.tracingComplete', () => resolve()),
  )
  await cdp.send('Tracing.end')
  await traceComplete
  cdp.off('Tracing.dataCollected', collect)

  // Thread names arrive as their own metadata events; map tid → name, then sum
  // the duration of complete ('X') events on the raster threads.
  const threadNames = new Map<number, string>()
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name) {
      threadNames.set(e.tid, e.args.name)
    }
  }
  let busyUs = 0
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue
    const thread = threadNames.get(e.tid)
    if (thread && RASTER_THREADS.test(thread)) busyUs += e.dur
  }

  return { compositorMsPerSec: busyUs / 1000 / pass.elapsedSec, scrolledPx: pass.scrolledPx }
}

test.describe('backdrop-blur cost (O14)', () => {
  test('measure the three conditions and apply the pre-registered rule', async ({ page }, info) => {
    test.setTimeout(20 * 60_000)

    await loginAsAdmin(page)

    // Admin reaches the Shop through its own sidebar button
    // (components/AppShell.tsx). The Shop is the worst case O14 names: a sticky
    // blurred top bar plus two blurred badges on every product tile, dozens of
    // which cross a 360 px viewport on one scroll.
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('button', { name: /^Shop$/ }).click()
    await expect(page.getByPlaceholder(/search/i).first()).toBeVisible({ timeout: 20_000 })
    // Let the product grid settle; measuring a skeleton measures nothing.
    await page.waitForTimeout(2_000)

    const blurred = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('*')).filter(el => {
          const s = getComputedStyle(el)
          const value = s.backdropFilter || (s as any).webkitBackdropFilter
          return value && value !== 'none'
        }).length,
    )
    // If nothing on screen is blurred, the surface is wrong and every condition
    // would read identically — a false "negligible".
    expect(blurred, 'no blurred elements on the measured surface').toBeGreaterThan(0)

    const idleFrames = await assertHarnessIsAwake(page)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE })


    // One measurement of one condition inside one trial.
    interface Reading {
      compositorMsPerSec: number
      frameP95: number
      stutters: number
      fps: number
      scrolledPx: number
    }

    async function measure(condition: Condition): Promise<Reading> {
      await applyCondition(page, condition)
      const traced = await tracedPass(page, cdp)
      // Clean pass — no tracer in the way of the perceptual metric.
      const clean = await scrollPass(page, PASS_MS)
      const mid = median(clean.intervals)
      return {
        compositorMsPerSec: traced.compositorMsPerSec,
        frameP95: percentile(clean.intervals, 95),
        stutters: clean.intervals.filter(gap => gap > mid * 2).length,
        fps: clean.intervals.length / clean.elapsedSec,
        scrolledPx: traced.scrolledPx,
      }
    }

    // A warm-up trial, discarded. The first pass on a page pays for shader
    // compilation, first raster of every tile, and whatever the product images
    // are still doing — all of it landing on whichever condition happens to go
    // first.
    for (const condition of CONDITIONS) await measure(condition)

    const trials: Array<Record<Condition['key'], Reading>> = []

    for (let trial = 0; trial < TRIALS; trial += 1) {
      // ROTATED, not merely interleaved. The first version ran shipped → 4px →
      // none in that order every trial, so any within-trial trend (the tracer
      // warming, the machine settling after a style change) was
      // indistinguishable from the effect of the condition — the conditions
      // were always in the same seats. Rotating by the trial index puts each
      // condition in each seat an equal number of times.
      const order = CONDITIONS.map((_, i) => CONDITIONS[(i + trial) % CONDITIONS.length])
      const row = {} as Record<Condition['key'], Reading>
      for (const condition of order) row[condition.key] = await measure(condition)
      trials.push(row)

      console.log(
        `trial ${trial + 1} (from ${order[0].key.padEnd(7)}) ` +
          CONDITIONS.map(c => `${c.key} ${row[c.key].compositorMsPerSec.toFixed(0)}ms/s`).join(
            '  ',
          ) +
          `  | delta 8px-none ${(row.shipped.compositorMsPerSec - row.none.compositorMsPerSec).toFixed(1)}`,
      )
    }

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    const per = (key: Condition['key'], pick: (r: Reading) => number) =>
      trials.map(row => pick(row[key]))

    const summary = CONDITIONS.map(condition => ({
      condition: condition.label,
      key: condition.key,
      compositorMsPerSec: median(per(condition.key, r => r.compositorMsPerSec)),
      frameP95: median(per(condition.key, r => r.frameP95)),
      stutters: median(per(condition.key, r => r.stutters)),
      fps: median(per(condition.key, r => r.fps)),
    }))

    /**
     * PAIRED, not a difference of medians.
     *
     * The first full run drifted 4x between trial 4 and trial 5 for reasons
     * having nothing to do with blur, which left the per-condition medians
     * sampling two different regimes and the difference between them a
     * coin-toss. Differencing WITHIN a trial cancels any drift slower than one
     * A/B/C cycle — which is the whole reason the trials are interleaved in the
     * first place. The estimator simply was not using it.
     */
    function pairedDelta(key: Condition['key'], pick: (r: Reading) => number) {
      const deltas = trials.map(row => pick(row[key]) - pick(row.none))
      const positive = deltas.filter(d => d > 0).length
      const agreeing = Math.max(positive, deltas.length - positive)
      return {
        median: median(deltas),
        deltas: deltas.map(d => Number(d.toFixed(2))),
        // How many trials agree on the SIGN. A real effect shows up in nearly
        // every pair; noise splits roughly evenly. This is what stops a large
        // median built from one outlier being reported as a finding.
        agreeing,
        consistent: agreeing >= Math.ceil(deltas.length * 0.75),
      }
    }

    const compositorDelta = pairedDelta('shipped', r => r.compositorMsPerSec)
    const fourDelta = pairedDelta('four', r => r.compositorMsPerSec)
    const frameDelta = pairedDelta('shipped', r => r.frameP95)

    const none = summary.find(s => s.key === 'none')!
    const deltaPct = (compositorDelta.median / none.compositorMsPerSec) * 100

    // ── THE PRE-REGISTERED RULE ────────────────────────────────────────────
    // The magnitudes are exactly as written in
    // docs/runbooks/measure-backdrop-blur.md before the first run: >= 10% AND
    // >= 2 ms/s of compositor time, or >= 4 ms of p95 frame interval. What
    // changed after the first run is the ESTIMATOR — paired within trial, and
    // required to agree on its sign in three quarters of them — and that change
    // can only make "worth changing" harder to reach, never easier.
    const worthChanging =
      (compositorDelta.consistent && deltaPct >= 10 && compositorDelta.median >= 2) ||
      (frameDelta.consistent && frameDelta.median >= 4)

    // A third outcome, and an honest one: measured, and the effect is smaller
    // than this rig can resolve. That is not the same claim as "negligible",
    // and collapsing the two would overstate what was learned.
    const verdict = worthChanging
      ? 'WORTH CHANGING'
      : compositorDelta.consistent
        ? 'NEGLIGIBLE'
        : 'BELOW THE NOISE FLOOR'

    const report = {
      measuredAt: new Date().toISOString(),
      verdict,
      rule:
        '(delta >= 10% AND >= 2 ms/s compositor) OR p95 frame delta >= 4 ms, each ' +
        'estimated as the median of within-trial pairs and required to agree on its ' +
        'sign in >= 75% of trials',
      paired: {
        compositorMsPerSec: {
          median: Number(compositorDelta.median.toFixed(2)),
          pct: Number(deltaPct.toFixed(1)),
          agreeingTrials: `${compositorDelta.agreeing}/${TRIALS}`,
          perTrial: compositorDelta.deltas,
        },
        frameP95Ms: {
          median: Number(frameDelta.median.toFixed(2)),
          agreeingTrials: `${frameDelta.agreeing}/${TRIALS}`,
          perTrial: frameDelta.deltas,
        },
        fourPxVsNoneMsPerSec: {
          median: Number(fourDelta.median.toFixed(2)),
          agreeingTrials: `${fourDelta.agreeing}/${TRIALS}`,
        },
      },
      summary,
      environment: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
        userAgent: await page.evaluate(() => navigator.userAgent),
        viewport: page.viewportSize(),
        cpuThrottleRate: CPU_THROTTLE_RATE,
        softwareCompositing: true,
        trialsPerCondition: TRIALS,
        passMs: PASS_MS,
        scrollPxPerSec: SCROLL_PX_PER_SEC,
        blurredElementsOnScreen: blurred,
        idleFramesPerSecond: idleFrames,
        note: 'Desktop Chromium, software compositing, CPU throttle standing in for an RS35. Not the device.',
      },
    }

    const outDir = path.join(process.cwd(), 'test-results')
    fs.mkdirSync(outDir, { recursive: true })
    const outFile = path.join(outDir, 'backdrop-blur.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

    console.log(`\n-- backdrop-blur, ${TRIALS} rotated trials, medians per condition --`)
    for (const row of summary) {
      console.log(
        `  ${row.condition.padEnd(14)} compositor ${row.compositorMsPerSec.toFixed(1)} ms/s  ` +
          `p95 frame ${row.frameP95.toFixed(1)} ms  fps ${row.fps.toFixed(0)}  stutters ${row.stutters}`,
      )
    }
    console.log('\n-- paired within-trial deltas against "no blur" --')
    console.log(
      `  8px compositor  ${compositorDelta.median >= 0 ? '+' : ''}${compositorDelta.median.toFixed(2)} ms/s ` +
        `(${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%), sign agrees in ${compositorDelta.agreeing}/${TRIALS}`,
    )
    console.log(
      `  4px compositor  ${fourDelta.median >= 0 ? '+' : ''}${fourDelta.median.toFixed(2)} ms/s, ` +
        `sign agrees in ${fourDelta.agreeing}/${TRIALS}`,
    )
    console.log(
      `  8px p95 frame   ${frameDelta.median >= 0 ? '+' : ''}${frameDelta.median.toFixed(2)} ms, ` +
        `sign agrees in ${frameDelta.agreeing}/${TRIALS}`,
    )
    console.log(`\n  VERDICT: ${verdict}\n  written to ${outFile}\n`)

    await info.attach('backdrop-blur.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    })

    // The test does NOT fail on a verdict — its job is to produce a reading,
    // and a red run would say the harness broke rather than that the blur is
    // expensive. It fails only when it could not measure at all.
    expect(
      Number.isFinite(compositorDelta.median),
      'no usable compositor timing was captured',
    ).toBe(true)
    expect(median(per('shipped', r => r.fps)), 'the page never rendered').toBeGreaterThan(1)
  })
})
