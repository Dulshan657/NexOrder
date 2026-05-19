-- 00021_po_review_extensions.sql
--
-- Adds the schema surface the rebuilt PO review modal needs:
--   1. horecas.contact_email                  -- deterministic sender→HoReCa match
--   2. horeca_addresses                       -- per-HoReCa address book
--   3. orders.delivery_address (JSONB)        -- per-order shipping snapshot
--   + backfill of horeca_addresses.default from the legacy horecas.address text.
--
-- Why JSONB snapshot on orders rather than a FK: a HoReCa's address book may
-- evolve after the order is placed, but historical orders must remain truthful
-- about where they were shipped. Denormalisation costs one column; the FK
-- alternative requires either soft-deletes on horeca_addresses or "address
-- rev" tracking, neither of which is justified for an MVP. source_address_id
-- is captured inside the JSONB for cross-reference when the row still exists.

BEGIN;

-- =============================================================================
-- 1. horecas.contact_email
-- =============================================================================
-- Lowercased on write (enforced in mutate-horeca Edge Function in a follow-up).
-- Nullable for back-compat with existing rows.  A UNIQUE partial index lets
-- multiple HoReCas keep NULL but blocks accidental duplicate sender mappings.

ALTER TABLE public.horecas
    ADD COLUMN IF NOT EXISTS contact_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_horecas_contact_email
    ON public.horecas (lower(contact_email))
    WHERE contact_email IS NOT NULL;

COMMENT ON COLUMN public.horecas.contact_email IS
    'Lower-cased contact email; deterministic match source for inbound PO email senders. '
    'Nullable. Mutated only via mutate-horeca Edge Function.';

-- =============================================================================
-- 2. horeca_addresses (the address book)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.horeca_addresses (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    horeca_id           INT             NOT NULL REFERENCES public.horecas(id) ON DELETE CASCADE,
    label               TEXT,                                  -- "Main kitchen", "Warehouse", ...
    street              TEXT            NOT NULL,
    city                TEXT,
    postcode            TEXT,
    country             TEXT,
    recipient_name      TEXT,
    is_default          BOOLEAN         NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- At most one default per HoReCa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_horeca_addresses_one_default
    ON public.horeca_addresses (horeca_id)
    WHERE is_default;

-- Hot-path lookup pattern: "give me all addresses for HoReCa X".
CREATE INDEX IF NOT EXISTS idx_horeca_addresses_horeca
    ON public.horeca_addresses (horeca_id);

COMMENT ON TABLE public.horeca_addresses IS
    'Per-HoReCa shipping-address book. Direct INSERT/UPDATE/DELETE denied to '
    'authenticated; mutations gated by the mutate-horeca-address Edge Function. '
    'The PO Inbox modal can append new addresses here while approving a PO.';

-- updated_at trigger reuses the existing helper from migration 00018.
CREATE TRIGGER trg_horeca_addresses_updated_at
    BEFORE UPDATE ON public.horeca_addresses
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: staff see all; customers see only their own HoReCa's addresses.
ALTER TABLE public.horeca_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "horeca_addresses_select_staff"
    ON public.horeca_addresses FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Admin','Manager','Field Sales Rep','Office Sales Rep')
    );

CREATE POLICY "horeca_addresses_select_customer"
    ON public.horeca_addresses FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) = 'Restaurant/Hotel Customer'
        AND horeca_id = (SELECT public.user_horeca_id())
    );

-- No INSERT/UPDATE/DELETE policies — service-role (Edge Functions) bypasses RLS,
-- everyone else is denied by absence of a policy plus the REVOKE below.
REVOKE INSERT, UPDATE, DELETE ON public.horeca_addresses FROM authenticated;

-- =============================================================================
-- 3. orders.delivery_address (per-order JSONB snapshot)
-- =============================================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_address JSONB;

COMMENT ON COLUMN public.orders.delivery_address IS
    'Snapshot of the shipping address chosen at order-creation time. Shape: '
    '{ street, city?, postcode?, country?, recipient_name?, source_address_id? }. '
    'NULL means "fall back to horecas.address" (legacy back-compat).';

-- Conservative shape guard — prevents writers from stashing arbitrary JSON.
ALTER TABLE public.orders
    ADD CONSTRAINT orders_delivery_address_is_object
    CHECK (delivery_address IS NULL OR jsonb_typeof(delivery_address) = 'object');

-- =============================================================================
-- 4. Backfill the address book from the legacy horecas.address text column
-- =============================================================================
-- One row per existing HoReCa, flagged is_default=true. Preserves the legacy
-- value verbatim into the `street` field — operators can split it into
-- street/city/postcode later via the HoReCa admin tab.
--
-- Guarded with NOT EXISTS so re-running this migration is idempotent.

INSERT INTO public.horeca_addresses (horeca_id, street, is_default)
SELECT h.id, h.address, true
FROM public.horecas h
WHERE NOT EXISTS (
    SELECT 1 FROM public.horeca_addresses ha
    WHERE ha.horeca_id = h.id
);

COMMIT;
