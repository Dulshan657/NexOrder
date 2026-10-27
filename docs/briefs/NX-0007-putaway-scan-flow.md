# NX-0007 — Putaway screen: scan, scan, Enter

```json brief
{
  "id": "NX-0007-putaway-scan-flow",
  "base": "ec37f286151d9a71061d14da98fa2ebb1f10692c",
  "approved": "2026-10-27 owner",
  "acceptance": [
    { "id": "A1", "check": "The Putaway screen has no Assign tab and no Assign/Assign all buttons; one screen with the scan bar on top (desktop and handheld) and the open tasks below in walk order." },
    { "id": "A2", "check": "A scan in the scan bar of a product barcode or plate code opens its task straight at the bin step — no tap." },
    { "id": "A3", "check": "Happy path: scan item, scan the suggested bin, Enter confirms the prefilled quantity — the task completes with zero clicks, sending the suggested task id (no assign call)." },
    { "id": "A4", "check": "The bin step shows why: 'Home', 'Overflow — home is full', or 'No home yet' with a 'Make this the home bin' checkbox that sends make_home." },
    { "id": "A5", "check": "Scanning a different bin shows one-tap reasons (Blocked, Damaged, Full, Closer, Other); Confirm stays disabled until one is picked, and it is sent as override_reason." },
    { "id": "A6", "check": "Every step before Confirm has Back, returning to the previous step without sending anything." },
    { "id": "A7", "check": "Typing fewer than expected asks 'Short by N — flag it?'; yes sends short:true, no keeps the remainder on the list." },
    { "id": "A8", "check": "Scanning a mixed plate lists its products; scanning one of them (or tapping it) continues that product's task." },
    { "id": "A9", "check": "Open loose tasks of the same product show as one stop with the summed quantity and complete with task_ids." },
    { "id": "A10", "check": "Scan / Guide toggle: Guide shows one task at a time in walk order with Skip; the choice is remembered per device and the screen works when storage throws." },
    { "id": "A11", "check": "Admin/Manager see a desk view: change a suggested bin (redirect), Place now (Admin only), and a 'Short at putaway' list with Found it / Write off (reason required)." },
    { "id": "A12", "check": "The receipt success card has 'Put away now', opening Putaway filtered to that receipt (?receipt=); the existing Accept panel stays." },
    { "id": "A13", "check": "On dev at 360x720 and on desktop: receive a homed product, Put away now, 2 scans + Enter completes it; wrong bin, short count, mixed plate and Guide each behave as above.", "manual": "branch deployed to dev (deploy:dev) before the PR; the owner tests on nexorder.vercel.app" },
    { "id": "A14", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/putawayQueuePage.test.tsx", "test": "PutawayQueuePage > has no Assign tab", "proves": ["A1"] },
    { "file": "__tests__/putawayQueuePage.test.tsx", "test": "PutawayQueuePage > Guide shows one task with Skip and remembers the choice", "proves": ["A10"] },
    { "file": "__tests__/putawayQueuePage.test.tsx", "test": "PutawayQueuePage > filters to a receipt from ?receipt=", "proves": ["A12"] },
    { "file": "__tests__/putawayScanOpensStop.test.tsx", "test": "putaway scan bar > opens the matching task at the bin step", "proves": ["A2"] },
    { "file": "__tests__/putawayStopCard.flow.test.tsx", "test": "PutawayStopCard flow > completes a suggested task with scan, scan, Enter and no clicks", "proves": ["A3"] },
    { "file": "__tests__/putawayStopCard.flow.test.tsx", "test": "PutawayStopCard flow > says why this bin and sends make_home when ticked", "proves": ["A4"] },
    { "file": "__tests__/putawayStopCard.flow.test.tsx", "test": "PutawayStopCard flow > asks for a reason when a different bin is scanned", "proves": ["A5"] },
    { "file": "__tests__/putawayStopCard.flow.test.tsx", "test": "PutawayStopCard flow > Back returns one step without sending", "proves": ["A6"] },
    { "file": "__tests__/putawayStopCard.flow.test.tsx", "test": "PutawayStopCard flow > flags a short count", "proves": ["A7"] },
    { "file": "__tests__/putawayStopCard.flow.test.tsx", "test": "PutawayStopCard flow > a mixed plate lists its products", "proves": ["A8"] },
    { "file": "__tests__/putawayCombine.test.ts", "test": "combinePutawayStops > merges loose tasks of one product", "proves": ["A9"] },
    { "file": "__tests__/putawayDeskView.test.tsx", "test": "putaway desk view > redirect, Admin-only Place now, and the Short list", "proves": ["A11"] },
    { "file": "__tests__/receiveSuccessPutawayNow.test.tsx", "test": "ReceiveSuccessCard > Put away now opens putaway filtered to the receipt", "proves": ["A12"] }
  ],
  "allow": []
}
```

## Goal

Second half of the putaway simplification agreed with the owner on 2026-10-27
(server half: NX-0006, merged as ec37f28). The floor gets one scan-first screen:
scan the item, scan the bin, Enter. It asks a question only when it must (a
different bin, a short count, no home yet), and every step has Back.

## Approach

- `PutawayQueuePage`: Assign/Walk tabs out. One screen with `StickyScanBar`
  (`position="adaptive"`, as Receive Stock), a Scan/Guide toggle and a
  `?receipt=` filter.
- `PutawayStopCard` becomes a step machine: identify → (plate: pick product) →
  bin → (reason) → qty → (short?) → done, with Back on each step.
- `PutawayWalkView`: lists `suggested` and `assigned` tasks in walk order.
  A scan-bar hit opens the stop past identify.
- `combinePutawayStops` (pure) groups loose tasks of one product.
- Desk view for Admin/Manager: Change bin, Place now (Admin), Short list.
- `ReceiveSuccessCard`: Put away now.
- Uses NX-0006's `completePutaway({ taskIds, overrideReason, short, makeHome })`,
  `redirectPutaway` and `resolveShortPutaway`. No server changes.

## Out of scope

- Undo after Confirm (the owner declined).
- Any server or migration change.
- Retiring `assigned` / `assign_only`, which stay for in-flight rows.

## FINAL
