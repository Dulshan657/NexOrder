# Module flags — what a tenant actually ships

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The load-bearing summary stays in `CLAUDE.md`;
> this is the full detail behind it. **Edit here, not there.**

- **Module flags are BUILT, and there are SEVEN as of 2026-08-20:**
  `sales_orders`, `shop`, `po_inbox`, `promotions`, `invoicing`, `field_ops`,
  `inventory_dispatch`. Two are the sidebar group headings "Field Ops" and
  "Inventory & Dispatch"; the other five subdivide the third heading, which is
  a heading and not a module. **`sales_orders` now means the order OBJECT and
  its status ladder only** — place it, advance it, cancel it.
  - **The gate is no longer inert. Amadiya carries
    `['sales_orders', 'inventory_dispatch']`** — warehouse management with
    orders keyed in by their own office. Only `dev` has everything. The split
    happened because three slugs could not express "orders and a warehouse, but
    no Shop, no PO Inbox, no Promotions and no Accounts", which is what a
    tenant actually wanted; `ALL_MODULES` had held nine finer slugs read by
    nothing until 2026-08-13, and this restores four of them.
  - **Each carved-out slug REQUIRES `sales_orders`** — an approved PO has
    nowhere to land without one, and `shop` cannot place an order.
    `MODULE_REQUIRES` states it and `assertModuleSet()` throws at import time,
    so a bad registry edit fails the build rather than shipping a nav entry
    whose Edge Function 403s. `inventory_dispatch` deliberately does NOT
    declare the dependency: a pure stock-control tenant with no orders is a
    coherent thing to sell.
  - **`NEXORDER_ENV` is what decides the module set, and it used to fail
    silently.** It lives in the Vercel project's build environment, nothing in
    the repo asserted it, and `vite.config.ts` fell back to `dev` — every
    module on. Harmless only while every target was all-on. `scripts/deploy.mjs`
    now passes it as a `--build-env` so `--env=` names the target once, and
    `vite.config.ts` **throws** on a value naming no target instead of falling
    back.
  - **A disabled module is NOT SHIPPED, not hidden.** `vite.config.ts` defines
    one boolean per module and Rollup folds the branch away, so the chunks never
    reach the tenant. That only works if the `lazyWithRetry(() => import(...))`
    **declaration** is gated, not just the JSX — and in **both** `AdminView.tsx`
    and `AppShell.tsx`, which declare some of the same views. Gating one leaves
    the chunk alive through the other.
  - **Verify by building and grepping `dist/`, never by reading.** Amadiya's
    set builds 82 assets / 3359 kB against dev's 117 / 3754 kB. Tab-name strings
    like `'Putaway'` legitimately survive — they live in the core `AdminTab`
    union — so grep for code symbols.
  - **Three "gates" were never gates, and the pattern is worth recognising.**
    `AccountsAgingTable` and `OrderImportPage` were plain top-of-file imports
    in `AdminView.tsx` — twenty lines below the comment warning about exactly
    that — and `ShopView` was eager *by deliberate choice* as the rep/customer
    landing view, which shipped the whole catalogue browse to a tenant without
    `shop`. All three are gated lazies now; ShopView costs those two roles one
    chunk fetch behind the Suspense skeleton they already had.
  - **What still leaks, stated rather than claimed clean:** `mutate-pantry-item`,
    `mutate-promotion` and `mutate-invoice-status` survive as name STRINGS in
    the main chunk, because `useInvoices`/`usePromotions` read through service
    modules that also hold the mutation calls; `mutate-visit-photo` survives via
    `VisitModal`, reached from the core customer list. Strings and one modal,
    no surfaces.
  - Server half: `_shared/modules.ts` `requireModule`, **fails OPEN** (unset
    `ENABLED_MODULES` = everything on) because a module gate is a *commercial*
    control and roles/RLS are the security ones. `config/moduleOwnership.mjs`
    maps 65 functions to modules — 3 `sales_orders`, 3 `shop`, 11 `po_inbox`,
    1 `promotions`, 1 `invoicing`, 3 `field_ops`, 43 `inventory_dispatch`;
    `deploy-functions.mjs` will not deploy a disabled module's functions at all,
    but it never RETIRES one already deployed — Amadiya's 19 now-disabled
    functions must be deleted by hand. `poll-inbox` uses `isModuleEnabled` and
    no-ops instead of throwing — it is a cron with no try/catch.
    `_shared/modules.ts` `MODULE_SLUGS` is a hand-kept copy of `ALL_MODULES`
    (`_shared` cannot import outside `supabase/functions`), policed by
    `__tests__/moduleOwnership.test.ts`.
  - **Products and HoReCa are CORE despite where the sidebar files them.**
    Sales & Orders reads product prices; orders come from the customer list.
    `HoReCa Insights` *is* Field Ops. See `TAB_MODULES` in `lib/adminTabUrl.ts`.
  - With `inventory_dispatch` off the **Warehouse role is empty**, and with
    `shop` off the **Customer role is** (its only two surfaces are the Shop and
    their own order history), so `lib/assignableRoles.ts` withholds each from
    the invite form. The Field Sales Rep is *not* withheld by either — they keep
    Order Import, the customer list and Stock. Only remove a role when the
    modules take away everything it could do.
  - **`New Order` (`components/admin/NewOrderView.tsx`) is what a tenant
    without `shop` uses to create an order.** Customer, lines, delivery date,
    notes — no cart, promotions, pantry, bundles or UOM picker. Prices are shown
    and never entered. `lib/newOrder/resolveOrderLines.ts` is pure and parses
    the paste box (commas or tabs, header row skipped, repeated SKU summed into
    one line, every refusal naming the row the operator can point at); the
    preview grid IS what gets submitted. Price the preview with
    `resolvePromotionPrice`, never `resolveHoReCaPrice` — the latter misses
    promotions and the preview silently disagreed with the order.
  - **Money is hidden from the Warehouse role** by `lib/canSeeOrderValue.ts`, a
    role test and not a module test. It reaches only `OrderDetailView` and
    `DispatchedOrdersView`: the whole `components/inventory/` tree renders no
    currency and pick slips carry units only. It is a DISPLAY rule — `orders.total`
    stays readable by anyone RLS lets see the order.
