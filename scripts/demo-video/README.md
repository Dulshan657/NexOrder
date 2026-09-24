# PO Inbox sales-demo video

Produces two ~2:00, 1920x1080, 30fps H.264 mp4s of the PO Inbox on the dev
demo site (`https://nexorder.vercel.app` — the only environment carrying the
`po_inbox` module):

- **`po-inbox-demo-silent.mp4`** — pure screen recording, no audio.
- **`po-inbox-demo-guided.mp4`** — the same flow with arrow + text-box
  callouts, a step banner, and a CC0 background track.

## Prerequisites

- `ffmpeg` / `ffprobe` on your machine (resolved by `ffmpegPath.mjs` — WinGet
  install path by default, override with `FFMPEG_PATH` / `FFPROBE_PATH`).
- Playwright's Chromium browser installed (`npx playwright install chromium`
  if `npm run demo:video:silent` reports it's missing).
- `.env.dev.local` present (`--env=dev` scripts need it) — this is the
  **dev/demo workspace only**; never run the seed/inject/identity scripts
  below with `--env=amadiya`.

## Command sequence

Run everything from the repo root.

```bash
# 0. Make sure Young & Jacksons' trusted sender is seeded — showcase PO D
#    (needs_review) relies on its EXISTING contact_email/trust rather than
#    adding a new one. A no-op if already seeded.
npm run po-yj-seed

# 1. Swap the operator identity (Settings, order docs) for a generic one —
#    the demo shouldn't show NexGen's own details on camera.
node scripts/demo-video/app-identity.mjs --env=dev --set

# 1b. Move the demo's ~20 stale test POs out of Needs Review so the queue
#     on camera holds only the showcase.
node scripts/demo-video/queue-tidy.mjs --env=dev --hide

# 2. Seed the four showcase POs (A/B/C auto-approve, D needs one line mapped).
#    CHECK THE OUTCOME TABLE before recording: extraction is an AI call, and
#    PO A occasionally reads the buyer's name as the customer and lands in
#    review (~1 run in 3). Just run it again — it purges the previous run first.
npm run po-inject -- --showcase

# 3. Record the silent cut.
npm run demo:video:silent

# 4. The silent recording approved PO D, and every approval TEACHES aliases
#    (the manual fix makes D auto-approve next time). Re-inject: it purges the
#    previous run, including every alias learned since it arrived. Check the
#    outcome table again.
npm run po-inject -- --showcase

# 5. Record the guided cut (arrows, callouts, banner, music).
npm run demo:video:guided

# 6. Clean up the showcase fixtures.
npm run po-inject -- --showcase --clean

# 7. Restore the stale queue and the real operator identity.
node scripts/demo-video/queue-tidy.mjs --env=dev --restore
node scripts/demo-video/app-identity.mjs --env=dev --restore
```

Add `--base=<url>` to either `demo:video:*` script to point at a different
deployment, and `--out=<dir>` to change the output directory (default
`demo-video-out/`, gitignored).

```bash
node scripts/demo-video/record.mjs --annotated --base=https://nexorder.vercel.app --out=demo-video-out
```

## Outputs

Both land in `demo-video-out/` (gitignored — never commit rendered video):

- `demo-video-out/po-inbox-demo-silent.mp4`
- `demo-video-out/po-inbox-demo-guided.mp4`

## How it works

- **`record.mjs`** — CLI entry. Launches a (headed — the headless shell has no PDF viewer) Chromium at 1920x1080,
  signs in as the demo Admin and lands on PO Inbox *before* starting the
  screencast (`login.mjs`) so the login screen never appears in either cut,
  then drives the storyboard (`storyboard.mjs`) while a CDP screencast
  (`screencast.mjs`) captures frames, and finally encodes them to a
  constant-30fps mp4 — muxing in the CC0 track for `--annotated`
  (`encode.mjs`).
- **`storyboard.mjs`** — the on-camera flow: inbox overview and three source
  types (PDF / email body / fax scan) → Auto Approved vs. Needs Review, plus
  the one-click product-line fix on the needs-review PO → the mock ERP's
  "ready to import" queue. Uses `interact.mjs`'s fake-cursor click/scroll/type
  helpers throughout, and (in `--annotated` runs only) `overlay.js`'s
  callouts/banner.
- **`overlay.js`** — injected via `page.addInitScript` on every navigation.
  Exposes `window.__demo` (`placeCursor`, `moveCursor`, `clickPulse`,
  `callout`, `banner`, …) as a plain, dependency-free script — no bundler,
  runs identically on the login page, the app, and the mock ERP page.
  Everything it draws is `pointer-events:none` at the top z-index, so it can
  never intercept a real click or sit under a modal.
- **`erp-mock.html`** + **`erpRoute.mjs`** — a neutral "Order Import Queue"
  page (no real vendor name/logo) served via `context.route()` for
  `https://erp.example.local/**`, so the last beat of the video can
  `page.goto()` what looks like a different app with no second dev server.
  Pure render of `window.__ERP_DATA__`, injected by `erpRoute.mjs` from
  `config.mjs`'s `buildErpOrders()`.
- **`config.mjs`** — the four showcase POs, pacing constants (slower + more
  callout dwell time for `--annotated`), callout copy, banner steps, and the
  mock ERP's row data. See its header comment for why the showcase customers
  (Mountain Retreat Inn / Harbour View Café / Seaside Bistro / Young &
  Jacksons) differ from the original task brief's fictional names — the demo
  database rebuilt 2026-08-13 doesn't carry the brief's originals, so
  `tests/fixtures/po-samples/specs.mjs` substitutes real current HoReCas.
- **`ffmpegPath.mjs`** / **`ffmpegRun.mjs`** — resolve the ffmpeg/ffprobe
  binaries (WinGet install path, `FFMPEG_PATH`/`FFPROBE_PATH` override, or
  bare PATH) and wrap `spawn` for both tools.
- **`music/`** — the CC0 background track + its licence record. See
  `music/LICENSE.txt`.

## Selector notes / known uncertainty

`storyboard.mjs` favours role/text locators over CSS throughout (see its
header comment), matching queue rows by the **customer name** they resolved
to (stable regardless of exact email-subject wording) and the detail modal
by its `role="dialog"`.

The one interaction most likely to need adjustment if the fixture's copy
changes is `resolveAmbiguousLine()` in `storyboard.mjs` — Young & Jacksons'
PO D has one deliberately-ambiguous chilli-sauce line. It finds that line by
"the product picker that's still unresolved" (true by construction — the
showcase has exactly one unmatched line on this PO) rather than by matching
raw text, so it should survive small copy changes; a text-based fallback is
included for when more than one line is ever unresolved. See the function's
own comment for detail.
