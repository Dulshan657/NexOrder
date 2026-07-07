-- =============================================================================
-- Warehouse Intelligence Engine — user-managed storage-unit types
-- Migration: 00056_storage_types.sql
-- =============================================================================
-- Adds a tenant-global catalogue of physical storage-unit types (Pallet Rack,
-- Shelving, Bulk Floor, Cold Room, …) that operators can extend. A type carries
-- DEFAULTS — a slot unit and a default soft capacity — that pre-fill a rack when
-- it's placed in the designer; locations.storage_type_id records which type a
-- rack is. The engine still reads locations.slot_kind / capacity_slots directly
-- (untouched here), so this is purely additive: existing racks keep working with
-- no storage_type_id.
--
-- Additive, idempotent, and safe. Writes are service-role only (mirrors the
-- zone_profiles lockdown in 00047); the mutate-storage-type Edge Function is the
-- sole write path.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.storage_types (
    id                     SERIAL PRIMARY KEY,
    code                   TEXT NOT NULL UNIQUE,
    name                   TEXT NOT NULL,
    /** Default soft capacity a rack of this type gets when placed (NULL = uncounted). */
    default_capacity_slots NUMERIC(14,3),
    /** What one "slot" means for this type. 'each'/'uncounted' do not map onto the
     *  engine's pallet/carton slot_kind (which stays NULL for those). */
    slot_unit              TEXT NOT NULL DEFAULT 'pallet'
                               CHECK (slot_unit IN ('pallet','carton','each','uncounted')),
    /** Free-form flags (e.g. {"is_cold": true}); reserved for future engine rules. */
    attributes             JSONB NOT NULL DEFAULT '{}',
    is_active              BOOLEAN NOT NULL DEFAULT true,
    sort_order             INT NOT NULL DEFAULT 100,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS storage_type_id INT REFERENCES public.storage_types(id) ON DELETE SET NULL;

-- Standard starter catalogue (idempotent seed keyed on code).
INSERT INTO public.storage_types (code, name, default_capacity_slots, slot_unit, attributes, sort_order)
SELECT * FROM (VALUES
    ('PALLET_RACK', 'Pallet Rack', 10::numeric, 'pallet',    '{}'::jsonb,              10),
    ('SHELVING',    'Shelving',    40::numeric, 'carton',     '{}'::jsonb,              20),
    ('BULK_FLOOR',  'Bulk Floor',  NULL::numeric, 'uncounted', '{}'::jsonb,             30),
    ('COLD_ROOM',   'Cold Room',   6::numeric,  'pallet',     '{"is_cold": true}'::jsonb, 40)
) AS v(code, name, default_capacity_slots, slot_unit, attributes, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM public.storage_types s WHERE s.code = v.code
);

-- RLS: read-only for ops; created/edited via the service-role Edge Function only.
ALTER TABLE public.storage_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "storage_types_select_ops" ON public.storage_types;
CREATE POLICY "storage_types_select_ops" ON public.storage_types FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
GRANT SELECT ON public.storage_types TO authenticated;

COMMIT;

-- Verify:
--   SELECT code, name, slot_unit, default_capacity_slots FROM public.storage_types ORDER BY sort_order;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'locations' AND column_name = 'storage_type_id';
