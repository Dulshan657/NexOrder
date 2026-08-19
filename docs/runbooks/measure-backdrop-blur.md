# Measuring what `backdrop-blur` costs

**For:** KNOWN-ERRORS-REGISTER.md **O14**.
**Command:** `npm run test:e2e:perf`
**Output:** `test-results/backdrop-blur.json`, and a table on stdout.

---

## Why this runbook exists

Every `backdrop-blur` in this app is 8 px. Tailwind v4 renumbered the scale, so
`blur-sm` **is** 8 px and bare `blur` is a compat alias for the same figure —
which is what made F23's first attempt at this a no-op, caught only by reading
`backdropFilter` off a deployed build. Five of the eight sit on sticky or fixed
chrome; two more are on every `ProductCard`, and dozens of those cross the
viewport on a single Shop scroll.

Nobody has ever reported a symptom. The register said "unmeasured" from the day
it opened, and changing seven surfaces on a hunch is precisely how you end up
unable to say which one mattered. So the deliverable is a number.

## Why the previous attempt produced nothing

It ran through browser automation in a Chrome tab, and that tab is always
`document.hidden`. Chrome throttles `requestAnimationFrame` in a hidden page to
roughly 1 fps, so every frame time collected was scheduler noise rather than
paint cost. The same harness could not apply CPU throttling either, so no
low-end-device proxy was ever established.

`tests/perf/backdropBlur.spec.ts` fixes both:

| | |
|---|---|
| Foreground | a **headed** window with `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-background-timer-throttling` (`playwright.config.ts`, project `perf`) |
| Device proxy | `Emulation.setCPUThrottlingRate` over CDP, default **6×**, plus software rasterisation |
| Self-check | before any trial it measures one idle second and **refuses to report** if `document.hidden` is true or fewer than 30 frames arrive |

That last row is the important one. A harness that cannot tell it is being
throttled is worse than no harness, because it answers anyway.

## What it measures

Signed in as Admin, on the **Shop** at 360 px — the RS35's width, and O14's own
stated worst case (160 blurred elements on screen). Three conditions, injected
as CSS so nothing has to ship to get a reading:

| | |
|---|---|
| **shipped** | no override — the 8 px the app actually renders |
| **forced 4px** | `[class*="backdrop-blur"]{backdrop-filter:blur(4px)!important}` |
| **no blur** | `*{backdrop-filter:none!important}` |

`forced 4px` exists to answer the follow-up rather than the question: if 8 px
does cost something, is halving it enough or must the blur go?

Each condition is measured **twice per trial**:

- a **traced** pass — CDP `Tracing`, summing complete events on the compositor
  and GPU threads. `backdrop-filter` is a *raster* cost, and CPU throttling
  slows the main thread, which is not where the blur is. This is the primary
  metric, reported as compositor busy ms per second of scroll.
- a **clean** pass — no tracer — for p95 frame interval and stutter count. The
  perceptual reading has to be taken with the instrument out of the way; see
  "Two corrections" below.

The scroll is a rAF-driven triangle wave over `main[data-scroll-container]`
(the AppShell root is `h-screen overflow-hidden`, so the document never
scrolls), positioned from **elapsed time** rather than incremented per frame —
otherwise a slower condition scrolls less far, does less repainting, and reads
as cheaper.

## Two corrections that had to be made mid-flight

Both are recorded because either one silently produces a confident wrong answer.

1. **Frame times were being read inside the trace.** The first version reported
   a p95 of 1.7 **seconds** with the three conditions in effectively random
   order. That is a measurement of the tracer, not of blur. Hence the separate
   clean pass.
2. **The estimator ignored the design.** Conditions ran in the same order every
   trial, and the verdict came from *differences of per-condition medians*.
   Then the baseline drifted 4× between trial 4 and trial 5 for reasons having
   nothing to do with blur, and the medians ended up sampling two regimes.
   Fixed twice over: the condition order is **rotated** by trial index so each
   condition sits in each seat equally often, and the estimator is now the
   **median of within-trial pairs** (shipped − none, measured seconds apart),
   which cancels any drift slower than one A/B/C cycle.

## The decision rule

**Magnitudes pre-registered before the first run.** The *estimator* changed
after it, for the reasons above — and that change can only make "worth
changing" harder to reach, never easier.

> The blur is worth changing **iff** the paired median exceeds *no blur* by
> **≥ 10 % AND ≥ 2 ms per second of scroll** on the compositor metric, **or**
> its p95 frame interval is **≥ 4 ms** worse — and in either case the sign must
> agree in **≥ 75 % of trials**.
>
> Otherwise O14 closes as measured-and-not-worth-it, with the numbers, and **no
> styling changes.**

There are three verdicts, not two. `BELOW THE NOISE FLOOR` is reported when the
sign does not agree — measured, and the effect is smaller than this rig can
resolve. That is a different claim from `NEGLIGIBLE` and collapsing the two
would overstate what was learned.

The spec does **not** fail on a verdict. Its job is to produce a reading, and a
red run would read as the harness breaking. It fails only when it could not
measure at all.

## The result, 2026-08-19

Nine rotated trials, 4 s passes, 6× CPU throttle, 360 px, against
`https://nexorder.vercel.app`. Paired medians against *no blur*:

| Compositing | 8 px vs none | sign agrees | 4 px vs none | p95 frame | verdict |
|---|---|---|---|---|---|
| **GPU** (`PERF_GPU=1`) | **+10.7 ms/s (+9.1 %)** | 8/9 | +10.9 ms/s | **0.00 ms** | NEGLIGIBLE |
| **Software raster** (default) | +102 ms/s (+69.2 %) | 9/9 | +66.5 ms/s | −16.7 ms (6/9) | WORTH CHANGING |

**The GPU row is the one that describes the device.** An RS35 is an Android
handheld with a GPU; software rasterisation is a deliberately harsher proxy, not
a neutral one, and reporting only its figure would overstate the case by a
factor of ten. On hardware the blur costs a real, repeatable ~9 % of compositor
time and **nothing measurable in frame timing**, which is below the threshold.

One finding worth more than the verdict: **on GPU, 4 px costs the same as 8 px**
(+10.9 vs +10.7 ms/s). The expense is having a `backdrop-filter` layer at all,
not its radius — so the `-sm` → `-xs` style of fix buys approximately nothing on
hardware. If the blur ever does need to go, it has to *go*, not shrink.

## What this is not

Desktop Chromium with a throttle multiplier standing in for a CipherLab RS35. It
is not the device, and no result from it should be written up as though it were.
A real reading needs the handheld on adb; until then this is the best available
and the register says so in those words.

## Running it

```bash
# Needs the same credentials as the rest of the E2E suite.
E2E_BASE_URL=https://nexorder.vercel.app \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
npm run test:e2e:perf

# Knobs, all optional:
PERF_GPU=1            # hardware compositing — run this one too, see above
PERF_CPU_THROTTLE=6   # multiplier; 1 disables throttling
PERF_TRIALS=9         # trials per condition
PERF_PASS_MS=4000     # length of one scroll pass
```

A window opens and scrolls by itself for about five minutes. **Leave it in the
foreground** — minimise it or cover it and the self-check will fail on the next
run rather than quietly hand you noise.

## Recording the answer

Paste the paired medians, the sign agreement, the compositing mode and the date
into the O14 row of `KNOWN-ERRORS-REGISTER.md`. A measurement whose conditions
are not written down cannot be compared against the next one — and the two rows
in the table above are the proof of that: same code, same machine, same day, an
order of magnitude apart, and the only difference is one Chromium flag.
