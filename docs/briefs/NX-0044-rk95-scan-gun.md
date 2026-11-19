# NX-0044 — the RK95 is a scan gun too: keyboard down, and its scans match

```json brief
{
  "id": "NX-0044-rk95-scan-gun",
  "base": "7b949947d2b197d126dbb6bf31376bf98c0fbe21",
  "approved": "2026-11-19 owner",
  "acceptance": [
    { "id": "A1", "check": "isScanGunModel recognises the CipherLab RK95 (and RK9x siblings), and still says no to ordinary phones (Pixel, Samsung SM-*) and to an empty model." },
    { "id": "A2", "check": "A machine-speed scan committed through the page-level wedge listener (useWedgeScanner), with focus outside any ScanField, marks the device as a scan gun, so a ScanField then renders inputmode=\"none\" with a keyboard button." },
    { "id": "A3", "check": "A person typing at human speed with focus outside a ScanField does not mark the device as a scan gun." },
    { "id": "A4", "check": "normalizeScan removes every invisible formatting character an input method can insert (Unicode Cf: direction marks U+200E/U+200F, isolates U+2066-U+2069, word joiner U+2060, soft hyphen U+00AD; and C1 controls U+0080-U+009F) anywhere in the code, and folds full-width forms to ASCII, so such a scan of 4792082500139 resolves to the product storing 4792082500139. Visible characters, including inner spaces and hyphens, are untouched." },
    { "id": "A5", "check": "When Receive Stock refuses an unknown code, the message shows the code's character count and renders any character that is not printable ASCII as ⟨U+XXXX⟩, so a code that looks right but is not can be seen to be different." },
    { "id": "A6", "check": "On the RK95 at nexorder.vercel.app: Receive Stock opens without the on-screen keyboard, the keyboard button brings it up, and scanning the Unroasted Chilli Powder 200g barcode adds the line.", "manual": "owner walk on the RK95 after deploy:dev (the product and barcode must exist on dev for the scan half)" },
    { "id": "A7", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "recognising the scan gun > model \"RK95\" is a gun: true", "proves": ["A1"] },
    { "file": "__tests__/ui/wedgeScannerLearnsGun.test.tsx", "test": "useWedgeScanner and the scan gun > a machine-speed scan outside the box marks the device as a gun", "proves": ["A2"] },
    { "file": "__tests__/resolveScan.test.ts", "test": "normalizeScan > strips the invisible formatting marks an Android input method can insert", "proves": ["A4"] },
    { "file": "__tests__/resolveScan.test.ts", "test": "normalizeScan > folds full-width digits and letters to ASCII", "proves": ["A4"] },
    { "file": "__tests__/receiveScan.test.ts", "test": "resolveReceiveScan > resolves an EAN-13 that an input method wrapped in direction marks", "proves": ["A4"] },
    { "file": "__tests__/receiveScan.test.ts", "test": "describeReceiveRefusal > shows the length and any character the operator cannot see", "proves": ["A5"] }
  ],
  "allow": []
}
```

## Goal

Amadiya's operator now uses a **CipherLab RK95** in Chrome. Two things go wrong on it.

**The soft keyboard covers half the screen.** NX-0034 keeps it down on a scan gun and
is live on Amadiya (`rel-2026-11-12`), but it never switches on for the RK95:
- `GUN_MODEL_PATTERN` (`lib/scan/scanGunDevice.ts`) is `/\bRS3\d\b|cipherlab/i`,
  which doesn't match "RK95";
- the "learn it from a fast scan" fallback runs only in `ScanField`'s own commit,
  never for scans caught by `useWedgeScanner` (focus in a quantity box, or nowhere).

**A scan of a correct barcode is refused.** On Receive Stock, scanning *Unroasted
Chilli Powder - 200g X 40* says "Nothing in the catalogue matches 4792082500139".
The stored barcode is exactly `4792082500139`: 13 ASCII digits, checked by hex on
Amadiya. Typing the code works. Same resolver, so the scanned string carries something
the screen doesn't show and `normalizeScan` doesn't strip. It strips C0 controls and
U+200B–U+200D/U+FEFF only. An Android input method (the RK95's scanner can deliver
through one) can add direction marks, isolates, a word joiner or full-width digits,
and all of them render identically.

The owner approved the keyboard brief with "go and make sure the scan works". The
scan items (A4, A5) were added at that instruction.

## Approach

- `lib/scan/scanGunDevice.ts`: widen the model allow-list to CipherLab's RS3x and RK9x.
  Still a named list, because a wrong "yes" on a phone hides its keyboard.
- `lib/scan/useWedgeScanner.ts`: `markScanGun()` when the buffer commits a code. The
  buffer only commits machine-speed bursts, the same evidence ScanField uses.
- `supabase/functions/_shared/scanNormalize.ts` `normalizeScan`: NFKC-fold, then strip
  `\p{Cf}` and C0/C1 controls (`\p{Cc}`) anywhere, then trim and uppercase. It's the
  one shared definition, so the browser resolver and the server pick check stay
  byte-identical. ASCII input is unchanged by NFKC, so every existing code, bin and
  plate folds exactly as before.
- `lib/scan/receiveScan.ts`: the unknown-code sentence reveals non-printable-ASCII
  characters as `⟨U+XXXX⟩` and states the character count, using a small pure helper
  (`revealScan`) in `lib/scan/`.
- Tests named above, in the existing scan test files, plus one new file for A2/A3.

## Out of scope

- The supplier filter on Receive Stock hiding products not linked to the chosen supplier.
  That's working as designed. For the chilli powder, the fix is linking the supplier in Products.
- A scan that arrives in pieces because of a scanner inter-character delay. That's a
  ReaderConfig setting, diagnosed with `scan-diagnostics.html`. No idle-flush timing changes.
- Carton (ITF-14, non-zero indicator) codes resolving to the unit. Still deliberately refused.
- Stripping visible characters (spaces, hyphens) or symbology prefixes like `]E0`.
- Releasing to Amadiya. That's a separate `rel-*` step after the dev walk.

## FINAL
