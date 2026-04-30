-- DB polish: a single migration that closes four small but compounding gaps.
--
-- 1. suppliers.email   — UNIQUE (the column is NOT NULL but has no key
--    constraint, so we relied on application-side defensive checks).
-- 2. invoices.due_date — index for the aging-report query (currently a
--    full-table scan for every admin dashboard load).
-- 3. notifications     — composite index on (user_id, timestamp DESC) so
--    the inbox query for a specific user hits an index AND uses the index
--    ordering instead of a sort step.
-- 4. JSONB shape       — conservative CHECK constraint on
--    orders.status_history and scheduled_visits.change_requests asserting
--    they are JSON arrays. Per-item shape validation is intentionally
--    NOT enforced here: a future writer regression would surface as a
--    failed insert/update at the DB layer rather than as silently
--    malformed history. Per-item shape can be tightened later once the
--    surface is fully stable.

-- 1. suppliers.email UNIQUE
alter table public.suppliers
  add constraint suppliers_email_unique unique (email);

-- 2. invoices.due_date index
create index idx_invoices_due_date
  on public.invoices(due_date);

-- 3. notifications composite index
-- The existing idx_notifications_user_id (00001) covers WHERE user_id = ?
-- but forces a sort for the ORDER BY timestamp DESC clause. Composite
-- index lets the inbox query get rows pre-ordered.
create index idx_notifications_user_timestamp
  on public.notifications(user_id, timestamp desc);

-- 4. JSONB array shape constraints
alter table public.orders
  add constraint orders_status_history_is_array
  check (jsonb_typeof(status_history) = 'array');

alter table public.scheduled_visits
  add constraint scheduled_visits_change_requests_is_array
  check (jsonb_typeof(change_requests) = 'array');
