# Accessibility, and the public surface

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The load-bearing summary stays in `CLAUDE.md`;
> this is the full detail behind it. **Edit here, not there.**


Target is **WCAG 2.2 AA, enforced** rather than audited. Added 2026-08-28, when
this repo had no ESLint of any kind and the Playwright suite had never run in CI.

**Three tiers, because each is blind exactly where the next one sees.**

| | what it covers | what it CANNOT | runs |
|---|---|---|---|
| `npm run lint` — eslint-plugin-jsx-a11y | names, roles, keyboard reachability, ARIA validity, statically | anything about the rendered result | CI, `verify` job |
| `__tests__/a11y/*.test.tsx` — axe in jsdom | the same, resolved against a real accessibility tree, on AUTHENTICATED components with no database | **colour contrast** — jsdom has no layout or computed colour, so axe disables that rule outright | CI, inside `npm test` |
| `tests/a11y/*.spec.ts` — axe in Chromium | contrast, for real | anything behind AuthGate: there is no router, so the two signed-out screens are all it can reach | CI, `a11y` job |
| `tests/contrast/` — authenticated crawl | contrast on the ten Warehouse surfaces | — | **never in CI**; needs real credentials |

The fourth is an instrument with the standing of `perf` and `soak`, and it is the
only thing that can measure colour behind the login. It found 13 real defects on
its first run that no other tier could see. Do not delete it to tidy up.

- **`eslint-suppressions.json` is the ratchet.** 273 findings frozen across 96
  files; anything new is an **error**, including a second violation added to a
  file that already has some — the case `check-overlays.mjs`'s baseline cannot
  express. Shrink it with `npm run lint:prune` after a fixing change. **Never add
  an entry by hand.** What remains is almost all the form-label long tail: ~242
  raw `<input>`/`<textarea>` with no programmatic label, across ~80 files.
- **ESLint is PINNED TO 9.** `eslint-plugin-jsx-a11y@6.10.2` peers `^3 || … || ^9`
  and ESLint 10 is out, so a plain `npm i -D eslint` resolves to 10 and refuses
  to install. The plugin is the constraint, not the linter.
- **`eslint.config.js` has NO `parserOptions.project`, deliberately.** There is no
  `@types/react` here and `strict` is off, so every React type is `any` and a
  type-aware rule set would be mostly wrong. jsx-a11y is purely syntactic and
  needs none of it.
- **`react-hooks` is registered with every rule OFF**, purely so the tree's 19
  pre-existing `eslint-disable-next-line react-hooks/exhaustive-deps` comments
  resolve instead of erroring. Hence `reportUnusedDisableDirectives: 'off'`.
- **`no-autofocus` is off, and that is a judgement.** All 30 findings are
  deliberate: ScanField, PickTaskRow, PutawayStopCard, ReplenStopCard and
  CountLocationFinder are scan surfaces where autofocus is load-bearing (under
  the RS35's default Input Method mode a scan field that loses focus means a scan
  that silently does not happen), and the rest are dialogs focusing their first
  field. Freezing 30 deliberate decisions as debt would make the baseline lie.

**Contrast: measure, do not calculate.** Tailwind v4 ships an **OKLCH** palette,
so `stone-400` renders `#a6a09b`, not the `#a8a29e` from the v3 hex table — and
every figure moves the wrong way. The authoritative values are the `--color-*`
custom properties in the BUILT css.

| on | white | stone-50 | stone-100 | stone-200 |
|---|---|---|---|---|
| `stone-400` `#a6a09b` | 2.59 | 2.48 | 2.37 | 2.06 |
| `stone-500` `#79716b` | 4.81 | 4.61 | **4.41** | **3.83** |
| `stone-600` `#57534d` | 7.64 | 7.32 | 7.01 | 6.08 |
| `nexgen-blue` `#2988de` | 3.70 | 3.55 | 3.40 | 2.95 |
| `nexgen-blue-dark` `#2472c2` | 4.93 | 4.72 | 4.52 | 3.92 |

- **`stone-500` FAILS on a `bg-stone-100`/`200` tint.** That is why the sweep
  targets stone-600 wherever an element carries a resting tint — and why a
  same-line rule is not enough: on the warehouse surfaces the tint is usually on
  a **parent**, which only rendering finds.
- **`hover:bg-stone-100` is not a resting tint.** Matching it pushed 27 icon
  buttons to stone-600 for a state they are not in.
- **`disabled:text-stone-400` (13) stays.** WCAG 1.4.3 exempts inactive
  components; darkening them erases the disabled affordance for no gain.
- **Dark surfaces use `stone-300`, never `stone-400`** — see the measured table
  at `index.css:330`. A blanket `stone-300 → 400` shift would reverse a
  documented fix on the navy login rail.
- **Two exceptions are DISCLOSED, not hidden:** brand blue at 3.70:1 (and 3.30:1
  on its own `/10` tint), and the severity badge palette — white on red-500,
  amber-500 and blue-500 is 2.13–3.7:1, i.e. all three, not one. Both are in
  `site/accessibility.md`. **`tests/a11y/exceptions.ts` may only ever contain
  something that statement also discloses.**
- **The focus ring is `nexgen-blue-dark`, not `nexgen-blue/40`.** That composites
  to `#a9cff2` — 1.62:1, against the 3:1 SC 1.4.11 requires. It is a *different*
  criterion from the brand exception and is not covered by it. New code should
  use the dark shade for anything needing 4.5:1 rather than adding to the
  exception list.

**`components/ui/` gained three primitives.** `SortableHeader` (aria-sort on the
`<th>`, click on a real `<button>`), `SkipLink`, and `useInertBackground`.

- **`useInertBackground` marks `#root` inert, which is a SIBLING of the overlay,
  not an ancestor** — `Overlay` portals to `document.body`. That structural fact
  is what makes it safe, and it is asserted in a test: if an overlay ever renders
  inline the test fails, and it should, because the attribute would then disable
  the dialog it exists to protect. Ref-counted like `useScrollLock`.
- **`Field` points INWARD.** The label carries an id and controls inherit
  `aria-labelledby` / `aria-describedby` / `aria-invalid` from context, rather
  than the wrapper handing out an id. `Field` takes `children: ReactNode` and
  cannot know how many controls are inside — WarehouseForm wraps two — so one id
  would land on both. Callers passing `htmlFor` keep their native association.

### The public surface

Both hosts are **UNLISTED**: `public/robots.txt` denies `*` and fourteen named AI
crawlers, and `vercel.ts` sends `X-Robots-Tag: noindex, nofollow`. The two are
not redundant — a crawler obeying robots.txt never fetches and so never sees the
header; one arriving from a pasted link never reads robots.txt.

- **Four unfurlers are allowed by name** (Twitterbot, Slackbot-LinkExpanding,
  facebookexternalhit, LinkedInBot) with an empty `Disallow:`. They obey
  robots.txt, so a blanket deny degrades a shared link to a bare URL while
  Discord and WhatsApp — which ignore robots.txt — still show a card. Do not
  "tidy" these away; inconsistent previews read as a bug.
- **`site/` is public by construction**, which is the point of it being its own
  top-level directory: `docs/` holds runbooks and an internal spec, so a glob
  there would eventually publish one. Four docs, and
  **`site/accessibility.md` is a conformance claim — keep it true.**
- **`llms.txt` is GENERATED from `site/manifest.mjs`**, so a doc cannot ship
  unlisted and the index cannot name a page that does not exist.
- **`headMetaPlugin` uses `transformIndexHtml` with the `tags` ARRAY form**, never
  the string form, which would reserialise a `<head>` holding the inline
  `<style>` that ships under `style-src 'unsafe-inline'` and two font preloads
  whose `crossorigin` stops each font being fetched twice.
- **`index.html` has NO `<title>`, deliberately.** It is injected per target. Add
  one back and the document has two; browsers use the first, so the injected one
  silently loses while the tab still looks right.
- **`/docs/*.md` is served as `text/plain`.** Vercel infers `text/markdown`, which
  with the existing `nosniff` makes Chrome and Safari offer a download.
- **`sitePlugin` also serves these from `configureServer`** — `generateBundle`
  runs only on `build`, so without it the first look at `/llms.txt` would be in
  production.

### The demo roster is derived, not configured

**`VITE_SHOW_DEMO_LOGINS` IS GONE.** It was read as `!== 'false'` — an opt-out env
var in a Vercel dashboard — so a tenant build shipped seven working logins and
their shared password unless someone remembered to type "false" into a web form.
Nobody did, and nexorder.com.au served them to a paying client.

`__DEMO_HOST__` is folded from `kind` in the registry, which already documents
`'demo'` as "fixtures allowed, demo logins shown". Inverting the env var to
opt-in would only have moved the silence: the demo would lose its roster with no
error anywhere.

- **`npm run check:demo` asserts it on the BUILT ARTIFACT, for every target, in
  BOTH directions.** A tenant-only check would pass forever if the roster
  silently vanished from the demo too.
- Its expectation comes from a **literal** target list in the script, not from
  `kind`. The first version used `kind` and failed its own negative test — that
  field drives the fold as well as the expectation, so flipping a target moved
  both together and the check approved shipping an Admin password to a client.
  Same reasoning as fixture guard #3.
- It is also **the first thing in CI ever to build a tenant target**; `npm run
  build` runs with no `NEXORDER_ENV` and has always built `dev` with every module
  on.
- **Rotating the seven seeded passwords is still outstanding.** Hiding a
  credential does not invalidate it.
