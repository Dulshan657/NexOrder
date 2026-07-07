# Tridon Demo — repeatable PO Inbox demo (hardware tools)

A self-contained, cookie-cutter demo: email the **same two purchase orders** into
the connected demo inbox every time, and every time **one auto-approves** and **one
is flagged for review**. Re-sending the same PDF is *not* treated as a duplicate —
the PO Inbox dedups only on the mail provider's message id, and a real re-send
always gets a new one.

Everything the demo needs lives in this folder.

| File | What it is |
|------|------------|
| `tridon-sydney-auto.pdf` | PO that **auto-approves** (all lines are catalogued SKUs). Email this. |
| `tridon-sydney-review.pdf` | PO that **needs review** (one brand-new uncatalogued tool). Email this. |
| `specs.mjs` | The two PO definitions (edit here, then regenerate the PDFs). |
| `generate.mjs` | Regenerates the two PDFs from the specs. |
| `seed.mjs` | Arms the demo (login + customer + products + trusted sender). |
| `reset.mjs` | Clears the queue between demos. |

## Prerequisites (one-time)

1. `NexOrder/.env.local` has `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. The base DB is seeded (`npx tsx supabase/seed.ts`) — provides an admin profile,
   a supplier, and an active warehouse.
3. **A demo inbox mailbox is already connected in PO Inbox and the poll cron is
   running.** (This demo does not set that up.)
4. You can send email **from** `dulshanb@nexgeninnovations.com.au` (the trusted
   sender). To use a different address, set `TRIDON_DEMO_SENDER` when seeding.

## Run a demo

```bash
# 1. Arm the demo (idempotent — safe to re-run).
npm run demo:tridon:seed

# 2. (only if you edited specs.mjs) regenerate the PDFs.
npm run demo:tridon:pdfs
```

Then:

3. Log in as **`tridon@nexorder.demo` / `Password123!`** → you land on **PO Inbox**
   with Tridon branding.
4. From `dulshanb@nexgeninnovations.com.au`, email **`tridon-sydney-auto.pdf`** to
   the demo inbox. Within a poll cycle it appears in the queue and **auto-approves**
   (an order is created).
5. Email **`tridon-sydney-review.pdf`** the same way. It lands as **needs review**
   because the Milwaukee impact wrench isn't in the catalog yet — demonstrate
   mapping the new SKU and approving.

```bash
# 6. Between demos — wipe the queue + auto-created orders for this sender.
npm run demo:tridon:reset
```

`reset` leaves the login, customer, products, and aliases in place, so you only
reset between runs — you don't re-seed. Use `npm run demo:tridon:reset -- --dry-run`
to preview what would be deleted.

## What makes each PO behave

Auto-approve fires only when **all** of these hold (see
`supabase/functions/_shared/poInbox/statusDecision.ts`):

- auto-approve master switch on (default),
- extraction confidence ≥ 0.95,
- **customer resolved** — the sender maps to Sydney Tools (`seed.mjs` sets both
  `horecas.contact_email` and a `sender_email` alias to the demo sender),
- **every line maps to a product** — `seed.mjs` catalogues the SKUs + aliases,
- sender **trusted** (same alias), and enough stock (50 seeded per SKU).

`tridon-sydney-review.pdf` deliberately breaks exactly one of these: its third
line (`MILW-M18-FUEL-2767`) has no product/alias, so *all lines resolved* fails →
`needs_review`. The customer still resolves and the sender is still trusted, so the
story is "known buyer, brand-new tool we haven't set up yet."

## ⚠ Sender collision with the V2food demo

The default sender `dulshanb@nexgeninnovations.com.au` is **also** the V2food
demo's trusted sender. A `sender_email` maps to exactly one customer, so
`npm run demo:tridon:seed` **repoints** that address from Young & Jacksons (V2food)
to Sydney Tools. Consequences:

- Running this demo disables V2food auto-approve for that sender.
- Before running a V2food demo again, re-run `npm run seed:v2food-demo`.

To avoid the collision entirely, use a dedicated address:

```bash
TRIDON_DEMO_SENDER="hardware-demo@yourdomain.com" npm run demo:tridon:seed
# ...and send the POs FROM that same address. Set it for reset too if you use it.
```

## Troubleshooting — "it didn't auto-approve"

- **Landed in review instead:** confirm you sent from the trusted sender, and that
  `npm run demo:tridon:seed` ran after the last `npm run seed:v2food-demo` (which
  would have stolen the sender back). Re-run the Tridon seed.
- **Nothing appeared in the queue:** the mailbox/poll cron isn't picking mail up —
  that's the connected-inbox setup, outside this demo.
- **Auto PO stuck in review with "short on stock":** re-run `npm run demo:tridon:seed`
  to top stock back up (the reconcile cron or prior orders may have drawn it down).
- **Tear everything down:** `npm run demo:tridon:reset` (queue/orders) then
  `node tridon-demo/seed.mjs --clean` (login + customer + products).

## Teardown

```bash
npm run demo:tridon:reset          # queued POs + auto-created orders
node tridon-demo/seed.mjs --clean  # login, customer, products, aliases
```
