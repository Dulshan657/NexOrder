# NX-0034 — Keep the soft keyboard down on the scan gun

```json brief
{
  "id": "NX-0034-scan-keyboard-on-demand",
  "base": "c43e3ce62e7f5aab426a953d8efef380580dfd25",
  "approved": "2026-11-10 owner, by approving the design in session (keyboard button chosen over double-tap; 'make sure the keyboard button is only on the scan gun'), then 'push it to amadiya' after testing on the RS35. This brief was written up after the code from that approved design, to satisfy the brief gate; it adds no scope.",
  "acceptance": [
    { "id": "A1", "check": "On a device known to be a scan gun, every ScanField renders inputmode=\"none\" (no soft keyboard) and shows a keyboard button; the button brings the keyboard up (inputmode text, focus kept) and hides it again; a committed code or leaving the box puts it away." },
    { "id": "A2", "check": "Off the scan gun, and on the gun for softKeyboard='auto' (ProductForm) and compact cells, ScanField sets no inputmode and shows no keyboard button: the keyboard behaves as before." },
    { "id": "A3", "check": "The gun is recognised by its model (userAgentData model matching RS3x or CipherLab) or by its first machine-speed scan ending in a commit, remembered in localStorage across reloads; a person typing and pressing Enter does not mark a device as a gun." },
    { "id": "A4", "check": "With the keyboard held down, Enter, Tab and suffix-less gun scans still commit exactly once each." },
    { "id": "A5", "check": "Deployed to dev; /version.json shows the deployed sha.", "manual": "npm run deploy:dev verification" },
    { "id": "A6", "check": "On the RS35, in Receive and Putaway, the keyboard stays down on load and after scans, scans commit, and the keyboard button brings it up for typing.", "manual": "owner, on the RS35 against dev" }
  ],
  "failFirst": [
    { "file": "__tests__/ui/scanFieldGunJourney.test.tsx", "test": "ScanField scan-gun journey > a gun scan holds the keyboard down, the button brings it up, a typed code puts it away", "proves": ["A1", "A3"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > keeps the keyboard down by default", "proves": ["A1"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > the keyboard button brings it up, and again puts it away", "proves": ["A1"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > a committed code puts the keyboard away again", "proves": ["A1"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > leaving the box puts the keyboard away", "proves": ["A1"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > softKeyboard='auto' opts a desk form out", "proves": ["A2"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > compact table cells are opted out", "proves": ["A2"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField off the scan gun > leaves the keyboard alone and shows no keyboard button", "proves": ["A2"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "recognising the scan gun > learns the device is a gun from a machine-speed scan", "proves": ["A3"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "recognising the scan gun > does not learn it from a person typing and pressing Enter", "proves": ["A3"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "recognising the scan gun > remembers it across a reload", "proves": ["A3"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "recognising the scan gun > model \"RS35\" is a gun: true", "proves": ["A3"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "recognising the scan gun > model \"Pixel 7\" is a gun: false", "proves": ["A3"] },
    { "file": "__tests__/ui/scanFieldSoftKeyboard.test.tsx", "test": "ScanField on the scan gun > still commits Enter, Tab and suffix-less scans with the keyboard down", "proves": ["A4"] }
  ],
  "allow": []
}
```

## Goal

On the CipherLab RS35 the scan box holds focus permanently (autoFocus, then the refocus after every commit), so Android kept its on-screen keyboard over about half the screen during Receive and Putaway while the gun did all the input. Keep the keyboard down on the gun, with a keyboard button to bring it up for a torn label. Nothing changes on phones, tablets or desktops.

## Approach

- `components/ui/ScanField.tsx`: on a known gun, `inputMode` is `none` until the keyboard button (lucide `Keyboard`, 44px, `aria-pressed`, between the box and the camera button) is pressed; switching re-focuses the box so Android applies it. A commit or a blur resets it. New prop `softKeyboard?: 'onDemand' | 'auto'` (default `onDemand`); `compact` is always `auto`. A machine-speed run that ends in a commit marks the device as a gun.
- `lib/scan/scanGunDevice.ts` (new): `useIsScanGun()` via `useSyncExternalStore`; model check through `navigator.userAgentData.getHighEntropyValues(['model'])`; `markScanGun()` remembered in localStorage (every access guarded).
- `components/ProductForm.tsx`: `softKeyboard="auto"` (desk form; barcodes are often typed).
- `SCAN-GUN-TEST-GUIDE.md`: §5.1 note and checklist row 5.1c.

## Out of scope

- Quantity boxes (`inputMode="decimal"`) keep opening the number pad.
- No double-tap gesture; no change to the stray-scan listener or the wedge buffer.
- No server, migration or edge-function change.

## FINAL

Verified at `ae6a654`: `npx tsc --noEmit`, `npm run build`, eslint on the changed files and `npx vitest run` (440 files, 6972 tests at the first cut, plus the journey test) pass. `npm run check:brief`: every named test fails on the base and passes on the tip.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `ScanField scan-gun journey > a gun scan holds the keyboard down, the button brings it up, a typed code puts it away` fails by assertion on the base and passes on the tip; the `ScanField on the scan gun > ...` tests pass on the tip (check:brief) | |
| A2 | claimed | `ScanField off the scan gun > leaves the keyboard alone and shows no keyboard button`, `... > softKeyboard='auto' opts a desk form out`, `... > compact table cells are opted out` (check:brief) | Proven by absence on the base (the file imports the new module). |
| A3 | claimed | `recognising the scan gun > learns the device is a gun from a machine-speed scan`, `... > does not learn it from a person typing and pressing Enter`, `... > remembers it across a reload`, `model "RS35" is a gun: true`, `model "Pixel 7" is a gun: false`; the journey test learns the gun from a scan and fails by assertion on the base | The model path is unit-tested on the matcher only; see Not claimed. |
| A4 | claimed | `ScanField on the scan gun > still commits Enter, Tab and suffix-less scans with the keyboard down`; existing `scanFieldImeInput`, `wedgeBuffer`, `receiveScan` suites pass | |
| A5 | claimed | `npm run deploy:dev` from `e0b4ff5` (same app code as this branch; the rebuild added only the brief and the journey test): VERIFIED, nexorder.vercel.app/version.json = `e0b4ff5`, health 200 | |
| A6 | claimed | Owner, 2026-11-10: "i've tested it on the gun", against dev at `e0b4ff5` | Owner's own check; the steps run are not recorded here. |

### Not claimed

- Whether the RS35's Chrome reports a model that matches RS3x/CipherLab through `userAgentData` is not verified; if it does not, the keyboard can show on a fresh device until its first scan.
- Scans with the gun in ReaderConfig "Input Method" mode while `inputmode="none"` were not tested; the RS35 is configured for "Key Event".
- No check on a phone or tablet that the keyboard behaves as before; covered by unit tests only.
- The branch was rebuilt after the dev deploy so the brief is its first commit; the deployed commit `e0b4ff5` and this tip differ only by the brief and the journey test.
