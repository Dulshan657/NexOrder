-- 00079_suppliers_blank_email_unique.sql
--
-- Fixes: receiving stock with a free-text `supplier_name` (rather than a
-- supplier_id) fails with
--     duplicate key value violates unique constraint "suppliers_email_unique"
--     DETAIL: Key (email)=() already exists.
-- and is returned to the operator as a 500.
--
-- Root cause. `suppliers.email` is NOT NULL (mig 00001) and mig 00016 added
-- `UNIQUE (email)` over it. Both server-side supplier auto-create paths —
-- `receive-stock`'s resolveHeaderSupplier and `_shared/productBulk.ts`'s
-- resolveSupplierByName (the CSV catalogue importer) — insert a minimal row
-- with `email = ''`, because the column cannot take NULL and the operator
-- typed a name, not an address. The FIRST such supplier therefore claims the
-- empty string, and every auto-create after it collides with that one row.
-- Prod had already reached that state: supplier 6 "E2E Test Supplier" holds
-- the blank, so no receipt naming a new supplier could ever succeed again.
--
-- The constraint's purpose is to stop two suppliers sharing a contact address.
-- `''` is not an address, it is the absence of one, and absent values must not
-- be treated as equal to each other. Postgres already gives this for free with
-- NULL (UNIQUE is NULLS DISTINCT), but the column is NOT NULL, so the same
-- semantics have to be spelled out with a partial index — exactly the pattern
-- mig 00021 uses for `horecas.contact_email` (unique WHERE the value is
-- present).
--
-- Deliberately NOT changed here:
--   * `email` stays NOT NULL. Making it nullable would ripple into `types.ts`,
--     the adapters and every supplier form for no gain — `''` already means
--     "unknown" throughout the app.
--   * The index is NOT folded to lower(email). That would be a real tightening
--     of what counts as a duplicate, unrelated to this bug; today's 6 rows are
--     distinct either way.
-- The index keeps the constraint's name so the intent stays findable from the
-- error message operators have already seen.

BEGIN;

ALTER TABLE public.suppliers
    DROP CONSTRAINT IF EXISTS suppliers_email_unique;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_email_unique
    ON public.suppliers (email)
    WHERE email <> '';

COMMENT ON INDEX public.suppliers_email_unique IS
    'Two suppliers may not share a contact email. Blank email means "unknown" '
    'and is exempt: server-side auto-create (receive-stock, bulk product '
    'import) mints suppliers with email = '''' from a name alone, and those '
    'must not collide with one another. See mig 00079.';

-- Assert the swap actually happened: the table constraint is gone, and what
-- replaced it is a UNIQUE *partial* index. A plain unique index here would
-- reintroduce the bug silently.
DO $$
DECLARE
    v_is_unique  BOOLEAN;
    v_predicate  TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.suppliers'::regclass
          AND conname  = 'suppliers_email_unique'
    ) THEN
        RAISE EXCEPTION 'suppliers_email_unique is still a table constraint';
    END IF;

    SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid)
      INTO v_is_unique, v_predicate
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'suppliers_email_unique';

    IF v_is_unique IS NULL THEN
        RAISE EXCEPTION 'suppliers_email_unique index is missing';
    END IF;
    IF NOT v_is_unique THEN
        RAISE EXCEPTION 'suppliers_email_unique is not UNIQUE';
    END IF;
    IF v_predicate IS NULL THEN
        RAISE EXCEPTION 'suppliers_email_unique has no partial predicate — blank emails would still collide';
    END IF;
END $$;

COMMIT;
