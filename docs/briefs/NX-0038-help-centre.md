# NX-0038 — Help centre and the Receipt & Putaway quick guide

```json brief
{
  "id": "NX-0038-help-centre",
  "base": "b83a997bc3321c6800662bab61f6f3bde728d464",
  "approved": "2026-11-17 owner",
  "acceptance": [
    { "id": "A1", "check": "parseHelpPath maps /help to the index, /help/<slug> to that article, /help/print to the print guide (a trailing slash tolerated), and returns null for /, /helpdesk and any other path." },
    { "id": "A2", "check": "helpAudienceForRole returns 'floor' for Warehouse, 'supervisor' for Admin and Manager, and null for every other role; visibleArticles with an audience keeps only articles for it, in manifest order, and with no audience keeps all." },
    { "id": "A3", "check": "The manifest holds the six Phase 1 articles (journey, receive, put away, check stock, assign putaway, troubleshooting) with unique slugs, and every slug has an article body." },
    { "id": "A4", "check": "The expanded profile menu shows a Help link opening /help?for=floor (Warehouse) or /help?for=supervisor (Admin, Manager) in a new tab, and shows none to a Customer or a kitchen (QR Staff) session." },
    { "id": "A5", "check": "The help centre index lists the visible articles by section; with ?for=floor it hides the supervisor article and offers 'Show all articles'; an article page shows its title, steps and an 'All articles' link back." },
    { "id": "A6", "check": "Each screenshot callout's meaning is available as text: badges are aria-hidden and a legend lists every letter; the help index and one article have no axe violations." },
    { "id": "A7", "check": "Receive Stock and Putaway each carry a '?' help link in their page header to the matching article, opening in a new tab, with an accessible name naming the topic." },
    { "id": "A8", "check": "The print guide renders a cover, a How it works page and every article in manifest order, each article starting a new page." },
    { "id": "A9", "check": "The screenshot capture script refuses any base URL that is not the demo origin or localhost." },
    { "id": "A10", "check": "Signed out, /help on the demo shows the help centre, not the login page; Help from the profile menu and the header '?' work as the warehouse demo user at 360px.", "manual": "browser walk on nexorder.vercel.app after deploy:dev" },
    { "id": "A11", "check": "npm run guide:pdf produces an A4 PDF under 5 MB with a full-bleed cover (Peter's journey map) that follows the Chamal Quick Guide layout.", "manual": "run the script, open the PDF, compare page by page" },
    { "id": "A12", "check": "Screenshots are captured on the demo only; no tenant data appears in any image.", "manual": "review every file in components/help/shots/" },
    { "id": "A13", "check": "Deployed to dev; /version.json shows the branch sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/profileMenuKitchen.test.tsx", "test": "ProfileMenu — help link > a Warehouse user gets Help for the floor, in a new tab", "proves": ["A4"] },
    { "file": "__tests__/profileMenuKitchen.test.tsx", "test": "ProfileMenu — help link > an Admin and a Manager get Help for supervisors", "proves": ["A4"] },
    { "file": "__tests__/profileMenuKitchen.test.tsx", "test": "ProfileMenu — help link > a Customer and a kitchen session get no Help link", "proves": ["A4"] },
    { "file": "__tests__/help/helpRoute.test.ts", "test": "parseHelpPath > maps the help paths and ignores everything else", "proves": ["A1"] },
    { "file": "__tests__/help/helpAudience.test.ts", "test": "helpAudienceForRole > maps each role to its audience", "proves": ["A2"] },
    { "file": "__tests__/help/helpAudience.test.ts", "test": "visibleArticles > filters by audience in manifest order", "proves": ["A2"] },
    { "file": "__tests__/help/manifest.test.ts", "test": "help manifest > holds the six Phase 1 articles, each with a body", "proves": ["A3"] },
    { "file": "__tests__/help/helpCentre.test.tsx", "test": "HelpCentre > floor readers do not see the supervisor article until they ask", "proves": ["A5"] },
    { "file": "__tests__/help/helpCentre.test.tsx", "test": "HelpCentre > an article shows its steps and a way back", "proves": ["A5"] },
    { "file": "__tests__/help/helpCentre.test.tsx", "test": "HelpCentre > the print guide has a cover and every article in order", "proves": ["A8"] },
    { "file": "__tests__/help/shot.test.tsx", "test": "Shot > hides the badges and lists every callout as text", "proves": ["A6"] },
    { "file": "__tests__/a11y/help.test.tsx", "test": "help centre a11y > index and an article have no axe violations", "proves": ["A6"] },
    { "file": "__tests__/help/helpLink.test.tsx", "test": "HelpLink > opens the article in a new tab with a named topic", "proves": ["A7"] },
    { "file": "__tests__/help/captureBase.test.ts", "test": "assertCaptureBase > allows only the demo origin and localhost", "proves": ["A9"] }
  ],
  "allow": []
}
```

## Goal

Peter (15 Nov 2026) asked for a user guide for Aslam & Co's warehouse, modelled on
Chamal's CheckLinx *QR Labels Quick Guide* PDF and, ideally, reachable from inside the
app like Achintha's Build Doc help centre. This PR builds both from one source:
- a public, unlisted `/help` with the Phase 1 (Receipt & Putaway) articles, reached from
  the profile menu and a "?" link on Receive Stock and Putaway;
- a print page that Playwright turns into a Chamal-style A4 PDF, with Peter's
  *Warehouse Journey Map* as the cover.

## Approach

- **`components/help/`.** This holds `manifest.ts`, which is pure data (6 articles, with
  audiences `floor` and `supervisor`), plus `articles/*.tsx`, the primitives (`Steps`,
  `Callout`, `Shot` with aria-hidden badges and a text legend, `TroubleTable`, `TabName`,
  `HelpLink`), `HelpCentre` (index, article and print views) and `shots/` (imported as
  modules, so they are hashed). Nothing in it imports auth, supabase or react-query.
- **`lib/help/helpRoute.ts`** holds `parseHelpPath`, and **`lib/help/helpAudience.ts`**
  holds `helpAudienceForRole` and `visibleArticles`.
- **`index.tsx`.** Add one `MODULE_INVENTORY_DISPATCH`-gated `lazyWithRetry` declaration.
  `Root()` renders `HelpCentre` for a help path ahead of the set-password check and
  outside AuthGate.
- **Entry points.** `ProfileMenu.tsx` gets a Help link in the expanded block. The
  `ReceiveStockView` and `PutawayQueuePage` `PageHeader` actions each get a `HelpLink`.
- **Print.** New `@media print` / `@page` rules and a full-bleed cover. The cover image is
  a hand-converted JPEG, with no new dependency.
- **Scripts.** `scripts/help/capture-screens.ts` is standalone and demo-guarded via
  `assertCaptureBase`, and uses the existing e2e login helpers. `scripts/help/build-guide-pdf.ts`
  uses `page.pdf` A4 and fails over 5 MB. Two npm scripts are added, and `out/guides/` is
  gitignored.
- **Docs.** Add `docs/claude/help-centre.md` and a one-row stub in CLAUDE.md. Add `/help`
  to `tests/a11y/` (not fail-first).

## Out of scope

- Phase 2 (Pick, Pack & Ship) and Phase 3 (Deliver & Invoice) guides.
- Search and audience cards in the help centre.
- Mario's company-wide help format, and anything for CheckLinx.
- Shipping to Amadiya. That waits for a later `rel-*` tag.
- Keeping screenshots and button copy in sync with the UI automatically.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `parseHelpPath > maps the help paths and ignores everything else` | |
| A2 | claimed | `helpAudienceForRole > maps each role to its audience`, `visibleArticles > filters by audience in manifest order` | |
| A3 | claimed | `help manifest > holds the six Phase 1 articles, each with a body` | |
| A4 | claimed | `ProfileMenu — help link` (3 tests) fail by assertion on base; live on dev: Warehouse → `/help?for=floor`, Admin → `/help?for=supervisor`, both `target=_blank` | |
| A5 | claimed | `HelpCentre > floor readers do not see the supervisor article until they ask`, `HelpCentre > an article shows its steps and a way back` | |
| A6 | claimed | `Shot > hides the badges and lists every callout as text`, `help centre a11y > index and an article have no axe violations`; plus `tests/a11y/help.a11y.spec.ts` 2/2 in Chromium (contrast measured) | |
| A7 | claimed | `HelpLink > opens the article in a new tab with a named topic`; live: Receive Stock "?" opened `/help/receive-a-delivery` in a new tab | |
| A8 | claimed | `HelpCentre > the print guide has a cover and every article in order` | |
| A9 | claimed | `assertCaptureBase > allows only the demo origin and localhost` | |
| A10 | claimed | dev `c86b3b2`: signed-out `/help` at 360px shows "Receipt & Putaway", no login form; profile Help and both header "?" links checked as the Warehouse and Admin demo users | |
| A11 | claimed | `npm run guide:pdf -- --base=https://nexorder.vercel.app` → 12 A4 pages, 1.50 MB, full-bleed cover with the journey map, footer + page numbers on pages 2–12 | 12 pages against Chamal's 7: each article starts a new page and the phone screenshots are tall |
| A12 | claimed | all 10 files in `components/help/shots/` reviewed | Shot in the **demo's** "Amadiya" warehouse (dev id 2873) with the demo's Amadiya Agro catalogue rows, at the owner's request on 2026-11-17; no production data. The Warehouse demo login was re-homed to 2873 for the run and restored to 1 |
| A13 | claimed | `deploy:dev` VERIFIED: nexorder.vercel.app/version.json = `c86b3b2`, health 200 | Deployed as a combined build: NX-0037 (`f656a7e`, unmerged, already on dev) merged with this branch, so dev did not lose NX-0037. `c86b3b2` is that merge, not this branch's tip |

### Not claimed

- Not walked on the physical RS35; the phone checks are Chromium at 360×664.
- Button copy in `<Ui>` is not checked against the UI; only screen names (`TabName`) are type-checked.
- The screenshots are fresh as of 2026-11-17 and nothing keeps them current.
- On a phone the Receive Stock "?" sits on its own row above the form (about 50 px), because that header had no other actions.
- The capture run left demo data behind: a GUIDE-2026-11-17 receipt in Main Warehouse (Pho Soup Paste, put away; plus an earlier Coconut Milk 400ml line still on the Main walk) and the Roasted Curry Powder receipt in Amadiya, with about 10 stops still on its walk. `demo-export/` was refreshed before the run.
- Not shipped to Amadiya (nexorder.com.au); that waits for a later `rel-*` tag.
