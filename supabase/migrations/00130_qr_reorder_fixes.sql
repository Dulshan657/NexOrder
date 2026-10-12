-- =============================================================================
-- HoReCa location QR reorder -- corrections to 00129
-- Migration: 00130_qr_reorder_fixes.sql
-- =============================================================================
-- 00129 is applied and checksummed, so these are edits forward. Three things it
-- got wrong or left out, found while writing the Edge Functions that sit on it:
--
-- 1. delivery_time_slot admitted ('AM','PM'). That is what place-order's request
--    TYPE says (`deliveryTimeSlot?: 'AM' | 'PM'`), but the column it ends up in,
--    orders.delivery_time_slot, is CHECKed against the three labelled windows
--    ('Morning (8am-12pm)' ...) since 00001 -- so a held request in 'AM' could
--    never be approved into an order. Same three strings here, NULL allowed.
--
-- 2. A request needs the requester's NAME as it was when they submitted.
--    qr_staff is never hard-deleted, but a rename or a revoke would otherwise
--    change what an approver reads on an order already waiting. Snapshot it.
--
-- 3. The two SELECT policies used user_is_staff(), which is five roles wide
--    (Admin, Manager, both Reps, Warehouse). The plan says only the venue's
--    ASSIGNED reps approve QR orders and manage its PINs, and a Warehouse login
--    has no business reading a venue's kitchen staff or its held orders.
--    Narrowed to: Admin/Manager, or a rep with a horeca_reps row for that venue,
--    or the venue itself. horeca_reps keeps user_is_staff() -- it is the table
--    the rep arm reads, and an unassigned rep seeing assignment rows is not the
--    leak this closes.
--
--    user_role() is TEXT and returns the exact strings profiles_role_check
--    allows ('Admin','Manager','Field Sales Rep','Office Sales Rep',
--    'Restaurant/Hotel Customer','Warehouse','QR Staff'); 00104 pinned its
--    search_path. An unknown or NULL role matches no arm, so it fails closed.
--
--    The rep arm is a subquery on horeca_reps, which is itself under RLS: it is
--    evaluated as the CALLER, and user_is_staff() is true for a rep, so the rows
--    are visible to exactly the people the arm is for. For a Customer or a QR
--    Staff user it returns nothing, which is the right answer for that arm.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. delivery_time_slot -- the same windows orders accepts
-- -----------------------------------------------------------------------------
ALTER TABLE public.qr_order_requests
    DROP CONSTRAINT IF EXISTS qr_order_requests_delivery_time_slot_check;
ALTER TABLE public.qr_order_requests
    ADD CONSTRAINT qr_order_requests_delivery_time_slot_check
    CHECK (delivery_time_slot IN (
        'Morning (8am-12pm)',
        'Afternoon (12pm-4pm)',
        'Evening (4pm-8pm)'
    ));

-- -----------------------------------------------------------------------------
-- 2. staff_name -- snapshot at submit
-- -----------------------------------------------------------------------------
ALTER TABLE public.qr_order_requests
    ADD COLUMN IF NOT EXISTS staff_name TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.qr_order_requests.staff_name IS
    'The submitting staff member''s name AT SUBMIT (mig 00130). A snapshot, not a '
    'join: renaming or revoking the staff row must not change what an approver '
    'reads on a request already waiting.';

-- -----------------------------------------------------------------------------
-- 3. SELECT policies -- assigned reps, not every staff role
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "qr_staff_select_staff_or_own" ON public.qr_staff;
DROP POLICY IF EXISTS "qr_staff_select_scoped" ON public.qr_staff;
CREATE POLICY "qr_staff_select_scoped"
    ON public.qr_staff FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Admin', 'Manager')
        OR EXISTS (
            SELECT 1
              FROM public.horeca_reps r
             WHERE r.horeca_id = qr_staff.horeca_id
               AND r.rep_id    = (SELECT auth.uid())
        )
        OR (
            NOT (SELECT public.user_is_staff())
            AND horeca_id = (SELECT public.user_horeca_id())
        )
        OR auth_user_id = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "qr_order_requests_select_staff_or_own" ON public.qr_order_requests;
DROP POLICY IF EXISTS "qr_order_requests_select_scoped" ON public.qr_order_requests;
CREATE POLICY "qr_order_requests_select_scoped"
    ON public.qr_order_requests FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Admin', 'Manager')
        OR EXISTS (
            SELECT 1
              FROM public.horeca_reps r
             WHERE r.horeca_id = qr_order_requests.horeca_id
               AND r.rep_id    = (SELECT auth.uid())
        )
        OR (
            NOT (SELECT public.user_is_staff())
            AND horeca_id = (SELECT public.user_horeca_id())
        )
    );

COMMENT ON POLICY "qr_staff_select_scoped" ON public.qr_staff IS
    'Admin/Manager, the venue''s ASSIGNED reps (horeca_reps), the venue itself '
    '(customer-side, via user_horeca_id() so a lapsed QR Staff unlock sees nothing), '
    'or the caller''s own row. Replaces the user_is_staff() arm of 00129 (mig 00130).';
COMMENT ON POLICY "qr_order_requests_select_scoped" ON public.qr_order_requests IS
    'Admin/Manager, the venue''s ASSIGNED reps (horeca_reps), or the venue itself. '
    'An unassigned rep or a Warehouse login sees nothing (mig 00130).';

COMMIT;

-- =============================================================================
-- Verify (service_role / Management API):
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'qr_order_requests_delivery_time_slot_check';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'qr_order_requests' AND column_name = 'staff_name';
--   SELECT policyname FROM pg_policies
--    WHERE tablename IN ('qr_staff','qr_order_requests') ORDER BY 1;
--
-- Rollback: restore the 00129 policies and the ('AM','PM') CHECK (only while no
-- request holds a labelled slot), and drop staff_name.
-- =============================================================================
