-- =============================================================================
-- Receiving requirements: which products must arrive with a lot code / expiry
-- Migration: 00134_receiving_requirements.sql
-- =============================================================================
-- NX-0005. Receive Stock asked every line for a lot code, an expiry and a batch
-- barcode, which is clutter on most lines and too easy to skip on the lines
-- where it matters (food with a best-before). These two flags let an admin say
-- which products need which, so the receive screen can show the field inline,
-- require it, and keep it out of the way everywhere else.
--
-- Enforced by the CLIENT only, for now. `receive-stock` is also the path the
-- CSV stock import uses, and making the server refuse a line without an expiry
-- would break an import of existing stock. Server enforcement is a follow-up.
--
-- Additive and safe: NOT NULL DEFAULT false, so every existing product behaves
-- exactly as before. 00133 is taken by voice_sessions on a parallel branch;
-- this number is deliberately after it.
-- Writes go through mutate-wms-attributes (Admin, Manager); reads use the
-- existing product_wms_attributes_select_ops policy (00048).
-- =============================================================================

BEGIN;

ALTER TABLE public.product_wms_attributes
    ADD COLUMN IF NOT EXISTS requires_lot    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS requires_expiry BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_wms_attributes.requires_lot IS
    'Receive Stock must capture a lot code for this product (NX-0005; client-enforced).';
COMMENT ON COLUMN public.product_wms_attributes.requires_expiry IS
    'Receive Stock must capture an expiry date for this product (NX-0005; client-enforced).';

COMMIT;
