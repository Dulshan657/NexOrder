-- =============================================================================
-- Ship an imported order short, and release and pick only an order's own stock (NX-0029)
-- Migration: 00140_pick_differences.sql
-- =============================================================================
-- An imported order comes from an invoice raised elsewhere, so what was sold can be
-- short, missing or more than the system shows. Until now none of that could finish:
-- zero found could not be recorded, a short line blocked dispatch, and a pick or a
-- release could lower another order's reservation.
--
--   pick_differences             what was really found, for the office. Service role only.
--   inv_close_line_short         closes one imported line short and gives back its units.
--   inv_release_reservation      same signature, for ALL orders: own stock only, idempotent.
--   inv_pick_order_line          same signature; orders with qb_invoice_number take the
--                                imported path, every other order the previous text.
--   inv_warehouse_pick_complete  same signature; imported orders also check their lines.
--   qb_update_invoice_tx         same signature; also refused once a difference exists.
--
-- WHAT A HOLDING IS. Per order, product and bin:
--     SUM(qty_delta of this order's allocate and deallocate rows at the bin)
--   - this order's picks there (pick_progress.picked_qty * COALESCE(pack_size, 1))
--   floored at 0.
-- inv_apply_leg writes the alloc delta to qty_delta for allocate and deallocate and the
-- on-hand delta for a pick (00075), and a pick leg lowers `allocated` with no allocate or
-- deallocate row, which is why the picks come off here. The BIN is the unit, as in 00139:
-- below it the ledger and the balances routinely disagree, and a row's `allocated` says
-- how many units are reserved, not whose they are.
--
-- A RELEASE TAKES WHAT IS SAFELY THIS ORDER'S. Per bin: LEAST(own holding, the bin's
-- allocated minus what other open orders hold there, floored at 0). Unlike
-- qb_release_own_allocation it never raises for a shortfall, because dispatch and cancel
-- must finish: it emits a WARNING and releases what is safe. Other orders whose status is
-- cancelled, dispatched or delivered hold nothing, whatever their ledger says. Nor does a
-- movement naming an order with no row in `orders`: place-order and approve-po delete an
-- order when they fail part way, and counting those rows would hold stock forever.
--
-- A RELEASE IS NOW IDEMPOTENT AND KEYED BY ORDER. Its deallocate rows net the holding to
-- zero, so a second call finds nothing. 00111's header and the old comments that say
-- otherwise describe the function this replaces. order_cancel_tx still claims first,
-- because the claim is what decides who cancelled.
--
-- p_location_id NOW COVERS A WAREHOUSE'S BINS. Dispatch passes the warehouse id, which
-- matched no racked bin, so a racked site's residual was never released.
--
-- A LEGACY ORDER THAT PICKED SOMEWHERE ELSE. The old pick drew whatever the row held, so
-- an ordinary order may have reserved in bin A and picked in bin B. Its holding at A is
-- still its ledger's full net, and B's is floored at 0. So a release gives back A's units,
-- capped by what others hold at A, which the old release stranded (it saw ordered - picked
-- = 0) and takes nothing at B. The order at B that lost units to that old pick loses no
-- more, and its own later release is capped and warns. The invariant is that another open
-- order never loses units.
--
-- CLOSING SHORT WRITES NOTHING OFF. on_hand is untouched, because only a count changes it.
-- It records one `short` row and gives back the line's open units: a product on two lines
-- has one shared reservation (see _shared/wie/pickTasks.ts), so that is the order's holding
-- of the product minus the open units of its other open lines, capped by this line's open.
--
-- THE IMPORTED PICK NEVER LOWERS ANOTHER ORDER'S ALLOCATED. Row by row, in FEFO order:
--     dealloc = LEAST(remaining, own_left, row.allocated)
--     take    = LEAST(remaining, row.on_hand - row.allocated + dealloc)
-- so allocated <= on_hand holds. The ledger can overstate this order's units, because an
-- ordinary order's pick draws whatever the row holds, so own_left starts capped by the
-- bin's allocated minus what others hold, read with the bin's rows locked. Then the bin
-- keeps every unit others hold, and what the cap removes comes from free stock or is
-- recorded as unrecorded stock like any other.
--
-- FREE STOCK ON AN EARLIER ROW MUST NOT STRAND THE ORDER'S OWN UNITS. FEFO can take the
-- whole pick from a free row while this order's reservation sits on a later one. The
-- picks then net its holding to zero with the later row's `allocated` still up, owned by
-- nobody and out of reach of any release. So after the loop the bin's `allocated` falls by
-- whatever of LEAST(picked, own holding at the start) the rows did not give up, through a
-- pick leg with no on-hand change. A deallocate row would count against the holding twice,
-- as the picks already come off it.
-- qty_delta is 0, so no netting changes, but wie_refresh_velocity and
-- wie_refresh_location_traffic COUNT pick rows, so each such leg counts as one more pick.
-- The ordinary path has the same flaw and stays as it was.
--
-- What is left of the pick was physically taken but is not on record: it is recorded as picked and added
-- to an `unrecorded_stock` row flagging the bin for a recount. The order row is locked
-- first, which serialises the pick with inv_close_line_short, and it is the same order of
-- locks as order_cancel_tx: the order, then its balances.
--
-- ANOTHER WAREHOUSE COVERS AN OPEN LINE ONLY WITH WHAT IT STILL HOLDS. Held elsewhere nets
-- reservations minus picks per warehouse, not per bin, so a pick from another bin there
-- uses up that warehouse's holding, and two warehouses cannot each count the other.
--
-- A PRODUCT WITH NOTHING OPEN CANNOT HOLD AN IMPORTED ORDER BACK. The ledger can still show
-- a reservation for a product with no open units: a close the bin could not cover, or a
-- line fully picked at one warehouse while another still holds a part. The dispatch of
-- that warehouse is what gives those units back, so it must be allowed to happen.
--
-- LOCKDOWN. Created with an explicit REVOKE because new tables and sequences inherit client
-- grants from the default privileges (finding DB-3). RLS on, no policies. In
-- config/lockedTables.mjs. The helpers are SECURITY DEFINER and service_role only.
-- inv_warehouse_pick_complete keeps its 00040 grants and stays SECURITY INVOKER, so it
-- reads pick_differences as service_role, its one caller.
--
-- No BEGIN or COMMIT here: supabase/migrate.mjs wraps this file, and the integration tests
-- run its text in a transaction they roll back.
--
-- Verify:
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.proname IN ('inv_pick_order_line', 'inv_release_reservation',
--                        'inv_warehouse_pick_complete', 'qb_update_invoice_tx');  -- one each
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'pick_differences'
--      AND grantee IN ('anon', 'authenticated');                                  -- 0 rows
--
-- Rollback: restore inv_pick_order_line and inv_release_reservation from 00075,
-- inv_warehouse_pick_complete from 00040, qb_update_invoice_tx from 00139, then:
--   DROP FUNCTION public.inv_close_line_short(INT, INT, UUID);
--   DROP FUNCTION public.inv_pick_imported_line(INT, NUMERIC, INT, UUID);
--   DROP FUNCTION public.inv_assert_pick_location(INT);
--   DROP FUNCTION public.inv_release_bin(TEXT, INT, INT, NUMERIC, UUID, TEXT);
--   DROP FUNCTION public.inv_order_held_outside_warehouse(TEXT, INT, INT);
--   DROP FUNCTION public.inv_others_bin_holdings(TEXT, INT, INT);
--   DROP FUNCTION public.inv_order_bin_remainder(TEXT, INT, INT);
--   DROP TABLE public.pick_differences;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. pick_differences
-- ---------------------------------------------------------------------------
-- The foreign keys carry no ON DELETE: a difference is the record of what happened, so
-- nothing may delete the line under it. qb_update_invoice_tx deletes and rewrites an
-- order's lines, and section 8 refuses it once a difference exists.

CREATE TABLE IF NOT EXISTS public.pick_differences (
    id                   BIGSERIAL    PRIMARY KEY,
    order_id             TEXT         NOT NULL REFERENCES public.orders(id),
    order_item_id        INT          NOT NULL REFERENCES public.order_items(id),
    product_id           INT          NOT NULL,
    location_id          INT          REFERENCES public.locations(id),
    kind                 TEXT         NOT NULL CHECK (kind IN ('short', 'unrecorded_stock')),
    ordered_qty          NUMERIC      NOT NULL,
    picked_qty           NUMERIC      NOT NULL,
    unrecorded_qty_base  NUMERIC      NOT NULL DEFAULT 0,
    recount_needed       BOOLEAN      NOT NULL,
    note                 TEXT,
    resolved_at          TIMESTAMPTZ,
    resolved_by          UUID,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by           UUID,
    -- A NULL location would slip past the per-bin unique index below.
    CONSTRAINT pick_differences_unrecorded_has_bin
        CHECK (kind <> 'unrecorded_stock' OR location_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pick_differences_one_short
    ON public.pick_differences (order_item_id)
    WHERE kind = 'short';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pick_differences_one_unrecorded
    ON public.pick_differences (order_item_id, location_id)
    WHERE kind = 'unrecorded_stock';

CREATE INDEX IF NOT EXISTS idx_pick_differences_order
    ON public.pick_differences (order_id);

CREATE INDEX IF NOT EXISTS idx_pick_differences_order_item
    ON public.pick_differences (order_item_id);

CREATE INDEX IF NOT EXISTS idx_pick_differences_location
    ON public.pick_differences (location_id);

ALTER TABLE public.pick_differences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pick_differences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.pick_differences_id_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pick_differences TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pick_differences_id_seq TO service_role;

COMMENT ON TABLE public.pick_differences IS
    'What a picker really found on an imported order: a line closed short, or stock picked '
    'beyond what the bin had on record. ordered_qty and picked_qty are line units, '
    'unrecorded_qty_base is base units. Service role only (mig 00140).';

-- ---------------------------------------------------------------------------
-- 2. Holdings
-- ---------------------------------------------------------------------------
-- Read after the bin's balance rows are locked: a reservation or pick there needs one of
-- those locks, so the figures cannot move before the reversal.

CREATE OR REPLACE FUNCTION public.inv_order_bin_remainder(
    p_order_id    TEXT,
    p_product_id  INT,
    p_location_id INT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT GREATEST(
        COALESCE((
            SELECT SUM(m.qty_delta)
              FROM public.inventory_movements m
             WHERE m.ref_type = 'order'
               AND m.ref_id = p_order_id
               AND m.movement_type IN ('allocate', 'deallocate')
               AND m.product_id = p_product_id
               AND m.location_id = p_location_id
        ), 0)
        - COALESCE((
            SELECT SUM(pp.picked_qty * COALESCE(oi.pack_size, 1))
              FROM public.pick_progress pp
              JOIN public.order_items oi ON oi.id = pp.order_item_id
             WHERE pp.order_id = p_order_id
               AND pp.location_id = p_location_id
               AND oi.product_id = p_product_id
        ), 0),
        0);
$$;

REVOKE ALL ON FUNCTION public.inv_order_bin_remainder(TEXT, INT, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_order_bin_remainder(TEXT, INT, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.inv_others_bin_holdings(
    p_order_id    TEXT,
    p_product_id  INT,
    p_location_id INT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(GREATEST(t.net - COALESCE(pk.picked, 0), 0)), 0)
      FROM (
          SELECT m.ref_id, SUM(m.qty_delta) AS net
            FROM public.inventory_movements m
            JOIN public.orders o ON o.id = m.ref_id
           WHERE m.ref_type = 'order'
             AND m.ref_id <> p_order_id
             AND m.movement_type IN ('allocate', 'deallocate')
             AND m.product_id = p_product_id
             AND m.location_id = p_location_id
             AND o.status NOT IN ('cancelled', 'dispatched', 'delivered')
           GROUP BY m.ref_id
      ) t
      LEFT JOIN LATERAL (
          SELECT SUM(pp.picked_qty * COALESCE(oi.pack_size, 1)) AS picked
            FROM public.pick_progress pp
            JOIN public.order_items oi ON oi.id = pp.order_item_id
           WHERE pp.order_id = t.ref_id
             AND pp.location_id = p_location_id
             AND oi.product_id = p_product_id
      ) pk ON true;
$$;

REVOKE ALL ON FUNCTION public.inv_others_bin_holdings(TEXT, INT, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_others_bin_holdings(TEXT, INT, INT) TO service_role;

-- What this order still holds of a product outside one warehouse, netted per warehouse.
CREATE OR REPLACE FUNCTION public.inv_order_held_outside_warehouse(
    p_order_id     TEXT,
    p_product_id   INT,
    p_warehouse_id INT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(GREATEST(held.net - COALESCE(pk.picked, 0), 0)), 0)
      FROM (
          SELECT public.inv_root_warehouse(m.location_id) AS warehouse_id, SUM(m.qty_delta) AS net
            FROM public.inventory_movements m
           WHERE m.ref_type = 'order'
             AND m.ref_id = p_order_id
             AND m.movement_type IN ('allocate', 'deallocate')
             AND m.product_id = p_product_id
           GROUP BY 1
      ) held
      LEFT JOIN LATERAL (
          SELECT SUM(pp.picked_qty * COALESCE(oi.pack_size, 1)) AS picked
            FROM public.pick_progress pp
            JOIN public.order_items oi ON oi.id = pp.order_item_id
           WHERE pp.order_id = p_order_id
             AND oi.product_id = p_product_id
             AND public.inv_root_warehouse(pp.location_id) = held.warehouse_id
      ) pk ON true
     WHERE held.warehouse_id <> p_warehouse_id;
$$;

REVOKE ALL ON FUNCTION public.inv_order_held_outside_warehouse(TEXT, INT, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_order_held_outside_warehouse(TEXT, INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. inv_release_bin: give back up to p_limit of this order's holding in one bin
-- ---------------------------------------------------------------------------
-- Rows are locked in id order. The reversal takes two passes, as qb_release_own_allocation
-- does: the first from rows on this order's own batch and plate keys, up to what its ledger
-- nets on each; the second from whatever the bin has, which is where a pick or a rack
-- conversion has put it. Each leg names its own row's batch and plate. A NULL limit means
-- the whole holding. Returns what it released.

CREATE OR REPLACE FUNCTION public.inv_release_bin(
    p_order_id    TEXT,
    p_product_id  INT,
    p_location_id INT,
    p_limit       NUMERIC,
    p_actor       UUID,
    p_reason      TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_allocated NUMERIC;
    v_own       NUMERIC;
    v_others    NUMERIC;
    v_wanted    NUMERIC;
    v_safe      NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_row       RECORD;
    v_pass      INT;
BEGIN
    SELECT COALESCE(SUM(t.allocated), 0) INTO v_allocated
      FROM (
          SELECT b.allocated
            FROM public.inventory_balances b
           WHERE b.product_id = p_product_id
             AND b.location_id = p_location_id
           ORDER BY b.id
             FOR UPDATE
      ) t;

    v_own := public.inv_order_bin_remainder(p_order_id, p_product_id, p_location_id);
    v_wanted := LEAST(v_own, COALESCE(p_limit, v_own));
    IF v_wanted <= 0 THEN
        RETURN 0;
    END IF;

    v_others := public.inv_others_bin_holdings(p_order_id, p_product_id, p_location_id);
    v_safe := LEAST(v_wanted, GREATEST(v_allocated - v_others, 0));

    IF v_safe < v_wanted THEN
        RAISE WARNING
            'RELEASE_SHORTFALL: order % wanted % of product % at location % but released %: the bin holds % with % held by other orders',
            p_order_id, v_wanted, p_product_id, p_location_id, v_safe, v_allocated, v_others;
    END IF;

    v_remaining := v_safe;
    FOR v_pass IN 1..2 LOOP
        FOR v_row IN
            SELECT b.batch_id, b.handling_unit_id, b.allocated,
                   COALESCE((
                       SELECT SUM(m.qty_delta)
                         FROM public.inventory_movements m
                        WHERE m.ref_type = 'order'
                          AND m.ref_id = p_order_id
                          AND m.movement_type IN ('allocate', 'deallocate')
                          AND m.product_id = b.product_id
                          AND m.location_id = b.location_id
                          AND COALESCE(m.batch_id, 0) = COALESCE(b.batch_id, 0)
                          AND COALESCE(m.handling_unit_id, 0) = COALESCE(b.handling_unit_id, 0)
                   ), 0) AS own_share
              FROM public.inventory_balances b
             WHERE b.product_id = p_product_id
               AND b.location_id = p_location_id
               AND b.allocated > 0
             ORDER BY b.id
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_remaining, v_row.allocated);
            IF v_pass = 1 THEN
                v_take := LEAST(v_take, v_row.own_share);
            END IF;
            CONTINUE WHEN v_take <= 0;
            PERFORM public.inv_apply_leg(
                p_product_id, p_location_id, v_row.batch_id, 0, -v_take,
                'deallocate', p_actor, 'order', p_order_id, p_reason,
                NULL, v_row.handling_unit_id);
            v_remaining := v_remaining - v_take;
        END LOOP;
    END LOOP;

    RETURN v_safe;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_release_bin(TEXT, INT, INT, NUMERIC, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_release_bin(TEXT, INT, INT, NUMERIC, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. inv_release_reservation: for ALL orders
-- ---------------------------------------------------------------------------
-- Bins go in product and location order, so two releases lock in the same order.

CREATE OR REPLACE FUNCTION public.inv_release_reservation(
    p_order_id    TEXT,
    p_location_id INT DEFAULT NULL,
    p_actor       UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bin RECORD;
BEGIN
    FOR v_bin IN
        SELECT DISTINCT m.product_id, m.location_id
          FROM public.inventory_movements m
         WHERE m.ref_type = 'order'
           AND m.ref_id = p_order_id
           AND m.movement_type IN ('allocate', 'deallocate')
           AND (p_location_id IS NULL
                OR m.location_id = p_location_id
                OR public.inv_root_warehouse(m.location_id) = p_location_id)
         ORDER BY m.product_id, m.location_id
    LOOP
        PERFORM public.inv_release_bin(
            p_order_id, v_bin.product_id, v_bin.location_id, NULL, p_actor, 'reservation released');
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.inv_release_reservation(TEXT, INT, UUID) IS
    'Give back what this order still holds, per product and bin, never what another open '
    'order holds. p_location_id NULL means everywhere; a warehouse id covers its bins. '
    'Idempotent, and warns rather than raises on a shortfall (mig 00140).';

-- ---------------------------------------------------------------------------
-- 5. inv_assert_pick_location
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_assert_pick_location(p_location_id INT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.locations w
         WHERE w.id = public.inv_root_warehouse(p_location_id)
           AND w.is_active
    ) THEN
        RAISE EXCEPTION 'BAD_LOCATION: location % is not under an active warehouse', p_location_id
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_assert_pick_location(INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_assert_pick_location(INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. inv_close_line_short
-- ---------------------------------------------------------------------------
-- The order lock serialises two closes, and a close with a pick (see the header). Every
-- bin of the product this order has a ledger at is locked in location and id order first,
-- so preferring p_location_id cannot invert the lock order against a release.

CREATE OR REPLACE FUNCTION public.inv_close_line_short(
    p_order_item_id INT,
    p_location_id   INT,
    p_actor         UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item        RECORD;
    v_order       RECORD;
    v_picked      NUMERIC;
    v_open        NUMERIC;
    v_other_open  NUMERIC;
    v_own         NUMERIC;
    v_to_release  NUMERIC;
    v_bin         RECORD;
    v_resolved    BOOLEAN;
BEGIN
    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.pack_size INTO v_item
      FROM public.order_items oi
     WHERE oi.id = p_order_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND: %', p_order_item_id USING ERRCODE = 'P0001';
    END IF;

    SELECT o.status, o.qb_invoice_number INTO v_order
      FROM public.orders o
     WHERE o.id = v_item.order_id
       FOR UPDATE;

    IF v_order.qb_invoice_number IS NULL THEN
        RAISE EXCEPTION 'NOT_IMPORTED: order % has no invoice number', v_item.order_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_order.status = 'cancelled' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED: order % is cancelled', v_item.order_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_order.status NOT IN ('processed', 'picked') THEN
        RAISE EXCEPTION 'INVALID_STATUS: order % is %', v_item.order_id, v_order.status
            USING ERRCODE = 'P0001';
    END IF;
    IF p_location_id IS NOT NULL THEN
        PERFORM public.inv_assert_pick_location(p_location_id);
        IF EXISTS (
            SELECT 1 FROM public.order_fulfillments f WHERE f.order_id = v_item.order_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.order_fulfillments f
             WHERE f.order_id = v_item.order_id
               AND f.location_id = public.inv_root_warehouse(p_location_id)
        ) THEN
            RAISE EXCEPTION 'BAD_LOCATION: location % is not under a warehouse fulfilling order %',
                p_location_id, v_item.order_id USING ERRCODE = 'P0001';
        END IF;
    END IF;

    SELECT COALESCE(SUM(pp.picked_qty), 0) INTO v_picked
      FROM public.pick_progress pp
     WHERE pp.order_item_id = p_order_item_id;

    IF EXISTS (
        SELECT 1 FROM public.pick_differences d
         WHERE d.order_item_id = p_order_item_id AND d.kind = 'short'
    ) THEN
        RETURN jsonb_build_object('status', 'already_closed', 'line_closed', true);
    END IF;

    IF v_picked >= v_item.quantity THEN
        RETURN jsonb_build_object('status', 'already_picked');
    END IF;

    INSERT INTO public.pick_differences
        (order_id, order_item_id, product_id, location_id, kind,
         ordered_qty, picked_qty, recount_needed, created_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_item.product_id, p_location_id, 'short',
         v_item.quantity, v_picked, p_location_id IS NOT NULL, p_actor);

    PERFORM 1
      FROM public.inventory_balances b
     WHERE b.product_id = v_item.product_id
       AND b.location_id IN (
           SELECT m.location_id
             FROM public.inventory_movements m
            WHERE m.ref_type = 'order'
              AND m.ref_id = v_item.order_id
              AND m.movement_type IN ('allocate', 'deallocate')
              AND m.product_id = v_item.product_id
       )
     ORDER BY b.location_id, b.id
       FOR UPDATE OF b;

    v_open := (v_item.quantity - v_picked) * COALESCE(v_item.pack_size, 1);

    SELECT COALESCE(SUM(
               GREATEST(oi.quantity - COALESCE((
                   SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                    WHERE pp.order_item_id = oi.id
               ), 0), 0) * COALESCE(oi.pack_size, 1)
           ), 0) INTO v_other_open
      FROM public.order_items oi
     WHERE oi.order_id = v_item.order_id
       AND oi.product_id = v_item.product_id
       AND oi.id <> p_order_item_id
       AND NOT EXISTS (
           SELECT 1 FROM public.pick_differences d
            WHERE d.order_item_id = oi.id AND d.kind = 'short'
       );

    SELECT COALESCE(SUM(public.inv_order_bin_remainder(v_item.order_id, v_item.product_id, t.location_id)), 0)
      INTO v_own
      FROM (
          SELECT DISTINCT m.location_id
            FROM public.inventory_movements m
           WHERE m.ref_type = 'order'
             AND m.ref_id = v_item.order_id
             AND m.movement_type IN ('allocate', 'deallocate')
             AND m.product_id = v_item.product_id
      ) t;

    v_to_release := LEAST(v_open, GREATEST(v_own - v_other_open, 0));

    FOR v_bin IN
        SELECT DISTINCT m.location_id,
               m.location_id IS NOT DISTINCT FROM p_location_id AS preferred
          FROM public.inventory_movements m
         WHERE m.ref_type = 'order'
           AND m.ref_id = v_item.order_id
           AND m.movement_type IN ('allocate', 'deallocate')
           AND m.product_id = v_item.product_id
         ORDER BY preferred DESC, m.location_id
    LOOP
        EXIT WHEN v_to_release <= 0;
        v_to_release := v_to_release - public.inv_release_bin(
            v_item.order_id, v_item.product_id, v_bin.location_id,
            v_to_release, p_actor, 'line closed short');
    END LOOP;

    SELECT NOT EXISTS (
        SELECT 1 FROM public.order_items oi
         WHERE oi.order_id = v_item.order_id
           AND oi.quantity > COALESCE((
               SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                WHERE pp.order_item_id = oi.id), 0)
           AND NOT EXISTS (
               SELECT 1 FROM public.pick_differences d
                WHERE d.order_item_id = oi.id AND d.kind = 'short')
    ) INTO v_resolved;

    RETURN jsonb_build_object(
        'status',               'closed',
        'line_closed',          true,
        'order_fully_resolved', v_resolved
    );
END;
$$;

REVOKE ALL ON FUNCTION public.inv_close_line_short(INT, INT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_close_line_short(INT, INT, UUID) TO service_role;

COMMENT ON FUNCTION public.inv_close_line_short(INT, INT, UUID) IS
    'Close an imported order line short: record one difference and give back its open '
    'units. on_hand is untouched. A retry adds nothing. service_role only (mig 00140).';

-- ---------------------------------------------------------------------------
-- 7. Picking
-- ---------------------------------------------------------------------------
-- p_location_id is already resolved by inv_pick_order_line. record-pick also refuses a
-- cancelled order before the RPC, from a read with no lock; this is the check that holds.

CREATE OR REPLACE FUNCTION public.inv_pick_imported_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,
    p_location_id   INT,
    p_actor         UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item       RECORD;
    v_factor     NUMERIC;
    v_already    NUMERIC;
    v_remaining  NUMERIC;
    v_own_left   NUMERIC;
    v_free       NUMERIC;
    v_take       NUMERIC;
    v_dealloc    NUMERIC;
    v_row        RECORD;
    v_last_batch INT;
    v_order_done BOOLEAN;
    v_allocated  NUMERIC;
    v_others     NUMERIC;
    v_wanted     NUMERIC;
    v_status     TEXT;
BEGIN
    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.pack_size INTO v_item
      FROM public.order_items oi
     WHERE oi.id = p_order_item_id;

    SELECT o.status INTO v_status FROM public.orders o WHERE o.id = v_item.order_id FOR UPDATE;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED: This order was cancelled. Stop picking it and put anything already taken back.'
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.pick_differences d
         WHERE d.order_item_id = p_order_item_id AND d.kind = 'short'
    ) THEN
        RAISE EXCEPTION 'LINE_CLOSED_SHORT: line % was closed short', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.inv_assert_pick_location(p_location_id);

    -- Held stock must not be sold (mig 00101). Not in the assert above, because a close
    -- may still name a held bin as the one to recount.
    IF EXISTS (SELECT 1 FROM public.v_held_locations h WHERE h.location_id = p_location_id) THEN
        RAISE EXCEPTION 'LOCATION_HELD: location % is on hold', p_location_id USING ERRCODE = 'P0001';
    END IF;

    v_factor := COALESCE(v_item.pack_size, 1);

    SELECT COALESCE(SUM(pp.picked_qty), 0) INTO v_already
      FROM public.pick_progress pp
     WHERE pp.order_item_id = p_order_item_id;

    IF v_already + p_picked_qty > v_item.quantity THEN
        RAISE EXCEPTION 'OVER_PICK: line % would exceed ordered qty', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    v_remaining := p_picked_qty * v_factor;

    SELECT COALESCE(SUM(t.allocated), 0) INTO v_allocated
      FROM (
          SELECT b.allocated
            FROM public.inventory_balances b
           WHERE b.product_id = v_item.product_id
             AND b.location_id = p_location_id
           ORDER BY b.id
             FOR UPDATE
      ) t;
    v_others := public.inv_others_bin_holdings(v_item.order_id, v_item.product_id, p_location_id);
    v_wanted := LEAST(
        public.inv_order_bin_remainder(v_item.order_id, v_item.product_id, p_location_id),
        v_remaining);
    v_own_left := LEAST(v_wanted, GREATEST(v_allocated - v_others, 0));

    IF v_own_left < v_wanted THEN
        RAISE WARNING
            'PICK_OWN_SHORTFALL: order % nets % of product % at location % but can use %: the bin holds % with % held by other orders',
            v_item.order_id, v_wanted, v_item.product_id, p_location_id, v_own_left, v_allocated, v_others;
    END IF;

    FOR v_row IN
        SELECT b.id, b.batch_id, b.handling_unit_id, b.allocated, b.on_hand
          FROM public.inventory_balances b
          LEFT JOIN public.batches bt ON bt.id = b.batch_id
         WHERE b.product_id = v_item.product_id
           AND b.location_id = p_location_id
           AND b.on_hand > 0
         ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
           FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_dealloc := LEAST(v_remaining, v_own_left, v_row.allocated);
        v_free := v_row.on_hand - v_row.allocated;
        v_take := LEAST(v_remaining, v_free + v_dealloc);
        IF v_dealloc > v_take THEN
            v_dealloc := v_take;
        END IF;
        CONTINUE WHEN v_take <= 0;
        PERFORM public.inv_apply_leg(
            v_item.product_id, p_location_id, v_row.batch_id, -v_take, -v_dealloc,
            'pick', p_actor, 'order', v_item.order_id, NULL,
            NULL, v_row.handling_unit_id);
        v_last_batch := v_row.batch_id;
        v_remaining := v_remaining - v_take;
        v_own_left := v_own_left - v_dealloc;
    END LOOP;

    -- See the header. Only rows with allocated > 0 get a leg, so 0 <= allocated holds, and
    -- on_hand does not move, so allocated <= on_hand does. own_left is within what is safely
    -- this order's, so the bin keeps what others hold.
    IF v_own_left > 0 THEN
        FOR v_row IN
            SELECT b.batch_id, b.handling_unit_id, b.allocated
              FROM public.inventory_balances b
             WHERE b.product_id = v_item.product_id
               AND b.location_id = p_location_id
               AND b.allocated > 0
             ORDER BY b.id
        LOOP
            EXIT WHEN v_own_left <= 0;
            v_dealloc := LEAST(v_own_left, v_row.allocated);
            PERFORM public.inv_apply_leg(
                v_item.product_id, p_location_id, v_row.batch_id, 0, -v_dealloc,
                'pick', p_actor, 'order', v_item.order_id, 'own reservation settled',
                NULL, v_row.handling_unit_id);
            v_own_left := v_own_left - v_dealloc;
        END LOOP;
    END IF;

    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, p_location_id, v_last_batch, p_picked_qty::INT, p_actor);

    IF v_remaining > 0 THEN
        INSERT INTO public.pick_differences AS d
            (order_id, order_item_id, product_id, location_id, kind,
             ordered_qty, picked_qty, unrecorded_qty_base, recount_needed, created_by)
        VALUES
            (v_item.order_id, p_order_item_id, v_item.product_id, p_location_id, 'unrecorded_stock',
             v_item.quantity, v_already + p_picked_qty, v_remaining, true, p_actor)
        ON CONFLICT (order_item_id, location_id) WHERE kind = 'unrecorded_stock'
        DO UPDATE SET
            picked_qty          = EXCLUDED.picked_qty,
            unrecorded_qty_base = d.unrecorded_qty_base + EXCLUDED.unrecorded_qty_base,
            recount_needed      = true,
            resolved_at         = NULL,
            resolved_by         = NULL;
    END IF;

    SELECT NOT EXISTS (
        SELECT 1 FROM public.order_items oi
         WHERE oi.order_id = v_item.order_id
           AND oi.quantity > COALESCE((
               SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                WHERE pp.order_item_id = oi.id), 0)
           AND NOT EXISTS (
               SELECT 1 FROM public.pick_differences d
                WHERE d.order_item_id = oi.id AND d.kind = 'short')
    ) INTO v_order_done;

    RETURN jsonb_build_object(
        'line_fully_picked',   (v_already + p_picked_qty) >= v_item.quantity,
        'order_fully_picked',  v_order_done,
        'unrecorded_qty_base', GREATEST(v_remaining, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.inv_pick_imported_line(INT, NUMERIC, INT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_pick_imported_line(INT, NUMERIC, INT, UUID) TO service_role;

-- From v_factor down, this is 00075's text for every order with no invoice number. The
-- result of an imported pick carries unrecorded_qty_base as well.

CREATE OR REPLACE FUNCTION public.inv_pick_order_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,
    p_location_id   INT DEFAULT NULL,
    p_actor         UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc           INT := COALESCE(p_location_id, public.inv_default_location());
    v_item          RECORD;
    v_factor        NUMERIC;
    v_already       NUMERIC;
    v_remaining     NUMERIC;
    v_take          NUMERIC;
    v_dealloc       NUMERIC;
    v_row           RECORD;
    v_last_batch    INT;
    v_order_done    BOOLEAN;
    v_invoice       TEXT;
BEGIN
    IF p_picked_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: picked_qty must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF v_loc IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.pack_size
    INTO v_item
    FROM public.order_items oi
    WHERE oi.id = p_order_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND: %', p_order_item_id USING ERRCODE = 'P0001';
    END IF;

    SELECT o.qb_invoice_number INTO v_invoice
    FROM public.orders o
    WHERE o.id = v_item.order_id;
    IF v_invoice IS NOT NULL THEN
        RETURN public.inv_pick_imported_line(p_order_item_id, p_picked_qty, v_loc, p_actor);
    END IF;

    v_factor := COALESCE(v_item.pack_size, 1);

    SELECT COALESCE(SUM(picked_qty), 0) INTO v_already
    FROM public.pick_progress WHERE order_item_id = p_order_item_id;

    IF v_already + p_picked_qty > v_item.quantity THEN
        RAISE EXCEPTION 'OVER_PICK: line % would exceed ordered qty', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    v_remaining := p_picked_qty * v_factor;
    FOR v_row IN
        SELECT b.id, b.batch_id, b.handling_unit_id, b.allocated, b.on_hand
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = v_item.product_id AND b.location_id = v_loc AND b.on_hand > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.on_hand);
        CONTINUE WHEN v_take <= 0;
        v_dealloc := LEAST(v_take, v_row.allocated);
        PERFORM public.inv_apply_leg(
            v_item.product_id, v_loc, v_row.batch_id, -v_take, -v_dealloc,
            'pick', p_actor, 'order', v_item.order_id, NULL,
            NULL, v_row.handling_unit_id);
        v_last_batch := v_row.batch_id;
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by % at pick',
            v_item.product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_loc, v_last_batch, p_picked_qty::INT, p_actor);

    SELECT NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = v_item.order_id
          AND oi.quantity > COALESCE((
              SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
              WHERE pp.order_item_id = oi.id), 0)
    ) INTO v_order_done;

    RETURN jsonb_build_object(
        'line_fully_picked',  (v_already + p_picked_qty) >= v_item.quantity,
        'order_fully_picked', v_order_done
    );
END;
$$;

-- For every other order, the loop at the end is 00040's text. An imported order is judged
-- per product with open units, shared across its lines: it is not complete at this warehouse
-- unless its holdings at other warehouses cover those units, and unless 00040's own test
-- passes here. A product with nothing open cannot make it FALSE (see the header).

CREATE OR REPLACE FUNCTION public.inv_warehouse_pick_complete(p_order_id TEXT, p_warehouse_id INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    r RECORD;
BEGIN
    IF (SELECT o.qb_invoice_number FROM public.orders o WHERE o.id = p_order_id) IS NOT NULL THEN
        FOR r IN
            SELECT open_lines.open_base,
                   COALESCE((
                       SELECT SUM(m.qty_delta)
                         FROM public.inventory_movements m
                        WHERE m.ref_type = 'order'
                          AND m.ref_id = p_order_id
                          AND m.movement_type IN ('allocate', 'deallocate')
                          AND m.product_id = open_lines.product_id
                          AND public.inv_root_warehouse(m.location_id) = p_warehouse_id
                   ), 0) AS reserved_here,
                   COALESCE((
                       SELECT SUM(pp.picked_qty * COALESCE(oi.pack_size, 1))
                         FROM public.pick_progress pp
                         JOIN public.order_items oi ON oi.id = pp.order_item_id
                        WHERE pp.order_id = p_order_id
                          AND oi.product_id = open_lines.product_id
                          AND public.inv_root_warehouse(pp.location_id) = p_warehouse_id
                   ), 0) AS picked_here,
                   public.inv_order_held_outside_warehouse(p_order_id, open_lines.product_id, p_warehouse_id) AS elsewhere
              FROM (
                  SELECT oi.product_id,
                         SUM(GREATEST(oi.quantity - COALESCE((
                                 SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                                  WHERE pp.order_item_id = oi.id
                             ), 0), 0) * COALESCE(oi.pack_size, 1)) AS open_base
                    FROM public.order_items oi
                   WHERE oi.order_id = p_order_id
                     AND NOT EXISTS (
                         SELECT 1 FROM public.pick_differences d
                          WHERE d.order_item_id = oi.id AND d.kind = 'short'
                     )
                   GROUP BY oi.product_id
              ) open_lines
             WHERE open_lines.open_base > 0
        LOOP
            IF r.open_base > r.elsewhere + 0.000001 THEN
                RETURN FALSE;
            END IF;
            IF r.reserved_here > 0.000001 AND r.picked_here < r.reserved_here - 0.000001 THEN
                RETURN FALSE;
            END IF;
        END LOOP;
        RETURN TRUE;
    END IF;

    FOR r IN
        SELECT res.product_id, res.reserved, COALESCE(pk.picked, 0) AS picked
        FROM (
            SELECT m.product_id, SUM(m.qty_delta) AS reserved
            FROM public.inventory_movements m
            WHERE m.ref_type = 'order' AND m.ref_id = p_order_id
              AND m.movement_type IN ('allocate', 'deallocate')
              AND public.inv_root_warehouse(m.location_id) = p_warehouse_id
            GROUP BY m.product_id
        ) res
        LEFT JOIN (
            SELECT oi.product_id, SUM(pp.picked_qty * COALESCE(oi.pack_size, 1)) AS picked
            FROM public.pick_progress pp
            JOIN public.order_items oi ON oi.id = pp.order_item_id
            WHERE pp.order_id = p_order_id
              AND public.inv_root_warehouse(pp.location_id) = p_warehouse_id
            GROUP BY oi.product_id
        ) pk ON pk.product_id = res.product_id
    LOOP
        IF r.reserved > 0.000001 AND r.picked < r.reserved - 0.000001 THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. qb_update_invoice_tx: refused once a difference exists
-- ---------------------------------------------------------------------------
-- 00139's text and one new refusal. A line closed short with zero picks has no pick
-- row, so picking_started does not see it, and deleting the line would break the foreign
-- key on pick_differences.

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

    IF EXISTS (SELECT 1 FROM public.pick_differences d WHERE d.order_id = v_order_id) THEN
        RETURN jsonb_build_object('status', 'refused', 'reason', 'difference_recorded');
    END IF;

    PERFORM public.qb_release_own_allocation(v_order_id, p_actor);

    -- pick_progress and pick_differences are the only tables with a foreign key to
    -- order_items, and the checks above have just shown this order has neither's rows.
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

COMMENT ON FUNCTION public.qb_update_invoice_tx(TEXT, INT, DATE, JSONB, UUID, INT[]) IS
    'Apply a changed QuickBooks invoice to its order: give back this order''s own '
    'reservation, rewrite its lines and total, and reserve again. Refused once picking has '
    'started, a difference is recorded, or the order is outside processing and processed. '
    'service_role only (mig 00139, 00140).';
