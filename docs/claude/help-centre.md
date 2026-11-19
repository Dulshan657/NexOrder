# Help centre and printed guides (NX-0038)

The public help centre lives at **`/help`**, and its printable guide at **`/help/print`**.
Both are built from one set of React articles, so the page and the PDF cannot drift
apart. It exists because the owner (Peter, 15 Nov 2026) asked for a user guide for
Aslam & Co's warehouse, in the style of the CheckLinx *QR Labels Quick Guide* PDF and
reachable from inside the app, like Build Doc's help centre.

## What is where

| | |
|---|---|
| Table of contents | `components/help/manifest.ts`: slug, title, summary, section, audiences. Its order is reading order everywhere. |
| Article bodies | `components/help/articles/*.tsx`, keyed by slug in `articles/index.ts` |
| Building blocks | `components/help/primitives.tsx`: `Steps`/`Step`, `Callout`, `Shot`, `WithShot`, `TroubleTable`, `Ui`, `TabName`, `Section` |
| The three views | `components/help/HelpCentre.tsx`: index, article, print |
| Print rules | `components/help/helpPrint.css`: **named** `@page guide` / `guide-cover` only |
| Routing | `lib/help/helpRoute.ts` `parseHelpPath`, branched in `index.tsx` `Root()` |
| Audience filter | `lib/help/helpAudience.ts`: Warehouse → `floor`, Admin/Manager → `supervisor`, others → none |
| Entry points | ProfileMenu **Help** (new tab, `?for=<audience>`), `HelpLink` "?" in the Receive Stock and Putaway headers |
| Screenshots | `components/help/shots/*`, imported as modules (hashed, and a missing file fails the build) |

## Rules that must hold

- **Public, so self-contained.** `/help` renders before AuthGate, signed out. Nothing
  under `components/help/` may import `useAuth`, supabase or react-query. The page is
  still unlisted (`X-Robots-Tag: noindex`, `robots.txt`).
- **The branch in `Root()` sits ahead of the set-password check.** If it were behind
  it, a pending password marker would turn every help link into the password screen.
- **Shipped with `inventory_dispatch`.** `HelpCentre` is one lazy chunk, gated at its
  declaration in `index.tsx`. The only guide is the warehouse one. A guide for another
  module needs its own gate before it ships to a tenant without that module.
- **Normal document flow, never `h-svh`.** A fixed-height frame with an inner scroller
  prints as one clipped page.
- **Never add a bare `@page`.** The stylesheet loads with the help chunk, so a bare
  rule would put the guide's footer on anything else printed from that tab.
- **The audience filter is a convenience, not a control.** Every article is public.
- **Callout letters are decoration.** Badges are `aria-hidden`, and the legend under
  each shot carries the same information as text.

## Adding an article

1. Add the entry to `manifest.ts` in reading order, and the body to `articles/`
   and `articles/index.ts`.
2. `__tests__/help/manifest.test.ts` pins the Phase 1 slug list, so update it
   deliberately.
3. Use `<TabName tab="…">` for a screen name, so it is type-checked against
   `ADMIN_TAB_LABELS`. Button copy in `<Ui>` is **not** checked against the UI.

## Screenshots

`npm run help:shots` runs `scripts/help/capture-screens.ts`. It drives one real
delivery end to end on the demo: receive 3 cartons under the reference `GUIDE-<date>`,
walk them to the bin, look the bin up, then take the supervisor's Assign screen.

- **It writes stock.** `captureBase.ts` refuses anything except the demo origin or
  localhost. Run `npm run export:demo` first; it is the demo's only backup.
- It signs in with the demo login chips, so it only works against a demo build.
  Local dev is `npm run dev` with `.env.dev.local`, which is the demo database.
- **It is shot in the demo's `Amadiya` warehouse (id 2873, owner request),** using
  the Amadiya Agro product *Roasted Curry Powder - 200g X 40*. Receiving is locked to
  the user's home site, so for the run the Warehouse demo login
  (`warehouse@nexorder.com.au`) was re-homed to 2873 and put back to 1 (Main
  Warehouse) afterwards:
  ```sql
  update profiles set home_warehouse_id = 2873 where email = 'warehouse@nexorder.com.au'; -- before
  update profiles set home_warehouse_id = 1    where email = 'warehouse@nexorder.com.au'; -- after
  ```
  Use `node supabase/apply-sql.mjs --env=dev --query "…"`.
- `--only=floor|supervisor` runs one half. `--from=walk` resumes after a receive that
  succeeded, because receiving again leaves two open lines for the product and makes
  its scan ambiguous.
- The engine may split one receipt over many stops when the fast-mover bins are
  small. Each run leaves the rest of the delivery on the Amadiya Walk.
- **Last captured:** 2026-11-17, on branch `feat/NX-0038-help-centre` (base
  `b83a997`). Re-run after a brief changes Receive Stock, the Putaway walk or
  assign screens, or Stock → Look up.

## The PDF

Run `npm run dev`, then `npm run guide:pdf` (or `-- --base=https://nexorder.vercel.app`).

- The output is `out/guides/nexorder-receipt-putaway-guide.pdf` (gitignored).
- The script waits for fonts and every image decode, refuses broken images, and
  **fails over 5 MB**.
- First build: 12 A4 pages, 1.5 MB.
- The cover image is Peter's *Warehouse Journey Map*, hand-converted to a 1600px JPEG
  (`shots/journey-map.jpg`). There is no image tool in the repo, and a lossless image
  would bloat the PDF.
