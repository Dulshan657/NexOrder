-- =============================================================================
-- New Order drafts (NX-0048)
-- Migration: 00150_order_drafts.sql
-- =============================================================================
-- An order being keyed on the New Order screen is saved as it is typed, so a
-- phone call that is interrupted, a device that is switched or a colleague who
-- takes over does not lose the work. Drafts are SHARED: any Admin or Manager
-- sees and can finish any draft, which is why the author is recorded.
--
-- WRITES GO THROUGH mutate-order-draft ONLY. Created with RLS on, one SELECT
-- policy for Admin/Manager, and every client write privilege revoked --
-- including TRUNCATE, which RLS cannot constrain, and from anon as well as
-- authenticated (this project carries ALTER DEFAULT PRIVILEGES for both; see
-- 00101/00102). place-order deletes a draft once the order it became commits.
--
-- `lines` is a jsonb array of { productId, uomId, quantity }, validated by
-- _shared/orderDraftPayload.ts. It holds a QUANTITY IN THE CHOSEN UNIT, the
-- same thing place-order receives. No foreign key reaches into it: a product
-- deactivated after the draft was saved is the screen's to explain, not a
-- reason to refuse the save.
-- =============================================================================

BEGIN;

CREATE TABLE public.order_drafts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    horeca_id     integer REFERENCES public.horecas(id) ON DELETE SET NULL,
    lines         jsonb NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(lines) = 'array'),
    delivery_date date,
    notes         text CHECK (notes IS NULL OR char_length(notes) <= 2000),
    created_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: deleting a colleague's login must not delete a
    -- draft someone else created merely because they were the last to touch it.
    updated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_drafts_updated_at_idx ON public.order_drafts (updated_at DESC);

ALTER TABLE public.order_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_drafts TO authenticated;

CREATE POLICY order_drafts_select_office
    ON public.order_drafts
    FOR SELECT
    TO authenticated
    USING (public.user_role() IN ('Admin', 'Manager'));

COMMENT ON TABLE public.order_drafts IS
    'New Order screen drafts, shared by Admin/Manager. Written only by the '
    'mutate-order-draft Edge Function; deleted by place-order once the order commits (NX-0048).';

COMMIT;
