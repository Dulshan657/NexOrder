# WIE demo warehouse

A self-contained, repeatable seed that gives the read-only **Warehouse** viewer
(Inventory & Dispatch → Warehouse) real, overlay-lit data to demo the Warehouse
Intelligence Engine.

```bash
npm run demo:wie:seed     # arm the demo (runs reset first — idempotent)
npm run demo:wie:reset    # tear it all down
```

Credentials come from `NexOrder/.env.local` (`VITE_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY`). Requires the base seed to have run first
(`npx tsx supabase/seed.ts`) so at least one profile + horeca exist.

## What it builds

- **Warehouse** `WIE-DEMO` ("WIE Demo DC"), `location_type = racked`.
- **Published, 2-floor layout** (24×16): two floor-0 corridors + a spine to the
  dock, a floor-1 corridor, and a **lift** co-located at (11,2) on both floors so
  routes cross floors. ~48 bins across 3 zones → 2 aisles → 2 racks → 4 bins.
- **10 products** with varied `size_factor` so occupancy fills spread out.
- **Stock** scattered with varied fill: some bins empty, most partial, a few at/
  over capacity.
- **~150 historical picks** over 90 days, **skewed** so P01–P03 classify **A**
  (fast), P04–P07 **B**, P08–P10 **C** — and, because the fast movers live and get
  picked in Zone A, those bins become the **congestion hotspot**.
- **2 re-slotting suggestions** (far bin → near-dock empty bin).
- **1 allocated order** (`WIEDEMO-ORD-1`) so the **pick-route** dry-run has a real
  target.

Then it calls `wie_refresh_velocity` + `wie_refresh_location_traffic` so every
overlay lights up immediately.

## How it publishes

`lib.mjs` ports the engine's walkway-graph builder
(`supabase/functions/_shared/wie/graph.ts`) to plain JS, builds the
node/edge/distance/snap payload from the demo geometry, and calls the
`wie_publish_layout_tx` RPC directly (service-role) — same writes the
`publish-layout` edge function makes, without needing an admin session.

## Namespacing / teardown

Every code is namespaced `WIEDEMO-` (warehouse `WIE-DEMO`, order `WIEDEMO-ORD-*`).
`reset.mjs` deletes strictly by those keys in FK-safe order, so it never touches
other data and re-seeding is clean.
