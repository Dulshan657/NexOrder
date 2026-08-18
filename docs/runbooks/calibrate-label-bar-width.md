# Runbook — calibrate a printer's bar width

Find out whether the printer at a site lays down more ink than it is told, and
record the correction so every label after it prints true.

**Time:** ~20 minutes, all of it physical. One page, one gun, one person.
**Do it once per printer**, before the first labelling pass at a site — and
again if the printer is replaced, serviced, or its toner cartridge changed to a
different brand.

**Who:** Admin or Manager (the setting is written by `mutate-warehouse`), with
the actual scan gun and the actual sticker stock in hand.

---

## Why this exists

Every sizing decision in this repo — the ISO floor in
`_shared/labels/sizing.ts`, the wizard's verdicts, `refuseRun`'s refusal —
assumes a printer that holds the bar width it is given. **Bar width is the one
thing a printer can silently ruin.** A laser that over-inks widens every dark
bar, which narrows every space, which shifts the ratios a decoder measures. The
sheet looks perfect. It scans worse, or at a shorter range, or only when clean.

Nothing in software can detect this. It has to be measured on paper.

Until 2026-08-18 the correction was a constant (`BAR_WIDTH_REDUCTION_PT`) pinned
at zero: wired into the renderer, documented, and unsettable without an Edge
Function deploy. It is now per-site data (mig `00110`), so the person holding the
gun can record what they found.

---

## 1. Print the ladder

**Settings → Warehouse → Print labels → Before a labelling pass → Print
calibration sheet.**

Pick the warehouse first. The sheet prints **that site's longest code** — the
one whose bars are narrowest and therefore the one most at risk — at six bar
widths from 0.25 mm (the ISO floor) to 0.55 mm.

Two things to get right, or the exercise measures the wrong thing:

- **Print it on the real printer**, at its normal settings. Not a PDF viewer's
  "fit to page", not a different tray, not draft mode. Scaling changes the bar
  width, which is the entire subject.
- **The ladder is drawn at NOMINAL widths, with no compensation applied** — even
  if this site already has a calibration saved. That is deliberate and is
  enforced in `generate-labels`: a ladder printed through the correction would
  be measuring the correction rather than the press, and every rung would read
  as though the printer were already true.

## 2. Scan down it

With **the gun the operators actually use**, at **the distance they actually
scan from**:

1. Start at the widest row (0.55 mm) and work down.
2. For each row, scan it five times. Count first-time reads.
3. Stop at the first row that does not read five out of five.

The narrowest row that reads cleanly every time is this printer-and-gun pair's
real limit.

Compare it against what the software believes. The wizard's verdicts and the
0.25 mm refusal floor both assume the printed width equals the drawn width.

- **Reads clean down to 0.25 or 0.30 mm** — the press is true. There is nothing
  to compensate. Leave the setting blank (see §4).
- **Fails a row or two above where it should** — that gap is the ink spread.

## 3. Turn the gap into a number

The correction is **how much wider a bar comes out than it was drawn**, in
millimetres.

The direct way is to measure it: put a loupe or a caliper on a wide row's bars
and compare against the nominal width printed in that row's heading. A 0.50 mm
row measuring 0.55 mm means 0.05 mm of spread.

Without a loupe, estimate from where the ladder failed. If the gun reads
reliably down to 0.35 mm but the software's floor is 0.25 mm, roughly 0.05 mm of
each bar is ink that was not asked for. Start there.

**Realistic values are 0.02–0.08 mm.** Anything above ~0.10 mm is a printer
problem — a failing drum, wrong media setting, or toner density cranked up — and
should be fixed at the printer rather than compensated for in software. The
field refuses anything above ~0.18 mm outright.

## 4. Record it

Same panel, under the calibration button: **Ink-spread compensation.**

- Enter the figure **in millimetres**. It is stored in points; the conversion is
  the UI's job, not yours.
- Use the note field. `HP M404 + RS35, ladder clean to 0.35mm` is worth more in
  six months than `0.05` on its own.
- **Blank is not zero.** An empty setting means *nobody has measured this
  printer* and labels print at nominal width — which is what every site did
  before this existed and is the correct state until you have evidence. Saving
  `0` is a different statement: *measured, and this press is true.* Both are
  useful; guessing is not.

Sheets printed from now on use it. Sheets already printed do not change, and no
label is reprinted automatically.

## 5. Confirm

Print a real sheet of slot labels for the site and scan a few, at the real
distance. If the marginal rows now read where they did not, the correction is
right. If nothing changed, the reduction was too small; if bars look thin or
broken under a loupe, it was too large — lower it, or clear it and re-measure.

The clamp in `_shared/labels/sizing.ts` guarantees a saved value can never erase
a bar outright (it may consume at most a quarter of one module), so a wrong
number degrades the symbol rather than destroying the sheet. That is a
backstop, not a licence to guess.

---

## Where it lives

| | |
|---|---|
| Table | `warehouse_print_calibration` (mig `00110`) — one row per warehouse, **no row = no compensation** |
| Written by | `mutate-warehouse` action `set_print_calibration`, Admin/Manager |
| Read by | `generate-labels` → `loadPrintCalibration` → `drawBarcode` |
| Clamped by | `effectiveBarWidthReduction` in `_shared/labels/sizing.ts` — the only file holding a threshold |
| UI | `components/admin/labels/PrintCalibrationControl.tsx` |
| Register | O12 |

**It is per site, not per sheet group.** Ink spread is a property of the printer,
and a printer is not three things — which is why this is its own table rather
than a column on `warehouse_label_prefs`, whose key is
`(warehouse_id, sheet_group)` because three genuinely different die-cuts sit
behind it.

**Clearing is a DELETE.** "Unmeasured" has exactly one representation, the same
rule `warehouse_label_prefs` and `warehouse_code_patterns` follow.
