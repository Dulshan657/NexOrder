-- 00087_tenant_from_environment.sql
-- Make the `tenant` tag follow the environment instead of being frozen at 'ayam'.
--
-- 00042 introduced `tenant TEXT NOT NULL DEFAULT 'ayam'` on eight tables plus
-- two BEFORE INSERT triggers whose fallback is the same literal. That was
-- correct while one database served one business. It is not correct on the
-- Sydney project, where every row Amadiya Agro Products creates would be
-- stamped with a different company's name, inside their own database.
--
-- Why this is safe to change at all: the column is WRITTEN but never READ.
-- There is no consumer in lib/, services/, hooks/, components/, views/,
-- context/ or supabase/functions/ — the Tridon and V2food demo personas
-- separate through lib/demoAccounts.ts, not through this column. So this is a
-- data-correctness fix with no runtime behaviour attached, and it is cheapest
-- now, before the production database has a single row in it.
--
-- 00042 itself is deliberately NOT edited. It is already applied on dev, and
-- supabase/migrate.mjs checksums applied files — editing it would register as
-- drift and, worse, would make the dev and prod histories differ in a way no
-- ledger could reconcile.
--
-- No backfill and no data change:
--   * dev's marker says 'ayam', so every existing dev row is already correct;
--   * prod's says 'amadiya', so the first row it ever holds is correct.

BEGIN;

-- ── The per-environment default ──────────────────────────────────────────────
--
-- SECURITY DEFINER with a pinned search_path, matching the other 53 definer
-- functions in this schema. That is load-bearing rather than stylistic: a
-- column DEFAULT is evaluated as the INSERTING role, and environment_marker is
-- service_role-only, so an invoker-rights function here would break every
-- non-service-role insert into products, horecas, orders and the rest.
--
-- Returns NULL on an unstamped database, which the NOT NULL tenant columns
-- reject. Failing the insert is the intended behaviour: a database that cannot
-- say which environment it is should not be accepting new business data.
CREATE OR REPLACE FUNCTION public.default_tenant()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_key FROM public.environment_marker WHERE id = 1
$$;

COMMENT ON FUNCTION public.default_tenant() IS
  'The tenant tag for new rows in this environment, from environment_marker (00086). NULL on an unstamped database, which the NOT NULL tenant columns then reject.';

GRANT EXECUTE ON FUNCTION public.default_tenant() TO anon, authenticated, service_role;

-- ── Re-point the eight column defaults from 00042 ────────────────────────────
ALTER TABLE public.products       ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.horecas        ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.suppliers      ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.promotions     ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.email_accounts ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.orders         ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.pending_pos    ALTER COLUMN tenant SET DEFAULT public.default_tenant();
ALTER TABLE public.invoices       ALTER COLUMN tenant SET DEFAULT public.default_tenant();

-- ── Re-point the two derivation triggers ─────────────────────────────────────
--
-- Semantics are unchanged. The `= default_tenant()` test means exactly what
-- `= 'ayam'` meant in 00042: "the caller did not choose a tenant, so derive it
-- from the parent row". Only the definition of the default has moved.
--
-- CREATE OR REPLACE is safe for both: the signatures are identical, so this
-- replaces the body rather than creating an overload (the trap that has bitten
-- inv_transfer_stock and inv_receive_stock twice). The triggers themselves are
-- untouched and keep pointing at these names.

CREATE OR REPLACE FUNCTION public.set_tenant_from_horeca()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_default TEXT := public.default_tenant();
BEGIN
  IF NEW.tenant IS NULL OR NEW.tenant = v_default THEN
    SELECT h.tenant INTO NEW.tenant FROM public.horecas h WHERE h.id = NEW.horeca_id;
    IF NEW.tenant IS NULL THEN NEW.tenant := v_default; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.set_pending_po_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tenant  TEXT;
  v_default TEXT := public.default_tenant();
BEGIN
  IF NEW.tenant IS NULL OR NEW.tenant = v_default THEN
    SELECT ea.tenant INTO v_tenant
    FROM public.inbound_messages im
    JOIN public.email_accounts ea ON ea.id = im.email_account_id
    WHERE im.id = NEW.inbound_message_id;
    NEW.tenant := COALESCE(v_tenant, v_default);
  END IF;
  RETURN NEW;
END; $$;

COMMIT;
