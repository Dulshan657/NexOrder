# Runbook — bring Amadiya up to `rel-2026-08-28`

> **Run every command below from `C:\Users\dulsh\nexorder-amadiya`.** The dev
> checkout physically cannot do this: `.env.amadiya.local` lives only in the
> tenant workspace, so `scripts/lib/env.mjs` `assertEnvFilePresent` refuses by
> name and `scripts/claude/guard-workspace.mjs` refuses before that.

Amadiya has been on `rel-2026-08-20` (`e2afb8e`) since 2026-08-20. `main` moved
58 commits ahead. This release closes that gap in one pass.

**Time:** ~20 minutes, most of it waiting on `fn:deploy`.

---

## What is in this release

- **13 migrations, `00114`–`00126`.** Slotting rules and the off-home queue
  (`00114`–`00121`), the two putaway space-accounting fixes (`00122`/`00123`),
  the label-print row-id column (`00124`), the pallet spec (`00125`) and pallet
  break-down (`00126`).
- **3 new Edge Functions** — `break-down-putaway`, `mutate-slotting-rule`,
  `mutate-offhome-task`. All three are `inventory_dispatch`, which Amadiya has,
  so all three ship.
- **Frontend** — the RS35 handheld sweep, the Receive Stock "Arrived on" and
  mixed-pallet rework, the recode-sweep polish, the Off-home tab.
- **A tightened CSP.** `vercel.ts` drops the Google Fonts origins; the three
  families are self-hosted from `/fonts` as of 2026-08-26.

### Why this is low-risk, stated rather than assumed

Every migration is **additive** — new tables, columns, views and functions —
plus two replaced in place (`v_bin_fill` by `00122`, `wie_putaway_candidates`
by `00123`). There is no backfill and no data rewrite anywhere in the 13.

And it is **already rehearsed**: dev (`uqvekvavkjjurpqtovbq`) runs the exact
commit being tagged, with all 128 migrations applied and all 79 functions
deployed. That is what having a non-production environment again bought.

### The one thing that would NOT be low-risk, and why it does not apply

`00122` and `00123` change what the planner believes about bin space. Neither
can repair the recommendations the **old** engine already wrote — the scoring
lives in TypeScript deliberately (see `00116`), so re-scoring means re-running
the engine, not an `UPDATE`. That is what `supabase/ops/rescore-open-putaway.mjs`
is for, and it is new in this release.

Amadiya has no stock and no open putaway tasks, so there are no such rows.
**Step 1 confirms that rather than trusting it.** The first release after real
stock lands must budget for the rescore.

---

## 0. Check out the tag

```bash
git fetch origin --tags
git checkout --detach rel-2026-08-28
npm install
```

The tenant checkout is a **worktree of the same repository**, so it shares the
object database and the tag is already present — the fetch is belt-and-braces.

`npm install` is needed because `package.json` moved, but only for two new
scripts (`check:viewport`, `rescore:putaway:*`). No new dependencies.

`requireReleaseTag` in `scripts/deploy.mjs` will check three things at step 4: a
clean tree, HEAD at a `rel-*` tag, and that tag being an ancestor of `main`.

---

## 1. Confirm the site is still empty

This is the check that licenses skipping the putaway rescore. Read-only.

```bash
node supabase/apply-sql.mjs --env=amadiya --query "SELECT (SELECT count(*) FROM wie_putaway_recommendations WHERE status IN ('suggested','assigned')) AS open_putaway, (SELECT count(*) FROM inventory_balances WHERE on_hand > 0) AS stocked_slots, (SELECT count(*) FROM products) AS products"
```

Expect zeros.

**If `open_putaway` is not 0**, do not skip ahead. Finish step 2, then:

```bash
node supabase/ops/rescore-open-putaway.mjs --env=amadiya --warehouse=<warehouse root locations.id> --dry-run
```

It needs a real Admin login — the engine sits behind Edge Functions whose
`requireAuth` refuses a service-role key, because a service-role key is not a
user. Pass `--admin=info@amadiya.com.au` and put the password in `ADMIN_PASSWORD`
in the environment. The dry run reports bays booked past their ceiling; a bay
merely *shared* by several tasks is the planner using real headroom, not a
defect. Re-running the real thing is idempotent — a second run reporting no
destination changes is the proof the repair is complete.

---

## 2. Migrations

```bash
node supabase/migrate.mjs --env=amadiya --dry-run
npm run migrate:amadiya
```

Expect exactly 13 files, `00114_products_brand.sql` through
`00126_pallet_break_down.sql`, in that order. Each commits together with its own
row in `public.schema_migrations`, checksummed — so a partial run is resumable
and an edited file is a hard error rather than a silent re-run.

---

## 3. Edge Functions

```bash
npm run fn:deploy:amadiya
```

**Expect 60 deployed**, up from 57: 79 function directories on disk, minus the
19 belonging to modules Amadiya does not have. `deploy-functions.mjs` withholds
a disabled module's functions but never RETIRES one already deployed — nothing
new becomes stale here, since all three additions are `inventory_dispatch`.

No new secrets. The changed functions read only `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, both platform-injected, and `supabase/config.toml`
is unchanged — so all three new functions keep the platform JWT gate and none of
them needs an in-body gate.

Never pass `--no-verify-jwt`.

---

## 4. Frontend

```bash
npm run deploy:amadiya
```

**`vercel alias set` will print a scope error. That is expected, and as of this
tag it is no longer fatal.** `nexorder.com.au` is reachable only under
`dulshan657s-projects` while the project lives in `nexgen14`, so the alias call
has failed on every Amadiya deploy since 2026-08-19 — and it false-aborted two
releases that were already live. `scripts/deploy.mjs` now warns and defers to the
`/version.json` sha check, which is the real verdict. This is the first Amadiya
deploy that carries that fix, so it is also the first one whose exit code can be
believed.

---

## 5. Verify

```bash
curl -s https://nexorder.com.au/version.json
curl -s https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/health
npm run check:grants:amadiya
npm run check:storage:amadiya
npm run crons:list:amadiya
```

- `version.json` must report the sha of `rel-2026-08-28`.
- **`check:grants` matters most here.** `config/lockedTables.mjs` gained five
  entries in this release — `slotting_blocks`, `slotting_block_members`,
  `slotting_rules`, `slotting_rule_blocks` and `wie_offhome_tasks` — so it is
  only a meaningful assertion once step 2 has run. It asserts against
  `information_schema` rather than against CLAUDE.md's lockdown table, which has
  been wrong before.
- `crons:list` should report **6** jobs, not 7 — `po-poll-inbox` is unscheduled
  because Amadiya has no `po_inbox`. As of this release the script *says* 6 is
  correct instead of printing a flat "expects 7" that read as a failed run.

---

## 6. Smoke-test in a browser

At `https://nexorder.com.au`, signed in as Admin:

- **Settings → Warehouse → Slotting rules** renders (new surface, `00115`).
- **Settings → Products** shows the pallet-spec sub-tab, seeded with the AU
  standard 1165 × 1165, 150 mm deck, 1650 mm of load (`00125`).
- The **Off-home** nav item appears for Admin/Manager/Warehouse — that is the
  tenth Warehouse-role surface.
- The product form offers **Brand** (`00114`), blank on every existing product.
  That is the honest value; there is no backfill by design.
- At **360 px** width the shell fits with Sign out reachable (`h-svh`, not
  `h-screen`), and the console shows **no CSP violation** for fonts. The
  tightened `style-src`/`font-src` is the one change in this release that fails
  visibly if it is wrong, and the fonts are the thing it would break.

---

## If something goes wrong

- **A migration fails partway.** The ledger is per-file, so re-running
  `npm run migrate:amadiya` resumes at the first unapplied file. Do not edit an
  applied migration — the checksum makes that a hard error. Edit forward.
- **The deploy reports failure.** Check `/version.json` before believing it. See
  step 4.
- **A function 404s after deploy.** It belongs to a module Amadiya does not have.
  Check `config/moduleOwnership.mjs` against
  `TARGETS.amadiya.modules` (`['sales_orders', 'inventory_dispatch']`).
- **Rollback.** The frontend rolls back by deploying the previous tag
  (`rel-2026-08-20`) from this same workspace. The migrations do not roll back
  and should not need to — they add, they do not rewrite. Amadiya is on Pro with
  daily backups and 7-day retention, no PITR.

## After it is live

Update `CLAUDE.md` (Pending Work item 0, and the Amadiya function count 57 → 60)
and the `warehouse-only-rollout-2026-08` / `putaway-bay-handed-out-twice` memory
notes — the second still says Amadiya is not yet deployed.
