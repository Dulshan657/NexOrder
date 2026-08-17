# Recoding a site's bin codes

How to give a warehouse's bins codes an operator chose, and how to check it worked.
Migrations `00107` (provenance, pattern store, the two-phase RPC) and `00108`
(numbering origin, sweep history).

## What a sweep is

Paint a block of bins on the live map, name the block, and every bin in it is
recoded. `locations.code` starts life as a grid coordinate — `AMADIYA-B-3-4`, which is
where the cell happened to sit — and a sweep replaces that with a scheme the operator
states.

The code is the Code 128 payload, the `resolveScan` key, a `materialized_path`
segment and the CSV `bin_code`, so a sweep is a real rewrite of a site's identity
layer. It is also completely reversible; see **Undo** below.

## Doing one

Warehouse tab → **Recode bins** (Admin or Manager). The panel opens beside the map and
the map stays live throughout.

1. **Select.** Brush over the bins you want. `Alt` pans. The Box tool drags a
   rectangle and takes only what it fully covers, so it cannot swallow a rack it
   merely clips. Erase removes. Ctrl-level undo is per stroke, not per cell.
   Shortcuts: click a painted area's name to take the whole area, or a block chip to
   re-select a block you have already done.
2. **Block.** Type the block name — `BULK`, `COLD-A`. It sanitizes as you type
   (uppercase, no spaces). If the selection sits inside one painted area, its name is
   offered as a starting suggestion you can overtype.
3. **Numbering.** *Row & column* gives `BULK-1-1, BULK-1-2, BULK-2-1` and restarts for
   every block. *One running number* gives `BULK-01, BULK-02` — shorter codes, wider
   barcode bars. Pick which corner is `1-1`; the numbers on the map redraw as you
   click. Controls that the pattern cannot honour are not shown, with the reason in
   their place.
4. **Review.** The server says what it would do. Check the from→to list, the rack
   level codes, and the bar-width verdict. Then **Recode N**.

The Apply button is visible at every step. When it is disabled it says why.

## After applying

- **The stickers on those bays are now wrong.** A recode resets `label_printed`, and
  the success step offers a label job pre-filled with exactly the bins that moved.
- **Undo** is offered on the success step and on the Select step for as long as the
  sweep is the most recent un-reverted one — including after a reload or the next day.
  Only the newest sweep can be undone; anything older is corrected by sweeping again.

## Setting the site's convention

Settings → Warehouse → **Bin code pattern**. Sets the template, default block,
numbering origin and fill order the wizard opens on. "Reset to the built-in pattern"
deletes the row — no row means the built-in default, which is the one representation
of that state.

This is read by the sweep only. Bins drawn in the layout designer are still given a
grid code and can be recoded afterwards.

## Verifying (dev first, then a tenant)

Everything below runs on `dev` before it touches a client.

```bash
node supabase/migrate.mjs --env=dev --dry-run     # expect 00108 pending, nothing else
npm run migrate:dev
npm run fn:deploy:dev mutate-warehouse-location   # then mutate-warehouse, generate-labels
npm run dev
```

Then, in a browser, the checks that matter — in this order, because each one can only
be trusted if the one before it passed:

1. A band that clips a neighbouring rack does not take it.
2. Type the block: the sample reads `<WH>-<BLOCK>-1-1`, and the map agrees.
3. Click a different origin corner: the numbers re-frame, and that corner becomes
   `1-1`.
4. Review: the server's from→to list must show the **same codes the map showed**. If
   it does not, the client and server have drifted on which template they resolve to —
   that has happened once and it reproduced the original bug exactly.
5. Apply, then **re-run the identical sweep**. It must report `0 to recode · N already
   correct`. This is the single most important check: idempotence is what
   `d191c73` fixed and what any change to the numbering can silently break.
6. Grow the block from outside it: the sweep must be **refused**, naming every member
   that would move, and offering both re-frame and renumber-all.
7. Undo, then reload and confirm the offer is gone once used.

SQL, read-only, after a sweep:

```bash
node supabase/apply-sql.mjs --env=dev --query "
  SELECT count(*) AS parked FROM locations WHERE code LIKE '~RECODE~%';   -- expect 0
  SELECT count(*) AS drift FROM locations l JOIN locations p ON p.id=l.parent_id
   WHERE l.materialized_path <> p.materialized_path || '/' || l.code
     AND l.materialized_path LIKE '<WH>/%';                               -- expect 0
  SELECT code_block, count(*), min(code_seq), max(code_seq) FROM locations
   WHERE materialized_path LIKE '<WH>/%' AND code_block IS NOT NULL GROUP BY 1;"
```

> On dev's **MAIN** the drift query returns 378 site-wide. That is pre-existing: those
> rows carry a `-X<id>` de-duplication suffix in their code that was never written into
> their path. Scope the query to the site you swept, or you will chase it.

Performance, given the documented 945-bin freeze: with the React DevTools Profiler
recording, paint a long stroke. `WarehouseCanvas` must **not** appear in the commit
list — only `MapSelectionLayer`.

## Releasing to a tenant

Only after all of the above passes on dev. Merge to `main`, deploy dev, tag, then from
the tenant workspace (`C:\Users\dulsh\nexorder-amadiya`):

```bash
npm run migrate:amadiya
npm run fn:deploy:amadiya mutate-warehouse-location   # then mutate-warehouse, generate-labels
npm run deploy:amadiya
```

Do the first real sweep on a **small block with no stock and no printed labels**. It is
reversible either way, but a small first run is how you find out whether the site's
convention is what everybody assumed.
