-- =============================================================================
-- Warehouse Intelligence Engine — core schema (Phase 1)
-- Migration: 00045_wie_core.sql
-- =============================================================================
-- Adds the spatial/optimization substrate on top of the existing inventory model
-- WITHOUT forking any live-stock identity. A `locations` row stays the permanent
-- physical identity of a bin/zone; all geometry, graph and version-specific data
-- live in layout_* tables keyed by layout_id, so cloning/versioning a layout
-- never touches inventory_balances / pick_progress FKs.
--
-- Additive & bulk-safe: every column is nullable/defaulted, no inv_* RPC changes,
-- and bulk warehouses are untouched until an admin publishes a layout for them.
-- Idempotent; apply via the Management API. RLS ships separately in 00046.
-- =============================================================================

BEGIN;

-- ── 1. Widen locations.kind for the full spatial hierarchy ───────────────────
-- The kind CHECK was created inline in 00027 as an unnamed column check, which
-- Postgres auto-names `locations_kind_check`. Drop it by that name, plus a
-- deterministic fallback matching ONLY the kind check: it is the sole locations
-- check mentioning 'WAREHOUSE', and the NOT-'slot_kind' guard keeps us from ever
-- matching 00039's slot_kind check. STAGING = dock-side stock.
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_kind_check;
DO $$
DECLARE v_name TEXT;
BEGIN
    SELECT conname INTO v_name
    FROM pg_constraint
    WHERE conrelid = 'public.locations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%WAREHOUSE%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%slot_kind%'
    LIMIT 1;
    IF v_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.locations DROP CONSTRAINT %I', v_name);
    END IF;
END $$;

ALTER TABLE public.locations
    ADD CONSTRAINT locations_kind_check
    CHECK (kind IN ('WAREHOUSE','ZONE','AISLE','RACK','BAY','SHELF','BIN','STAGING'));

ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS active_layout_id     INT,
    ADD COLUMN IF NOT EXISTS created_in_layout_id INT;

-- ── 2. warehouse_layouts — versioned layouts (one published per warehouse) ────
CREATE TABLE IF NOT EXISTS public.warehouse_layouts (
    id            SERIAL       PRIMARY KEY,
    warehouse_id  INT          NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    name          TEXT         NOT NULL,
    status        TEXT         NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','archived')),
    version       INT          NOT NULL DEFAULT 1,
    cloned_from   INT          REFERENCES public.warehouse_layouts(id),
    grid_width    INT          NOT NULL DEFAULT 60,
    grid_height   INT          NOT NULL DEFAULT 40,
    cell_size_m   NUMERIC(6,2) NOT NULL DEFAULT 1.0,
    floor_count   INT          NOT NULL DEFAULT 1,   -- multi-floor in schema day one
    published_at  TIMESTAMPTZ,
    created_by    UUID         REFERENCES public.profiles(id),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (warehouse_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_layouts_one_published
    ON public.warehouse_layouts(warehouse_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_warehouse_layouts_warehouse
    ON public.warehouse_layouts(warehouse_id);

-- Wire the locations back-references now that the target table exists.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_active_layout_fk') THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_active_layout_fk
            FOREIGN KEY (active_layout_id) REFERENCES public.warehouse_layouts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_created_in_layout_fk') THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_created_in_layout_fk
            FOREIGN KEY (created_in_layout_id) REFERENCES public.warehouse_layouts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ── 3. layout_placements — versioned geometry for storage locations ──────────
CREATE TABLE IF NOT EXISTS public.layout_placements (
    id              SERIAL  PRIMARY KEY,
    layout_id       INT     NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    location_id     INT     NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    floor           INT     NOT NULL DEFAULT 0,
    x               INT     NOT NULL,
    y               INT     NOT NULL,
    w               INT     NOT NULL DEFAULT 1,
    h               INT     NOT NULL DEFAULT 1,
    rotation        INT     NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
    graph_node_id   INT,                 -- set at publish (snapped walk node)
    access_offset_m NUMERIC(8,2),
    UNIQUE (layout_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_layout_placements_layout ON public.layout_placements(layout_id, floor);

-- ── 4. layout_objects — non-storage grid objects (walls/docks/walkways) ──────
CREATE TABLE IF NOT EXISTS public.layout_objects (
    id                  SERIAL PRIMARY KEY,
    layout_id           INT    NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    object_type         TEXT   NOT NULL CHECK (object_type IN ('wall','dock','walkway','obstacle','label')),
    floor               INT    NOT NULL DEFAULT 0,
    x                   INT    NOT NULL,
    y                   INT    NOT NULL,
    w                   INT    NOT NULL DEFAULT 1,
    h                   INT    NOT NULL DEFAULT 1,
    meta                JSONB  NOT NULL DEFAULT '{}',
    staging_location_id INT    REFERENCES public.locations(id)   -- docks only
);
CREATE INDEX IF NOT EXISTS idx_layout_objects_layout ON public.layout_objects(layout_id, floor);

-- ── 5. Walkway graph — built at publish from walkway objects ─────────────────
CREATE TABLE IF NOT EXISTS public.layout_graph_nodes (
    id        SERIAL PRIMARY KEY,
    layout_id INT  NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    floor     INT  NOT NULL DEFAULT 0,
    x         INT  NOT NULL,
    y         INT  NOT NULL,
    node_type TEXT NOT NULL DEFAULT 'walk'
                  CHECK (node_type IN ('walk','junction','dock','lift'))
);
CREATE INDEX IF NOT EXISTS idx_layout_graph_nodes_layout ON public.layout_graph_nodes(layout_id);

CREATE TABLE IF NOT EXISTS public.layout_graph_edges (
    id            SERIAL PRIMARY KEY,
    layout_id     INT NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    from_node     INT NOT NULL REFERENCES public.layout_graph_nodes(id) ON DELETE CASCADE,
    to_node       INT NOT NULL REFERENCES public.layout_graph_nodes(id) ON DELETE CASCADE,
    weight_m      NUMERIC(10,2) NOT NULL,
    bidirectional BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_layout_graph_edges_layout ON public.layout_graph_edges(layout_id, from_node);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'layout_placements_graph_node_fk') THEN
        ALTER TABLE public.layout_placements
            ADD CONSTRAINT layout_placements_graph_node_fk
            FOREIGN KEY (graph_node_id) REFERENCES public.layout_graph_nodes(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ── 6. Precomputed anchor→node distances (docks/zone entries only) ───────────
CREATE TABLE IF NOT EXISTS public.layout_travel_distances (
    layout_id    INT NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    from_node_id INT NOT NULL REFERENCES public.layout_graph_nodes(id) ON DELETE CASCADE,
    to_node_id   INT NOT NULL REFERENCES public.layout_graph_nodes(id) ON DELETE CASCADE,
    distance_m   NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (layout_id, from_node_id, to_node_id)
);

-- ── 7. wie_rules — structured-JSON putaway/picking/slotting rules ────────────
CREATE TABLE IF NOT EXISTS public.wie_rules (
    id           SERIAL PRIMARY KEY,
    warehouse_id INT  REFERENCES public.locations(id) ON DELETE CASCADE,  -- NULL = global
    name         TEXT NOT NULL,
    rule_type    TEXT NOT NULL CHECK (rule_type IN ('putaway','picking','slotting')),
    enforcement  TEXT NOT NULL CHECK (enforcement IN ('hard','soft')),
    priority     INT  NOT NULL DEFAULT 100,
    definition   JSONB NOT NULL,        -- {conditions:[...], action:{...}}
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID REFERENCES public.profiles(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wie_rules_warehouse ON public.wie_rules(warehouse_id, rule_type) WHERE is_active;

-- ── 8. wie_putaway_recommendations — audit + accept/override workflow ────────
CREATE TABLE IF NOT EXISTS public.wie_putaway_recommendations (
    id                       BIGSERIAL PRIMARY KEY,
    warehouse_id             INT  NOT NULL REFERENCES public.locations(id),
    layout_id                INT  NOT NULL REFERENCES public.warehouse_layouts(id),
    product_id               INT  NOT NULL REFERENCES public.products(id),
    quantity                 NUMERIC(14,3) NOT NULL,
    goods_receipt_id         INT  REFERENCES public.goods_receipts(id),
    recommended_location_id  INT  REFERENCES public.locations(id),
    alternatives             JSONB NOT NULL DEFAULT '[]',
    explanation              JSONB NOT NULL,
    engine_version           TEXT  NOT NULL,
    status                   TEXT  NOT NULL DEFAULT 'suggested'
                                 CHECK (status IN ('suggested','accepted','overridden','expired')),
    chosen_location_id       INT  REFERENCES public.locations(id),
    actor_id                 UUID REFERENCES public.profiles(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wie_putaway_recs_wh
    ON public.wie_putaway_recommendations(warehouse_id, status, created_at DESC);

-- ── 9. wie_publish_layout_tx — atomic draft→published transition ─────────────
-- Called by the publish-layout edge function with the engine-built graph
-- (nodes/edges), snapped placements, and precomputed anchor distances. Everything
-- lands in ONE transaction so a partial publish is impossible. Node ids are
-- assigned here; the payload references nodes by their engine-local index.
CREATE OR REPLACE FUNCTION public.wie_publish_layout_tx(
    p_layout_id    INT,
    p_nodes        JSONB,   -- [{local_id,floor,x,y,node_type}]
    p_edges        JSONB,   -- [{from_local,to_local,weight_m,bidirectional}]
    p_snaps        JSONB,   -- [{location_id,node_local_id,access_offset_m}]
    p_distances    JSONB,   -- [{from_local,to_local,distance_m}]
    p_activate     INT[],   -- location ids to activate (draft-created bins)
    p_deactivate   INT[],   -- location ids to deactivate (removed empty bins)
    p_actor        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_warehouse_id INT;
    v_node    JSONB;
    v_db_id   INT;
    v_blocked INT;
BEGIN
    SELECT warehouse_id INTO v_warehouse_id
    FROM public.warehouse_layouts WHERE id = p_layout_id;
    IF v_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'LAYOUT_NOT_FOUND: %', p_layout_id USING ERRCODE = 'P0001';
    END IF;

    -- Guard: never deactivate a bin that still holds stock.
    IF p_deactivate IS NOT NULL AND array_length(p_deactivate, 1) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_blocked
        FROM public.inventory_balances b
        WHERE b.location_id = ANY(p_deactivate) AND b.on_hand > 0;
        IF v_blocked > 0 THEN
            RAISE EXCEPTION 'STOCK_IN_REMOVED_BIN: % bin(s) slated for removal still hold stock', v_blocked
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Clear any prior graph for this layout (republish/rollback rebuilds it).
    DELETE FROM public.layout_travel_distances WHERE layout_id = p_layout_id;
    DELETE FROM public.layout_graph_edges      WHERE layout_id = p_layout_id;
    UPDATE public.layout_placements SET graph_node_id = NULL WHERE layout_id = p_layout_id;
    DELETE FROM public.layout_graph_nodes      WHERE layout_id = p_layout_id;

    -- Insert nodes, mapping engine-local index → real id.
    CREATE TEMP TABLE _wie_nodemap (local_id INT PRIMARY KEY, db_id INT) ON COMMIT DROP;
    FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes)
    LOOP
        INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type)
        VALUES (
            p_layout_id,
            (v_node->>'floor')::INT,
            (v_node->>'x')::INT,
            (v_node->>'y')::INT,
            v_node->>'node_type'
        )
        RETURNING id INTO v_db_id;
        INSERT INTO _wie_nodemap VALUES ((v_node->>'local_id')::INT, v_db_id);
    END LOOP;

    -- Edges via the mapping.
    INSERT INTO public.layout_graph_edges (layout_id, from_node, to_node, weight_m, bidirectional)
    SELECT p_layout_id, mf.db_id, mt.db_id, (e->>'weight_m')::NUMERIC, COALESCE((e->>'bidirectional')::BOOLEAN, true)
    FROM jsonb_array_elements(p_edges) e
    JOIN _wie_nodemap mf ON mf.local_id = (e->>'from_local')::INT
    JOIN _wie_nodemap mt ON mt.local_id = (e->>'to_local')::INT;

    -- Precomputed distances via the mapping.
    INSERT INTO public.layout_travel_distances (layout_id, from_node_id, to_node_id, distance_m)
    SELECT p_layout_id, mf.db_id, mt.db_id, (d->>'distance_m')::NUMERIC
    FROM jsonb_array_elements(p_distances) d
    JOIN _wie_nodemap mf ON mf.local_id = (d->>'from_local')::INT
    JOIN _wie_nodemap mt ON mt.local_id = (d->>'to_local')::INT
    ON CONFLICT DO NOTHING;

    -- Snap placements onto their nearest node.
    UPDATE public.layout_placements p
    SET graph_node_id   = m.db_id,
        access_offset_m = (s->>'access_offset_m')::NUMERIC
    FROM jsonb_array_elements(p_snaps) s
    JOIN _wie_nodemap m ON m.local_id = (s->>'node_local_id')::INT
    WHERE p.layout_id = p_layout_id AND p.location_id = (s->>'location_id')::INT;

    -- Activate draft-created bins; deactivate removed (already-verified-empty) bins.
    IF p_activate IS NOT NULL AND array_length(p_activate, 1) IS NOT NULL THEN
        UPDATE public.locations SET is_active = true WHERE id = ANY(p_activate);
    END IF;
    IF p_deactivate IS NOT NULL AND array_length(p_deactivate, 1) IS NOT NULL THEN
        UPDATE public.locations SET is_active = false WHERE id = ANY(p_deactivate);
    END IF;

    -- Flip the previously published layout to archived, publish this one.
    UPDATE public.warehouse_layouts
    SET status = 'archived'
    WHERE warehouse_id = v_warehouse_id AND status = 'published' AND id <> p_layout_id;

    UPDATE public.warehouse_layouts
    SET status = 'published', published_at = now(), updated_at = now()
    WHERE id = p_layout_id;

    -- Opt the warehouse into bin-level tracking.
    UPDATE public.locations
    SET active_layout_id = p_layout_id, location_type = 'racked'
    WHERE id = v_warehouse_id;

    RETURN jsonb_build_object(
        'layout_id', p_layout_id,
        'warehouse_id', v_warehouse_id,
        'nodes', (SELECT COUNT(*) FROM public.layout_graph_nodes WHERE layout_id = p_layout_id),
        'distances', (SELECT COUNT(*) FROM public.layout_travel_distances WHERE layout_id = p_layout_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.wie_publish_layout_tx(INT,JSONB,JSONB,JSONB,JSONB,INT[],INT[],UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_publish_layout_tx(INT,JSONB,JSONB,JSONB,JSONB,INT[],INT[],UUID)
    TO service_role;

-- ── 10. wie_putaway_candidates — stage-1 candidate loader (read-only) ────────
-- The heavy join the optimizer needs, kept in SQL: for every placed bin in a
-- layout, its dock distance (min over docks, precomputed), current fill in slots,
-- whether it already holds the product, and its snapped node/offset. Ordered by
-- dock distance so the edge function can cap at p_limit and score in TypeScript.
-- The bin's zone tag is the deepest ZONE ancestor's name (Phase 2 gives zones
-- real semantics; until then the name IS the tag, e.g. a zone "Cold" → 'cold').
CREATE OR REPLACE FUNCTION public.wie_putaway_candidates(
    p_layout_id  INT,
    p_product_id INT,
    p_limit      INT DEFAULT 200
)
RETURNS TABLE(
    location_id          INT,
    code                 TEXT,
    zone_id              INT,
    zone_tag             TEXT,
    capacity_slots       NUMERIC,
    used_slots           NUMERIC,
    graph_node_id        INT,
    access_offset_m      NUMERIC,
    has_same_product     BOOLEAN,
    distance_from_dock_m NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH dock_nodes AS (
        SELECT id FROM public.layout_graph_nodes
        WHERE layout_id = p_layout_id AND node_type = 'dock'
    ),
    node_dock_dist AS (
        SELECT to_node_id AS node_id, MIN(distance_m) AS dist
        FROM public.layout_travel_distances
        WHERE layout_id = p_layout_id AND from_node_id IN (SELECT id FROM dock_nodes)
        GROUP BY to_node_id
    ),
    bin_fill AS (
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pr.size_factor, 1)) AS used_slots
        FROM public.inventory_balances b
        JOIN public.products pr ON pr.id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    same_prod AS (
        SELECT DISTINCT location_id FROM public.inventory_balances
        WHERE product_id = p_product_id AND on_hand > 0
    )
    SELECT
        p.location_id,
        l.code,
        zone.id,
        lower(zone.name),
        l.capacity_slots,
        COALESCE(bf.used_slots, 0),
        p.graph_node_id,
        COALESCE(p.access_offset_m, 0),
        (sp.location_id IS NOT NULL),
        ndd.dist
    FROM public.layout_placements p
    JOIN public.locations l ON l.id = p.location_id
    LEFT JOIN LATERAL (
        SELECT z.id, z.name FROM public.locations z
        WHERE z.kind = 'ZONE' AND l.materialized_path LIKE z.materialized_path || '/%'
        ORDER BY length(z.materialized_path) DESC
        LIMIT 1
    ) zone ON true
    LEFT JOIN node_dock_dist ndd ON ndd.node_id = p.graph_node_id
    LEFT JOIN bin_fill       bf  ON bf.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    WHERE p.layout_id = p_layout_id AND l.is_active
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) TO service_role;

COMMIT;

-- Verify:
--   SELECT conname FROM pg_constraint WHERE conrelid='public.locations'::regclass AND conname='locations_kind_check';
--   SELECT to_regclass('public.warehouse_layouts'), to_regclass('public.layout_placements'),
--          to_regclass('public.layout_graph_nodes'), to_regclass('public.wie_putaway_recommendations');
