# NX-0022 — the shared page header on the rep and customer pages

```json brief
{
  "id": "NX-0022-rep-customer-page-headers",
  "base": "a853ecd39731677896958c5e4fe00a1f60830c8c",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "Rep Dashboard, Order home, Order History and rep Scheduled Visits render through PageHeader, with no hand-rolled h1 and no header icon. All but Order home also use PageFrame." },
    { "id": "A2", "check": "Rep Scheduled Visits is titled from ADMIN_TAB_LABELS and Order History reads 'Order History', so 'Scheduled Visits & Check-ins' is gone." },
    { "id": "A3", "check": "Rep Dashboard and Order home keep their personal words in the standard title style, and their title stays visible on phones." },
    { "id": "A4", "check": "Rep Scheduled Visits and Shop use PageTabs; their hand-rolled tab rows and tab icons are gone." },
    { "id": "A5", "check": "A disabled PageTabs tab cannot be chosen and says why, so Shop's Pantry List and Reorder still wait for a HoReCa to be selected." },
    { "id": "A6", "check": "Shop shows no visible title or description, and has a screen-reader-only h1." },
    { "id": "A7", "check": "Outside a named allow-list, no page in the app hand-rolls an h1 or the standard title style." },
    { "id": "A8", "check": "Shop keeps its sticky search bar, HoReCa selector, sort and cart button, with its Pantry List count and estimate, and the bar still reaches both page edges.", "manual": "Browser walk on dev as Field Rep at 1280px and 360px, with tabs pressed. Nothing placed." },
    { "id": "A9", "check": "All five pages have no sideways overflow, on every tab, and header buttons and tabs reach 44px at 360px.", "manual": "Measured on dev at 360px, 768px and 1280px; --project=mobile against a build of the branch, with any skipped spec named in FINAL." },
    { "id": "A10", "check": "Order home keeps its centred narrow column on desktop.", "manual": "Measured on dev at 1280px, on a login that reaches it; if none does, say so in FINAL." },
    { "id": "A11", "check": "Merged and deployed to dev; /version.json shows the sha serving it.", "manual": "deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the rep and customer pages use PageHeader with no hand-rolled h1 or header icon", "proves": ["A1"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > rep Scheduled Visits and Order History use the standard titles", "proves": ["A2"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Rep Dashboard and Order home stay visible on phones", "proves": ["A3"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > rep Scheduled Visits and Shop use PageTabs", "proves": ["A4"] },
    { "file": "__tests__/pageTabs.test.tsx", "test": "PageTabs > a disabled tab cannot be chosen and says why", "proves": ["A5"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Shop has a screen-reader heading and no visible title", "proves": ["A6"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > no page outside the allow-list hand-rolls a page title", "proves": ["A7"] }
  ],
  "allow": []
}
```

## Goal

The last five pages come onto the shared header, and a test then stops any page
drifting away from it again.

## Approach

- **Rep Dashboard:** title stays "Good morning, Name"; the date stays as the small line,
  now in Australian format; the visits and target chips move to the header's right.
- **Order home:** title stays the venue name, at the standard size instead of the larger
  one; "Hi Name" stays for kitchen staff; the centred narrow column stays.
- **Order History:** the standard frame and a new sentence; the Back button keeps its
  behaviour and takes the standard size.
- **Rep Scheduled Visits:** the title becomes "Scheduled Visits"; the tabs become `PageTabs`
  with counts as badges and no icons; New Scheduled Visit takes the standard size.
- **Shop:** the frame becomes `PageFrame`, with a screen-reader-only `h1` reading "Shop".
  `OrderingTabBar` renders `PageTabs`; icons go, the Pantry List count stays as a badge and
  its estimate stays beside the label from `sm` up.
- **Shop's search bar:** stays sticky. The sort box reaches the 44px floor on phones, and
  the spacing comes from the frame instead of the tab bar's own margin.
- **`PageTabs`:** a tab can be `disabled` with a `title`, for Shop's tabs that need a HoReCa.
- **The whole-app rule:** a test walks `components/` and `views/` for hand-written `h1`s
  and the standard title style. Allowed, each with its reason in the test:
  - login, password reset, account-load failure and QR entry: not pages inside the app
  - `HoReCaProfile`: a detail screen headed by the customer's name
  - `HoReCaAdmin` and `InvoiceAdmin`: nothing imports them

Descriptions:

| Page | Small line | |
|---|---|---|
| Rep Dashboard | Today's date | Australian format |
| Order home | "Hi Name", kitchen staff only; nothing for other users | unchanged |
| Order History | Your past orders, ready to view or reorder. | **new** |
| Rep Scheduled Visits | Your visits for today and ahead, with check-ins at each stop. | **new** |
| Shop | None, by the owner's decision | |

## Out of scope

- Deleting the unused `HoReCaAdmin` and `InvoiceAdmin`.
- `HoReCaProfile`'s header, and other detail screens.
- QR Staff's top bar saying "Shop" while on Pantry.
- Manager blank pages and the dead Order Import Back button.
- Tables, cards and empty states.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `page header adoption > the rep and customer pages use PageHeader with no hand-rolled h1 or header icon` fails on base by assertion, passes on tip | |
| A2 | claimed | `page header adoption > rep Scheduled Visits and Order History use the standard titles` fails on base by assertion, passes on tip | |
| A3 | claimed | `page header adoption > Rep Dashboard and Order home stay visible on phones` fails on base by assertion, passes on tip. On dev at edf100f at 360px: "Good evening, Charlie" 194px wide, "Seaside Bistro" 125px wide, so neither is the 1px screen-reader box | The date reads "Thursday 5 November" |
| A4 | claimed | `page header adoption > rep Scheduled Visits and Shop use PageTabs` fails on base by assertion, passes on tip. On dev at edf100f, each enabled tab pressed became the current tab | |
| A5 | claimed | `PageTabs > a disabled tab cannot be chosen and says why` fails on base by assertion, passes on tip. On dev at edf100f as Field Rep at 1280px and 360px: Pantry List disabled with its reason and Reorder hidden before a HoReCa is selected, both enabled and pressable after | Reorder stays hidden, not disabled, for a rep with no HoReCa selected, as on base |
| A6 | claimed | `page header adoption > Shop has a screen-reader heading and no visible title` fails on base by assertion, passes on tip. On dev at edf100f the one h1 reads "Shop" in a 1px box at all three widths | |
| A7 | claimed | `page header adoption > no page outside the allow-list hand-rolls a page title` fails on base by assertion, passes on tip. It also fails if an exception stops being needed | It reads `components/` and `views/` for `h1` and the standard title style, so a page with a differently styled `h2` as its title would pass |
| A8 | claimed | On dev at edf100f at 1280px, 768px and 360px: the bar is `position: sticky` and reaches both edges of main (0px each side). As Customer, the HoReCa box, search, sort and cart button are in the 1280px screenshot, and Pantry List shows its count and ~$135 estimate. At 360px the estimate is hidden, as on base | Sticky is the computed style; the page was not scrolled to watch it hold. The cart was not opened. Nothing was added or placed |
| A9 | claimed | On dev at edf100f: 24 page views across Field Rep, Office Rep and Customer at 1280px, 768px and 360px, 33 tab presses, 0px overflow on all. At 360px header buttons, tabs and Shop's sort box 44px. `--project=mobile` against a build of the branch: 27 passed, 2 skipped. Skipped: `touch-targets.spec.ts:35` Putaway and Replenishment walk cards | The mobile suite does not visit these pages, so the 360px evidence is the measurement script. Order home has no header buttons or page tabs |
| A10 | claimed | On dev at edf100f as Customer (Seaside Bistro) at 1280px: the column is 608px wide, starting 224px inside main | The inner width is max-w-2xl less its padding |
| A11 | not-claimed | | Dev serves edf100f4599f0d539ee600ae504634a8b5878ef0, health 200, but that is a throwaway merge so the unmerged NX-0012/0013/0014 demo work stays on dev, and this is before the merge. Not pushed |

### Not claimed

- No walk on the RS35 handheld. All 360px evidence is Playwright at that viewport.
- QR Staff was not logged in, because it needs a venue QR and PIN. So "Hi Name" on Order home was seen only in `kitchenHomeView.test.tsx`, not in a browser, and the Customer view of Order home has no small line.
- The Rep Dashboard's "visits today" chip did not appear, because neither rep has a visit today on dev. The target chip did.
- The 768px runs were headless, so no visible scrollbar took up width. Other tablet widths were not walked.
- Admin and Manager were not walked on Shop in this batch, though they share the same view.
- `--project=contrast` passed (1 passed), but it covers the Warehouse surfaces only, so contrast on these pages was not measured. The new estimate text uses stone-600 on white by choice, not by measurement. The chromium project was not run.
- Nothing was saved in a browser. No order was placed and nothing was added to a cart or pantry. The controls pressed were sign-in, sidebar links, the phone menu, toast close buttons, page tabs, Order home's three shortcuts and Shop's HoReCa selector.
- The two new sentences have not been read by reps or customers.
- `HoReCaProfile` keeps its own header, and `HoReCaAdmin` and `InvoiceAdmin` are still in the repo unused.
- Playwright logins used the demo accounts the dev login page publishes.
