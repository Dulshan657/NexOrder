-- =============================================================================
-- Scan identity & printed labels — Phase 1 of QR tracking
-- Migration: 00074_scan_identity_and_labels.sql
-- =============================================================================
-- Phase 1 gives every location and product a scannable identity and a printable
-- label. It deliberately touches NO inventory table: `inventory_balances`,
-- `inventory_movements` and every `inv_*` RPC are untouched here, so this
-- migration cannot affect live stock. The handling-unit (pallet/carton)
-- dimension lands separately in 00075.
--
-- Three things happen:
--
--   1. products.barcode becomes a real identifier. The column has existed since
--      00027 but nothing ever wrote it (verified on prod: 140 products, 0
--      barcodes), so a partial UNIQUE index can be added with no backfill and no
--      risk of tripping on existing duplicates. Partial (WHERE NOT NULL) because
--      most products will never carry a supplier EAN — NULL must stay repeatable.
--
--   2. A private `warehouse-labels` Storage bucket, mirroring 00031's
--      order-documents pattern exactly: private, PDF-only, read by ops roles,
--      written only by the service_role via the generate-labels Edge Function,
--      fetched by the UI through a short-lived signed URL.
--
--   3. `label_print_log` records every generated sheet so a label can be
--      reprinted from history rather than re-derived, and so "who printed the
--      MAIN aisle signs, and when" is answerable. It is a log, not state: the
--      labels themselves are reproducible from locations/products at any time.
--
-- The QR payload is deliberately BARE TEXT — a `locations.code`, a product SKU,
-- or (from 00075) a handling-unit code — with no URL and no namespace prefix, so
-- any third-party scanner reads something meaningful. That makes cross-namespace
-- collisions possible in principle, so the client resolver (lib/scan/resolveScan.ts)
-- reports an ambiguous match rather than guessing. The one namespace we control
-- is the handling-unit code, minted as `HU-000123`; the assertion below fails the
-- migration if any EXISTING location code or SKU already occupies that shape,
-- which would poison the resolver before 00075 ever mints one.
--
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box — see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Product & batch barcode identity
-- ---------------------------------------------------------------------------
-- Supplier EAN/UPC captured by scanning. Partial-unique so two products can
-- never claim the same physical carton barcode, while NULL stays free-for-all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode
    ON public.products (barcode)
    WHERE barcode IS NOT NULL;

COMMENT ON COLUMN public.products.barcode IS
    'Supplier EAN/UPC/Code128 captured by scanning, or NULL when the product '
    'carries no manufacturer barcode (then our own printed QR, encoding the SKU, '
    'is the identifier). Partial-unique: no two products may share one barcode.';

-- Batch barcodes are NOT unique — a supplier may reuse a lot barcode across
-- products — but they are looked up on every scan, so they need an index.
CREATE INDEX IF NOT EXISTS idx_batches_barcode
    ON public.batches (barcode)
    WHERE barcode IS NOT NULL;

-- Scans resolve a typed/decoded string against locations.code. The column is
-- already globally UNIQUE (00027), which gives us an index for exact match, but
-- the resolver also case-folds — an operator typing a code by hand from a label
-- should not be defeated by capitalisation.
CREATE INDEX IF NOT EXISTS idx_locations_code_lower
    ON public.locations (lower(code));

-- ---------------------------------------------------------------------------
-- 2. Handling-unit namespace guard (protects 00075 before it exists)
-- ---------------------------------------------------------------------------
-- 00075 mints handling-unit codes as 'HU-000123'. If a location code or SKU
-- already looks like that, every scan of it becomes ambiguous. Fail loudly here
-- rather than discover it after labels are printed and stuck to racks.
DO $$
DECLARE
    v_conflicts TEXT;
BEGIN
    SELECT string_agg(code, ', ')
      INTO v_conflicts
      FROM (
          SELECT code FROM public.locations WHERE code ILIKE 'HU-%'
          UNION ALL
          SELECT sku  FROM public.products  WHERE sku  ILIKE 'HU-%'
      ) AS conflicting;

    IF v_conflicts IS NOT NULL THEN
        RAISE EXCEPTION
            'HU_NAMESPACE_CONFLICT: these location codes / SKUs occupy the handling-unit prefix reserved by 00075: %',
            v_conflicts
            USING ERRCODE = 'P0001';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Private label bucket  (mirrors 00031 order-documents)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'warehouse-labels',
    'warehouse-labels',
    false,                              -- private; UI fetches via signed URL
    20 * 1024 * 1024,                   -- 20 MB: a full-warehouse sheet run is many pages of QR vectors
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "warehouse_labels_select_ops" ON storage.objects;
CREATE POLICY "warehouse_labels_select_ops"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'warehouse-labels'
        AND (SELECT public.user_role()) IN ('Admin','Manager','Warehouse')
    );

-- ---------------------------------------------------------------------------
-- 4. label_print_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.label_print_log (
    id            BIGSERIAL     PRIMARY KEY,
    label_kind    TEXT          NOT NULL
                      CHECK (label_kind IN ('location', 'product', 'handling_unit')),
    -- Denormalised on purpose: the codes printed onto this sheet, captured as
    -- they were AT PRINT TIME. A location can be renamed or deactivated later;
    -- the sticker on the rack still says what it said, and this row is the only
    -- record of that. Not a FK for the same reason.
    codes         TEXT[]        NOT NULL,
    label_count   INT           NOT NULL CHECK (label_count >= 0),
    -- Nullable: product sheets are not warehouse-scoped.
    warehouse_id  INT           REFERENCES public.locations(id) ON DELETE SET NULL,
    storage_path  TEXT          NOT NULL,
    generated_by  UUID          NOT NULL REFERENCES auth.users(id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_print_log_created
    ON public.label_print_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_label_print_log_warehouse
    ON public.label_print_log (warehouse_id, created_at DESC);

COMMENT ON TABLE public.label_print_log IS
    'One row per generated label sheet PDF (bucket warehouse-labels). Written '
    'only by the generate-labels Edge Function via service_role. Lets a sheet be '
    're-downloaded instead of regenerated, and answers who printed what, when.';

-- RLS: ops roles read, service_role writes. Same shape as every other
-- Edge-Function-owned table (audit_events 00012, client_errors 00014).
ALTER TABLE public.label_print_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "label_print_log_select_ops" ON public.label_print_log;
CREATE POLICY "label_print_log_select_ops"
    ON public.label_print_log FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

-- No INSERT/UPDATE/DELETE policy for `authenticated` at all: with RLS enabled
-- and no permissive policy, every such write is denied. service_role bypasses
-- RLS entirely, so the Edge Function still writes.

GRANT SELECT ON public.label_print_log TO authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('products','batches','locations')
--      AND indexname IN ('uq_products_barcode','idx_batches_barcode','idx_locations_code_lower');
--   SELECT id, public FROM storage.buckets WHERE id = 'warehouse-labels';
--   SELECT count(*) FROM public.label_print_log;
-- =============================================================================
