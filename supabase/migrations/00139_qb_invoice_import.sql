-- =============================================================================
-- QuickBooks invoice import: tables and transactions (NX-0025)
-- Migration: 00139_qb_invoice_import.sql
-- =============================================================================
-- A client keeps invoicing in QuickBooks and will pick, pack and dispatch from
-- those invoices here. This records which invoice became which order, and adds
-- the two transactions a later upload function will call. Nothing calls them
-- yet, so no screen or existing order behaves differently.
--
--   orders.qb_invoice_number   the invoice this order came from. NULL for every
--                              other order; the partial unique index allows only
--                              one order per invoice number.
--   qb_product_map             a QuickBooks product name -> our product, and
--                              whether that name's quantity means cartons or
--                              units: base units are quantity * COALESCE(pack_size, 1).
--   qb_invoice_imports         one row per imported invoice: its order and the
--                              lines as last imported.
--   qb_import_invoice_tx       invoice -> order, items and a reservation.
--   qb_update_invoice_tx       a changed invoice -> the same order, re-reserved.
--
-- ALREADY IMPORTED IS DECIDED UNDER A LOCK. Two simultaneous uploads of one
-- invoice both find no import row unless they queue. Both transactions take
-- pg_advisory_xact_lock on the invoice number before they look.
--
-- NO INVOICE ROW. QuickBooks holds the invoice. An `invoices` row here would be a
-- second bill for the same goods, so these functions never write that table.
--
-- GIVING A RESERVATION BACK NETS THE LEDGER. qb_release_own_allocation reverses
-- what this order's own allocate and deallocate rows net to, per product, bin,
-- batch and plate. It does not use inv_release_reservation, which works out the
-- amount from the order's lines and takes it from any allocated row of the
-- product: on a partly reserved order that takes units from other orders.
--
-- THE NET CAN EXCEED THE ROW, AND THEN THIS RAISES. A row's `allocated` is not
-- attributed per order, and three existing paths move it without touching this
-- order's ledger:
--   - inv_pick_order_line for ANOTHER order deallocates whatever the row holds;
--   - inv_release_reservation for another order takes from any allocated row
--     (its deallocate row names that order, not this one);
--   - wie_convert_rack_to_levels_tx (00085) moves `allocated` to level 1 keeping
--     batch and plate, but re-points the ledger with NULL batch and NULL plate,
--     so a batched or plated reservation nets on a row that no longer holds it.
-- Capping would hide that this order's units have gone, so the update raises
-- QB_ALLOCATION_MISMATCH and changes nothing. Plain transfers cannot cause it:
-- inv_transfer_stock, 00109, 00126 and 00137 move `available` with an alloc delta
-- of 0, and inv_adjust_stock refuses to go below `allocated`.
--
-- THE ROW MUST ALSO COVER EVERY OTHER ORDER. Those same paths can drain this
-- order's units from a row a third order also holds, and the row then still covers
-- this order's net alone: reversing it would take the third order's units. So the
-- check is allocated - what other orders still hold >= this order's net. "Still
-- hold" is the app's netting (wie_order_alloc_bins, then pickTasks.ts takes off what
-- was picked at that bin): per other order, allocate + deallocate + pick on this
-- exact row, floored at 0. inv_apply_leg writes a pick's on_hand delta to qty_delta,
-- so a pick is negative and a finished pick nets to nothing. A closed order holds
-- nothing, whatever its ledger says. An order whose ledger overstates what it holds
-- (rack conversion, or a dispatch that left stock stranded on an order still open)
-- can make this raise when the units are in fact there. That fails closed.
--
-- A PICK CANNOT SLIP PAST THE PICK CHECK. record-pick does not lock the order, but
-- its pick_progress insert takes a key-share lock on the order row through the
-- foreign key on order_id, and the update's FOR UPDATE conflicts with that. A pick
-- that has inserted makes the update wait, then be refused. A pick that inserts
-- after the lock waits, then fails its foreign key to the deleted item, and rolls
-- back with its stock. The key-share lock is only taken at that insert, so until
-- then a pick and an update can deadlock on balance rows; the database rolls one
-- of them back whole.
--
-- FULFILMENTS FOLLOW THE RESERVATION. A `processed` order has one order_fulfillments
-- row per warehouse holding stock, and orders.status rolls up from them, so a row
-- left at a warehouse the reservation has moved away from freezes the order.
-- qb_sync_fulfilments applies update-order-status's re-route rule. A `processing`
-- order has none until it is processed, and gets none here.
--
-- PRICES ARE STORED AT 2DP, SO THE TOTAL IS TOO. order_items.unit_price is
-- NUMERIC(10,2). The total adds the rounded prices, so it equals the sum of the
-- stored lines. qb_invoice_imports.lines keeps the file's value for comparing a
-- later upload.
--
-- LOCKDOWN. New tables inherit client grants from the default privileges (finding
-- DB-3), so both are created with an explicit REVOKE, RLS on and no policies. Both
-- are in config/lockedTables.mjs. The new `orders` column inherits that table's
-- grants: SELECT only for `authenticated` under its existing policies, no client
-- write since 00112, and no column-level grant to extend.
--
-- No BEGIN or COMMIT here: supabase/migrate.mjs wraps this file, and
-- __tests__/qbImportTx.integration.test.ts runs the text in a transaction it rolls back.
--
-- Verify:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name IN ('qb_product_map', 'qb_invoice_imports')
--      AND grantee IN ('anon', 'authenticated');          -- expect 0 rows
--
-- Rollback:
--   DROP FUNCTION public.qb_update_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]);
--   DROP FUNCTION public.qb_import_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]);
--   DROP FUNCTION public.qb_sync_fulfilments(TEXT, UUID);
--   DROP FUNCTION public.qb_release_own_allocation(TEXT, UUID);
--   DROP FUNCTION public.qb_write_order_lines(TEXT, JSONB, INT[], UUID);
--   DROP FUNCTION public.qb_validate_invoice_input(TEXT, INT, DATE, JSONB, UUID, INT[]);
--   DROP FUNCTION public.qb_lines_total(JSONB);
--   DROP TABLE public.qb_invoice_imports;
--   DROP TABLE public.qb_product_map;
--   DROP INDEX public.idx_orders_qb_invoice_number;
--   ALTER TABLE public.orders DROP COLUMN qb_invoice_number;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The order remembers its invoice
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS qb_invoice_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_qb_invoice_number
    ON public.orders (qb_invoice_number)
    WHERE qb_invoice_number IS NOT NULL;

COMMENT ON COLUMN public.orders.qb_invoice_number IS
    'The QuickBooks invoice this order was imported from; NULL for every other '
    'order. Written only by qb_import_invoice_tx (mig 00139).';

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qb_product_map (
    qb_name     TEXT    PRIMARY KEY,
    product_id  INT     NOT NULL REFERENCES public.products(id),
    pack_size   INT     CHECK (pack_size IS NULL OR pack_size > 0)
);

CREATE TABLE IF NOT EXISTS public.qb_invoice_imports (
    invoice_number   TEXT         PRIMARY KEY,
    order_id         TEXT         NOT NULL REFERENCES public.orders(id),
    invoice_date     DATE         NOT NULL,
    lines            JSONB        NOT NULL,
    imported_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    flagged_change   JSONB,
    flag_resolved_at TIMESTAMPTZ
);

ALTER TABLE public.qb_product_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qb_invoice_imports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.qb_product_map FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qb_invoice_imports FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qb_product_map TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qb_invoice_imports TO service_role;

COMMENT ON TABLE public.qb_product_map IS
    'QuickBooks product name -> product, with the pack size that name''s quantity '
    'is counted in. NULL pack_size means units. Service role only (mig 00139).';
COMMENT ON TABLE public.qb_invoice_imports IS
    'One row per imported QuickBooks invoice: its order and its lines as last '
    'imported. Service role only (mig 00139).';

-- ---------------------------------------------------------------------------
-- 3. qb_validate_invoice_input: refuse a bad call before anything is locked
-- ---------------------------------------------------------------------------
-- The classifier has already checked some of these. This is the boundary, so it
-- checks them again rather than trusting its caller, and turns what would surface
-- as a raw foreign key, not-null or overflow error into a coded one. JSON types are
-- tested, not cast: "5" is not a quantity, and a whole 5.0 is one.
--
-- A preference id that is not an active warehouse must be refused here.
-- inv_reserve_order finds no stock at such an id, which looks just like an
-- out-of-stock product, and an update would then release the order's reservation
-- and hold nothing. A NULL or empty preference means the default warehouse.

CREATE OR REPLACE FUNCTION public.qb_lines_total(p_lines JSONB)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ROUND(SUM((l->>'quantity')::NUMERIC * ROUND((l->>'unit_price')::NUMERIC, 2)), 2)
      FROM jsonb_array_elements(p_lines) AS l;
$$;

REVOKE ALL ON FUNCTION public.qb_lines_total(JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_lines_total(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.qb_validate_invoice_input(
    p_invoice_number TEXT,
    p_horeca_id      INT,
    p_invoice_date   DATE,
    p_lines          JSONB,
    p_actor          UUID,
    p_location_pref  INT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c_int_max   CONSTANT NUMERIC := 2147483647;
    c_price_cap CONSTANT NUMERIC := 100000000;    -- unit_price NUMERIC(10,2)
    c_total_cap CONSTANT NUMERIC := 10000000000;  -- orders.total NUMERIC(12,2)
    v_line    JSONB;
    v_row     BIGINT;
    v_pid     NUMERIC;
    v_qty     NUMERIC;
    v_pack    NUMERIC;
    v_seen    NUMERIC[] := '{}';
BEGIN
    IF p_invoice_number IS NULL OR p_invoice_number !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$' THEN
        RAISE EXCEPTION 'QB_BAD_INVOICE_NUMBER: % is not letters, digits and single hyphens',
            COALESCE(p_invoice_number, 'NULL') USING ERRCODE = 'P0001';
    END IF;

    IF p_invoice_date IS NULL THEN
        RAISE EXCEPTION 'QB_BAD_DATE: invoice % has no date', p_invoice_number USING ERRCODE = 'P0001';
    END IF;

    IF p_horeca_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.horecas h WHERE h.id = p_horeca_id) THEN
        RAISE EXCEPTION 'QB_BAD_CUSTOMER: customer % does not exist', COALESCE(p_horeca_id::TEXT, 'NULL')
            USING ERRCODE = 'P0001';
    END IF;

    IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = p_actor) THEN
        RAISE EXCEPTION 'QB_BAD_ACTOR: actor % does not exist', COALESCE(p_actor::TEXT, 'NULL')
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM unnest(p_location_pref) AS pref(id)
         WHERE pref.id IS NULL
            OR NOT EXISTS (
                SELECT 1 FROM public.locations l
                 WHERE l.id = pref.id AND l.kind = 'WAREHOUSE' AND l.is_active
            )
    ) THEN
        RAISE EXCEPTION 'QB_BAD_LOCATION: % must all be active warehouses',
            array_to_string(p_location_pref, ',', 'NULL') USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'QB_BAD_LINES: lines must be a JSON array' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'QB_BAD_LINES: invoice % has no lines', p_invoice_number USING ERRCODE = 'P0001';
    END IF;

    FOR v_line, v_row IN SELECT value, ordinality FROM jsonb_array_elements(p_lines) WITH ORDINALITY
    LOOP
        IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'QB_BAD_LINES: line % is not an object', v_row USING ERRCODE = 'P0001';
        END IF;

        IF jsonb_typeof(v_line->'product_id') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'QB_BAD_PRODUCT: line % has no product_id', v_row USING ERRCODE = 'P0001';
        END IF;
        v_pid := (v_line->>'product_id')::NUMERIC;
        IF v_pid <> trunc(v_pid) OR v_pid NOT BETWEEN 1 AND c_int_max THEN
            RAISE EXCEPTION 'QB_BAD_PRODUCT: line % has product_id %', v_row, v_pid USING ERRCODE = 'P0001';
        END IF;
        IF v_pid = ANY (v_seen) THEN
            RAISE EXCEPTION 'QB_DUPLICATE_PRODUCT: product % appears more than once', v_pid USING ERRCODE = 'P0001';
        END IF;
        v_seen := v_seen || v_pid;
        IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_pid::INT) THEN
            RAISE EXCEPTION 'QB_PRODUCT_NOT_FOUND: product % does not exist', v_pid USING ERRCODE = 'P0001';
        END IF;

        IF jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'QB_BAD_QUANTITY: line % has no numeric quantity', v_row USING ERRCODE = 'P0001';
        END IF;
        v_qty := (v_line->>'quantity')::NUMERIC;
        IF v_qty <> trunc(v_qty) OR v_qty NOT BETWEEN 1 AND c_int_max THEN
            RAISE EXCEPTION 'QB_BAD_QUANTITY: line % has quantity %', v_row, v_qty USING ERRCODE = 'P0001';
        END IF;

        IF jsonb_typeof(v_line->'unit_price') IS DISTINCT FROM 'number'
           OR (v_line->>'unit_price')::NUMERIC < 0 THEN
            RAISE EXCEPTION 'QB_BAD_PRICE: line % needs a price of zero or more', v_row USING ERRCODE = 'P0001';
        END IF;
        IF ROUND((v_line->>'unit_price')::NUMERIC, 2) >= c_price_cap THEN
            RAISE EXCEPTION 'QB_BAD_PRICE: line % has a price too large to store', v_row USING ERRCODE = 'P0001';
        END IF;

        -- A missing key and a JSON null both mean "counted in units".
        IF COALESCE(jsonb_typeof(v_line->'pack_size'), 'null') <> 'null' THEN
            IF jsonb_typeof(v_line->'pack_size') <> 'number' THEN
                RAISE EXCEPTION 'QB_BAD_PACK_SIZE: line % has a pack size that is not a number', v_row
                    USING ERRCODE = 'P0001';
            END IF;
            v_pack := (v_line->>'pack_size')::NUMERIC;
            IF v_pack <> trunc(v_pack) OR v_pack NOT BETWEEN 1 AND c_int_max THEN
                RAISE EXCEPTION 'QB_BAD_PACK_SIZE: line % has pack size %', v_row, v_pack USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END LOOP;

    IF public.qb_lines_total(p_lines) >= c_total_cap THEN
        RAISE EXCEPTION 'QB_BAD_PRICE: invoice % has a total too large to store', p_invoice_number
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.qb_validate_invoice_input(TEXT, INT, DATE, JSONB, UUID, INT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_validate_invoice_input(TEXT, INT, DATE, JSONB, UUID, INT[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. qb_write_order_lines: item rows, then their reservation in base units
-- ---------------------------------------------------------------------------
-- Name and SKU are snapshotted, as placeOrderCore does. Partial is allowed because
-- QuickBooks has already sold the goods: a short invoice still becomes an order,
-- holding what there is.

CREATE OR REPLACE FUNCTION public.qb_write_order_lines(
    p_order_id      TEXT,
    p_lines         JSONB,
    p_location_pref INT[],
    p_actor         UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_items JSONB;
BEGIN
    INSERT INTO public.order_items
        (order_id, product_id, quantity, pack_size, unit_price, product_name, product_sku)
    SELECT p_order_id,
           p.id,
           (l->>'quantity')::NUMERIC::INT,
           (l->>'pack_size')::NUMERIC::INT,
           (l->>'unit_price')::NUMERIC,
           p.name,
           p.sku
      FROM jsonb_array_elements(p_lines) AS l
      JOIN public.products p ON p.id = (l->>'product_id')::NUMERIC::INT;

    SELECT jsonb_agg(jsonb_build_object('product_id', t.product_id, 'quantity', t.units)
                     ORDER BY t.product_id)
      INTO v_items
      FROM (
          SELECT oi.product_id,
                 SUM(oi.quantity::NUMERIC * COALESCE(oi.pack_size, 1)) AS units
            FROM public.order_items oi
           WHERE oi.order_id = p_order_id
           GROUP BY oi.product_id
      ) t;

    PERFORM public.inv_reserve_order(p_order_id, v_items, p_location_pref, p_actor, true);
END;
$$;

REVOKE ALL ON FUNCTION public.qb_write_order_lines(TEXT, JSONB, INT[], UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_write_order_lines(TEXT, JSONB, INT[], UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. qb_release_own_allocation: give back exactly what this order's ledger holds
-- ---------------------------------------------------------------------------
-- inv_apply_leg writes the alloc delta to qty_delta for allocate and deallocate
-- rows (00075), so the sum is this order's reservation. GROUP BY treats NULLs as
-- equal, so a NULL batch or plate is its own group, as it is its own balance row.
-- A negative net is not a reservation (see the header on rack conversion and
-- other orders' releases), so only positive nets are reversed.
--
-- What other orders hold is read after the row is locked: a reservation or pick on
-- this row needs that lock too, so the figure cannot move before the reversal.

CREATE OR REPLACE FUNCTION public.qb_release_own_allocation(
    p_order_id TEXT,
    p_actor    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_own       RECORD;
    v_allocated NUMERIC;
    v_others    NUMERIC;
BEGIN
    FOR v_own IN
        SELECT m.product_id, m.location_id, m.batch_id, m.handling_unit_id,
               SUM(m.qty_delta) AS net
          FROM public.inventory_movements m
         WHERE m.ref_type = 'order'
           AND m.ref_id = p_order_id
           AND m.movement_type IN ('allocate', 'deallocate')
         GROUP BY m.product_id, m.location_id, m.batch_id, m.handling_unit_id
        HAVING SUM(m.qty_delta) > 0
         ORDER BY m.product_id, m.location_id, m.batch_id, m.handling_unit_id
    LOOP
        SELECT b.allocated INTO v_allocated
          FROM public.inventory_balances b
         WHERE b.product_id = v_own.product_id
           AND b.location_id = v_own.location_id
           AND COALESCE(b.batch_id, 0) = COALESCE(v_own.batch_id, 0)
           AND COALESCE(b.handling_unit_id, 0) = COALESCE(v_own.handling_unit_id, 0)
           FOR UPDATE;

        SELECT COALESCE(SUM(GREATEST(t.held, 0)), 0) INTO v_others
          FROM (
              SELECT SUM(m.qty_delta) AS held
                FROM public.inventory_movements m
                LEFT JOIN public.orders o ON o.id = m.ref_id
               WHERE m.ref_type = 'order'
                 AND m.ref_id <> p_order_id
                 AND m.movement_type IN ('allocate', 'deallocate', 'pick')
                 AND m.product_id = v_own.product_id
                 AND m.location_id = v_own.location_id
                 AND COALESCE(m.batch_id, 0) = COALESCE(v_own.batch_id, 0)
                 AND COALESCE(m.handling_unit_id, 0) = COALESCE(v_own.handling_unit_id, 0)
                 AND COALESCE(o.status, '') NOT IN ('cancelled', 'dispatched', 'delivered')
               GROUP BY m.ref_id
          ) t;

        IF v_allocated IS NULL OR v_allocated - v_others < v_own.net THEN
            RAISE EXCEPTION
                'QB_ALLOCATION_MISMATCH: order % nets % of product % at location % (batch %, plate %) but the row holds % with % held by other orders',
                p_order_id, v_own.net, v_own.product_id, v_own.location_id,
                COALESCE(v_own.batch_id::TEXT, 'none'), COALESCE(v_own.handling_unit_id::TEXT, 'none'),
                COALESCE(v_allocated, 0), v_others
                USING ERRCODE = 'P0001';
        END IF;

        PERFORM public.inv_apply_leg(
            v_own.product_id, v_own.location_id, v_own.batch_id, 0, -v_own.net,
            'deallocate', p_actor, 'order', p_order_id, 'qb invoice updated',
            NULL, v_own.handling_unit_id);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.qb_release_own_allocation(TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_release_own_allocation(TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5a. qb_sync_fulfilments: a processed order's rows follow its reservation
-- ---------------------------------------------------------------------------
-- The same rule as update-order-status Mode A on a re-route (index.ts:245-269, with
-- ensureFulfillments and pruneFulfillments):
--   - the sites are the warehouses holding a net reservation;
--   - with none, the first active warehouse by id, so there is something to pick;
--   - a row is added for each site in the 'processed' shape, an existing row is left;
--   - 'processed' rows elsewhere are deleted, but only when real reservations exist,
--     so a fully out-of-stock order keeps the rows it has. An advanced row is real
--     work and is never deleted.

CREATE OR REPLACE FUNCTION public.qb_sync_fulfilments(
    p_order_id TEXT,
    p_actor    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reserved INT[];
    v_sites    INT[];
BEGIN
    SELECT COALESCE(array_agg(w.warehouse_id), '{}') INTO v_reserved
      FROM public.inv_order_fulfilment_warehouses(p_order_id) AS w;

    v_sites := v_reserved;
    IF cardinality(v_sites) = 0 THEN
        v_sites := ARRAY(
            SELECT l.id FROM public.locations l
             WHERE l.kind = 'WAREHOUSE' AND l.is_active
             ORDER BY l.id
             LIMIT 1
        );
    END IF;

    INSERT INTO public.order_fulfillments (order_id, location_id, status, status_history)
    SELECT p_order_id, site.id, 'processed',
           jsonb_build_array(jsonb_build_object(
               'status',    'processed',
               'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'actor',     p_actor))
      FROM unnest(v_sites) AS site(id)
    ON CONFLICT (order_id, location_id) DO NOTHING;

    IF cardinality(v_reserved) > 0 THEN
        DELETE FROM public.order_fulfillments f
         WHERE f.order_id = p_order_id
           AND f.status = 'processed'
           AND f.location_id <> ALL (v_reserved);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.qb_sync_fulfilments(TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_sync_fulfilments(TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. qb_import_invoice_tx
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.qb_import_invoice_tx(
    p_invoice_number TEXT,
    p_horeca_id      INT,
    p_invoice_date   DATE,
    p_lines          JSONB,
    p_actor          UUID,
    p_location_pref  INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id TEXT;
BEGIN
    PERFORM public.qb_validate_invoice_input(
        p_invoice_number, p_horeca_id, p_invoice_date, p_lines, p_actor, p_location_pref);

    PERFORM pg_advisory_xact_lock(hashtext('qb_invoice:' || p_invoice_number));

    SELECT i.order_id INTO v_order_id
      FROM public.qb_invoice_imports i
     WHERE i.invoice_number = p_invoice_number;
    IF FOUND THEN
        RETURN jsonb_build_object('status', 'already_imported', 'order_id', v_order_id);
    END IF;

    v_order_id := 'QB-' || p_invoice_number;

    INSERT INTO public.orders
        (id, horeca_id, submitted_by, total, status, status_history, qb_invoice_number)
    VALUES
        (v_order_id, p_horeca_id, p_actor, public.qb_lines_total(p_lines), 'processing',
         jsonb_build_array(jsonb_build_object(
             'status',    'processing',
             'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
         p_invoice_number);

    PERFORM public.qb_write_order_lines(v_order_id, p_lines, p_location_pref, p_actor);

    INSERT INTO public.qb_invoice_imports (invoice_number, order_id, invoice_date, lines)
    VALUES (p_invoice_number, v_order_id, p_invoice_date, p_lines);

    RETURN jsonb_build_object('status', 'created', 'order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.qb_import_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_import_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]) TO service_role;

COMMENT ON FUNCTION public.qb_import_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]) IS
    'Turn a QuickBooks invoice into an order at the file''s prices, reserving what '
    'is available in base units. Writes no invoice row. Importing a number twice '
    'returns already_imported and writes nothing. service_role only (mig 00139).';

-- ---------------------------------------------------------------------------
-- 7. qb_update_invoice_tx
-- ---------------------------------------------------------------------------
-- Refusals are verdicts rather than raises, as in order_cancel_tx: nothing has
-- been written at that point, and the caller needs to tell them apart.

CREATE OR REPLACE FUNCTION public.qb_update_invoice_tx(
    p_invoice_number TEXT,
    p_horeca_id      INT,
    p_invoice_date   DATE,
    p_lines          JSONB,
    p_actor          UUID,
    p_location_pref  INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id TEXT;
    v_status   TEXT;
BEGIN
    PERFORM public.qb_validate_invoice_input(
        p_invoice_number, p_horeca_id, p_invoice_date, p_lines, p_actor, p_location_pref);

    PERFORM pg_advisory_xact_lock(hashtext('qb_invoice:' || p_invoice_number));

    SELECT i.order_id INTO v_order_id
      FROM public.qb_invoice_imports i
     WHERE i.invoice_number = p_invoice_number;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT o.status INTO v_status
      FROM public.orders o
     WHERE o.id = v_order_id
       FOR UPDATE;
    IF v_status NOT IN ('processing', 'processed') THEN
        RETURN jsonb_build_object('status', 'refused', 'reason', 'order_closed');
    END IF;

    IF EXISTS (SELECT 1 FROM public.pick_progress pp WHERE pp.order_id = v_order_id) THEN
        RETURN jsonb_build_object('status', 'refused', 'reason', 'picking_started');
    END IF;

    PERFORM public.qb_release_own_allocation(v_order_id, p_actor);

    -- pick_progress is the only table with a foreign key to order_items, and the
    -- check above has just shown this order has none of its rows.
    DELETE FROM public.order_items oi WHERE oi.order_id = v_order_id;

    UPDATE public.orders o
       SET total          = public.qb_lines_total(p_lines),
           horeca_id      = p_horeca_id,
           status_history = COALESCE(o.status_history, '[]'::jsonb)
                            || jsonb_build_object(
                                   'status',    v_status,
                                   'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                   'actor',     p_actor,
                                   'note',      'QuickBooks invoice updated')
     WHERE o.id = v_order_id;

    PERFORM public.qb_write_order_lines(v_order_id, p_lines, p_location_pref, p_actor);

    IF v_status = 'processed' THEN
        PERFORM public.qb_sync_fulfilments(v_order_id, p_actor);
    END IF;

    UPDATE public.qb_invoice_imports i
       SET lines          = p_lines,
           invoice_date   = p_invoice_date,
           flagged_change = NULL
     WHERE i.invoice_number = p_invoice_number;

    RETURN jsonb_build_object('status', 'updated', 'order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.qb_update_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qb_update_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]) TO service_role;

COMMENT ON FUNCTION public.qb_update_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]) IS
    'Apply a changed QuickBooks invoice to its order: give back this order''s own '
    'reservation, rewrite its lines and total, and reserve again. Refused once '
    'picking has started or the order is outside processing and processed. '
    'service_role only (mig 00139).';
