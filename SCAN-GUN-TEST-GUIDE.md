# Scanner test guide — CipherLab RS35

How to prove the barcode implementation with the real device, end to end.

**Device:** CipherLab RS35 mobile computer, Android 10, Zebra SE4770 1D/2D
imager, 5.5" 720×1440 screen (≈360 CSS px wide).

**Target:** the demo — <https://nexorder.vercel.app> (Supabase `uqvekvavkjjurpqtovbq`).
**Never run this against `nexorder.com.au`.** That is Amadiya's live database; a
stocktake there posts a real variance against a paying client's stock.

Work through the tiers in order. Each only makes sense if the one before passed —
there is no point debugging a workflow while the scanner is in the wrong output
mode.

> **Desktop testing** is still supported and unchanged; see the appendix at the
> end. Everything from §3 onwards applies to both.

---

## 0 · ReaderConfig — the scanner's output mode

This is the section that matters most, and the one where the RS35 differs
completely from a USB gun. **Do this before opening the app.**

Open **ReaderConfig** on the device (it is a built-in CipherLab app), then
**Data Output**.

### 0.1 First, write down what it currently says

Record these before changing anything, so you can put it back:

| Setting | Currently |
|---|---|
| Keyboard Emulation | ______ |
| Auto Enter | ______ |
| Terminating / Auto Enter character | ______ |
| Timeout between Input Method / KeyEvent Delay Time | ______ ms |

### 0.2 Keyboard Emulation — set it to **Key Event**

This is the single most important setting on the device. The options are:

| Mode | What a browser sees |
|---|---|
| **Intent** | **Nothing.** An Android broadcast intent cannot be received by a web page, at all. |
| **Input Method** — **the factory default** | The text, via an IME. Chrome reports every keydown as `Unidentified` / keyCode 229. |
| **Key Event** | **Real key events.** ← use this |
| **Copy & Paste** | Nothing, unless someone manually pastes. |
| **Intent & KeyEvent** | Works (the KeyEvent half reaches the browser), but the intent half is wasted. |

**Why `Key Event` and not the default.** The app works in `Input Method` mode
*as long as a scan box already has focus* — that path was specifically built to
survive it. What does **not** work in that mode is scanning when nothing is
focused: an Android IME types into the focused editable and nowhere else, so with
no field focused **no characters are produced at all**. That is a property of
Android text input, not something the app can fix. `Key Event` produces real key
events regardless of focus, and the app's stray-scan recovery then works.

If you are stuck on `Input Method` for some other reason, everything still works
— you just have to tap the scan box first, every time.

### 0.3 Auto Enter — on, **Carriage Return**

The default is already `Carriage Return`, which is what you want. Notes on the
other options:

- **Tab** — also supported.
- **None** — supported; the app commits after 120 ms of quiet instead. Slowest of
  the three.
- **CRLF Character** — works, but sends *two* terminators. The app now
  de-duplicates identical commits within 250 ms specifically so this cannot add
  the same receipt line twice; prefer plain `Carriage Return` anyway.
- **IME Action** — avoid. It fires the keyboard's "Done" action, which a browser
  may not see as Enter.

### 0.4 Delay — **0 ms**

`Timeout between Input Method` (Input Method mode) or `KeyEvent Delay Time`
(Key Event mode). Both default to **0**, which is correct.

⚠️ The app tells a scanner from a person by how fast characters arrive — the
limit is **50 ms per character**. A delay at or above that makes a scan look like
human typing. Symptom: scanning into a focused box works, scanning anywhere else
silently does nothing.

### 0.5 Symbologies

Confirm **Code 128**, **EAN-13** and **UPC-A** are all enabled. The test sheet
uses all three. Code 128 is what every location, pallet and product label in this
system is printed in.

---

## 1 · Prove the scanner before blaming the app

Build the diagnostics page and open it **on the RS35**:

```bash
npm run scan:diagnostics     # writes scan-diagnostics.html at the repo root
```

Getting it onto the device — either works:
- copy `scan-diagnostics.html` to the device (USB, email, Drive) and open it in
  Chrome; or
- serve the repo from your PC (`npx serve .`) and browse to
  `http://<your-pc-ip>:3000/scan-diagnostics.html` over the same wifi.

It needs **no login**, which is the point — it works before anything else does.

Tap the box, pull the trigger, and read the verdict:

| What it says | Meaning |
|---|---|
| **Good scan** … *Key Event* | Everything is right. Move on. |
| **Good scan** … *Input Method* | Working, but only into a focused box. Go back to §0.2. |
| **Characters arrived up to N ms apart** | Inter-character delay too high. §0.4. |
| **Only N characters** | Under the 3-character minimum. |
| Nothing happens at all | `Intent` or `Copy & Paste` mode. §0.2. |

Also check the **This device** panel at the bottom:

- **Chrome version must be 111 or newer.** The app's CSS (Tailwind v4) requires
  it. On an older Chrome the app renders essentially unstyled — that is a browser
  problem, not a scanner problem, and it will waste an hour if you don't rule it
  out now. The panel flags it explicitly.
- **Vibration: supported** — the app buzzes on every scan verdict.
- **AudioContext: supported** — and turn the **media** volume up, not the ringer.

Use the **Test vibration** and **Test sound** buttons to confirm you can feel and
hear a verdict before you rely on one in an aisle.

---

## 2 · Print the test sheet

```bash
npm run seed:barcodes:dev     # gives 40 demo products real EAN-13 / UPC-A codes
npm run scan:sheet            # writes scan-gun-test-sheet.html
```

Open it in a browser and print.

> **Print at 100% / "Actual size". Never "Fit to page"** — that rescales the bars
> and makes the calibration ladder meaningless. Plain white paper; turn off
> draft/toner-save, which thins the bars.

The sheet is drawn by the app's **own** Code 128 encoder from codes read live out
of the demo database. A sheet from an online generator would scan perfectly even
if our encoder were broken, and would prove nothing.

Scan the printed sheet with the **hardware trigger**. The camera is a fallback
for a torn label, not the primary path.

---

## 3 · Log in

<https://nexorder.vercel.app> → tap the **Admin** chip in the demo-accounts panel
(`alice@nexorder.com.au`). The password is `SEED_USER_PASSWORD` in
`.env.dev.local`.

> **Do not test as the Warehouse role on this demo.** Both Warehouse accounts have
> `home_warehouse_id = NULL`, and `StocktakePage` gates its Post button on that
> field matching the selected site. Everything looks fine until the very last
> tap, which is disabled with no explanation. Admin has no such gate.

**Feedback you should get on every scan:**

| Channel | Accept | Reject |
|---|---|---|
| Vibration | one short buzz | three buzzes |
| Sound | short high blip | low falling two-tone |
| Border | green ring | red ring |

The scanner's own beep means "I decoded a barcode" and is identical for the right
bin and the wrong one. Go by the device's buzz, not the scanner's beep.

> The very first scan after a page load may be **silent** — browsers refuse to
> start audio until the user has interacted with the page. The buzz and the ring
> still fire.

---

## 4 · Does every kind of code resolve?

Go to **Stocktake**. Scan one of each from the sheet and check the message.

| Scan (sheet §) | Expected |
|---|---|
| A bin, e.g. `MAIN-F01-R05` (§1) | Opens the count sheet. Accept. |
| A pallet, e.g. `HU-000242` (§3) | *"That code names a product or a pallet. Scan a bin label instead."* Reject. |
| A SKU, e.g. `AYM-COC-001` (§4) | Same message. Reject. |
| `NOT-A-REAL-CODE` (§7) | *"No location in this warehouse matches NOT-A-REAL-CODE."* |
| A zone/aisle code | *"… is a ZONE — a container, not a place stock sits."* |

**The important one — GTIN folding (sheet §6).** Three barcodes, three lengths,
one number:

```
074250000042     ← 12-digit UPC-A, which is what the database stores
0074250000042    ← 13-digit EAN-13 spelling
00074250000042   ← 14-digit GTIN spelling
```

Go to **Receive Stock**, pick a supplier, scan **all three**. Each must add a line
for **the same product** (`AYM-COC-004`).

Until the seed script existed no demo product had a barcode at all, so this — the
most intricate branch in the resolver — had never been exercised by a real beam.
If any of the three resolves to a different product, or to nothing, that is a real
bug. Note which one.

---

## 5 · The three workflows

### 5.1 Stocktake — the best fit for the handheld

**Undo:** re-count back to the original number.

1. Scan a bin from sheet §1 — use one with 2+ SKUs.
2. **Write down the current on-hand for every line first.** That is your undo.
3. Type a different number into one line. Leave the others blank.
   - **Blank is not zero.** An untouched line is untouched; a write-off must be
     typed as an explicit `0`.
4. Post the count.
5. Check **Stock** — the figure should have moved, with a `stocktake_variance` in
   the ledger.
6. **Undo:** scan the same bin, type the original figure, post.

Worth doing deliberately: enter a number *lower* than the bin's available stock
allows. That line alone should be refused, with the others still posting.

**On the RS35 specifically:** tapping the Counted box opens the soft keyboard. The
Post bar at the bottom should stay visible above it. If it disappears behind the
keyboard, say so — that is what the `interactive-widget=resizes-content` viewport
setting exists to prevent, and it would mean the device's Chrome ignores it.

### 5.2 Receive Stock — usable, but cramped

**This screen is a dock/desk surface.** The receipt-line table is ~1100 px wide and
scrolls sideways on a 360 px screen; the per-line batch-barcode box is off to the
right. It works, but do a real receiving session at a desk.

**Undo:** adjust the received quantity back down.

1. Pick a supplier.
2. **Scan a site root** from sheet §2 (e.g. `WIE-DEMO`) → the destination changes.
3. **Scan a bin** from sheet §1 → refused: *"… is a bin. Receipts land at the site
   — Putaway moves the stock to a bin afterwards."* Correct, not a bug.
4. **Scan a carton barcode** from sheet §5 → adds a receipt line.
5. Set a quantity, scan a batch barcode into that line's Barcode cell.
6. Receive it.
7. Check **Putaway** — a recommendation should exist and a new `HU-0002xx` plate.
8. **Undo:** Stock → adjust that product back down.

### 5.3 Replenishment

⚠️ **There are 0 open replenishment tasks on the demo.** Create one first:

1. **Replenishment → Setup** (`?subtab=setup`), Admin or Manager only.
2. Find a product with stock in a **reserve/bulk** bin and a **pick-zone** home
   bin. The grid ranks by demand and shows the home bin.
3. Set **min** and **max** (in packs) and **arm** the row — arming is what counts;
   saving figures alone does nothing.
4. Save, then run **Detect** on the queue.
5. If no task appears, the queue says why — `source_reserved`, `no_source`,
   `slot_full`. Those are answers, not errors: replenishment is sized from
   **available** stock, never `on_hand`.

Then walk it:

1. Assign the task, open the walk.
2. **Scan the source bin.** A *different* bin is **accepted** and recorded — the
   assigned bay is often empty. Amber banner naming both. Accept.
3. **Scan the plate.** A wrong plate is refused and the field clears.
4. Enter the quantity.
5. **Scan the destination — scan a WRONG bin on purpose first.** Expect refusal,
   reject buzz, field cleared, Confirm disabled. This asymmetry is the design: a
   wrong source is recoverable, a wrong destination leaves the short pick slot
   short while reporting the work done.
6. Scan the right destination, confirm.
7. **Undo:** transfer the stock back to the reserve bin.

---

## 6 · Labels and the calibration ladder

1. **Settings → Warehouse → Print labels** (do this on a desktop).
2. Print the **calibration sheet** first. It renders the site's longest code at
   six bar widths and exists precisely to be scanned with a real device.
3. Generate a **location** run for a published layout. Check that a run the app
   considers too small is **refused outright**, naming the offending codes, before
   any PDF is produced.
4. Print on real Avery stock at 100% and scan those.

**Sheet §8 is the ladder** — 0.25 → 0.55 mm per module. Scan from the top down at
the distance you actually work at, and note the narrowest that reads first time,
every time.

> **Expect the RS35 to pass every rung.** The SE4770 is a strong imager with a
> minimum element size well below anything we print. A clean sweep is a real
> result, not a null one: it means the binding constraint is your **printer**, not
> the scanner. If a rung fails, suspect the print (toner-save, "fit to page",
> paper) before the device.

For reference, `lib/labels/sizing.ts` wants 0.33 mm at arm's length, 0.50 mm
across a pallet, 1.00 mm down an aisle, and refuses anything below 0.25 mm.

---

## 7 · Results — fill this in

| # | Check | Pass? | Notes |
|---|---|---|---|
| 0 | ReaderConfig recorded, then set to Key Event / CR / 0 ms | | |
| 1.1 | Diagnostics reports **Key Event** and a good scan | | worst gap: ____ ms |
| 1.2 | Chrome version ≥ 111 | | version: ____ |
| 1.3 | Vibration and sound both testable | | |
| 3 | Login, and accept/reject are distinguishable by feel | | |
| 4.1 | Bin / pallet / SKU each resolve or refuse correctly | | |
| **4.2** | **All three GTIN spellings → one product** | | ⬅ the important one |
| 5.1 | Stocktake posts, and undoes | | |
| 5.1b | Post bar stays above the soft keyboard | | |
| 5.2 | Receive: root accepted, bin refused, carton adds a line | | |
| 5.3 | Replen: wrong source accepted, wrong destination refused | | |
| 6 | Calibration sheet prints and scans | | narrowest: ____ mm |

---

## 8 · When something fails

| Symptom | Almost certainly |
|---|---|
| Nothing arrives, even on the diagnostics page | ReaderConfig is in **Intent** or **Copy & Paste**. A browser cannot see either. §0.2 |
| Works in a focused box, dead everywhere else | **Input Method** mode (§0.2) — or the inter-character delay is over 50 ms (§0.4). The diagnostics page tells you which. |
| App looks unstyled / broken layout | Chrome older than 111. Not a scanner problem. §1 |
| Text appears but never commits | Auto Enter is `None` and you are not waiting 120 ms, or it is set to `IME Action`. §0.3 |
| The same code lands twice | `CRLF Character` terminator. Guarded to 250 ms, but switch to plain `Carriage Return`. |
| Focus jumps mid-scan | Tab terminator on a run that didn't qualify as machine-speed. Check the delay. |
| No buzz | Haptics muted, or the device has vibration off system-wide. Test in §1. |
| No sound but buzz works | **Media** volume, not the ringer. Or it is the first scan after a page load. |
| Post button hidden behind the keyboard | The viewport `interactive-widget` hint isn't being honoured. Report it with the Chrome version. |
| Warehouse selector hidden behind the ☰ menu button | Was a real bug, fixed. If you still see it, note which screen. |
| A valid label reads as "no such location" | Was a real bug in two dialogs, fixed. If it recurs, capture the exact code. |

---

## Appendix · Desktop with a USB/Bluetooth wedge gun

Everything from §3 onwards is identical. The differences:

- **Gun config** instead of ReaderConfig: set it to **USB HID keyboard** mode
  (not "USB COM"/serial, where the browser sees nothing), a **CR** or **Tab**
  suffix, and **0 ms inter-character delay** — same 50 ms threshold, same
  symptom if it's too high.
- **Prove it first** in Notepad, or better, on `scan-diagnostics.html`, which
  works identically on a desktop.
- Focus matters more on a desktop, because a mouse takes focus away. The
  stray-scan capture is armed on Stocktake, Putaway and Receive; it stands down
  whenever focus is in any input, so a scan aimed at a quantity box lands there.
- No vibration on a desktop; the tone and the border ring carry the verdict.

---

## What this exercises, for the record

- `lib/scan/wedgeBuffer.ts` — the scanner-vs-human timing machine
- `components/ui/ScanField.tsx` — `noteArrival`, which is what makes
  `Input Method` mode work at all
- `lib/scan/useWedgeScanner.ts` — stray-scan capture (needs `Key Event`)
- `lib/scan/scanFeedback.ts` — tone + vibration
- `lib/scan/resolveScan.ts` — the three namespaces and ambiguity reporting
- `_shared/scanNormalize.ts` — folding and GTIN variants, shared by both runtimes
- `_shared/labels/code128.ts` — the encoder, proven by the sheet itself
- `_shared/pickScanCheck.ts` / `putawayScanCheck.ts` / `replenScanCheck.ts` — the
  three deliberately asymmetric validators
