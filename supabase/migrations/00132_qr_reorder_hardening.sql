-- =============================================================================
-- HoReCa location QR reorder -- hardening pass on 00129 / 00130
-- Migration: 00132_qr_reorder_hardening.sql
-- =============================================================================
-- 00129 and 00130 are applied and checksummed on dev, so this is an edit
-- forward. (00131 is taken on main by a profiles hotfix that is not yet merged
-- into this branch; the runner applies by filename, so the gap is deliberate.)
-- Three things, each found in review:
--
-- 1. PIN GUESSING (M1). qr_verify_pin() reset the venue's failure counter on
--    EVERY correct unlock. The lock is per CODE (the sticker is public, so the
--    attacker is anonymous), which means one honest cook unlocking between a
--    guesser's attempts zeroed the guesser's progress: an attacker who knew any
--    colleague was about to type their PIN could interleave 4 guesses with each
--    of their unlocks, forever, and the 5/10/15/20 backoff never engaged.
--
--    The counter is now a ROLLING WINDOW. Failures are counted over 24 hours from
--    the first one (qr_codes.failure_window_started_at); a failure after the
--    window has lapsed starts a new window at 1. A success touches NOTHING: it
--    neither resets the counter nor clears a lock (a locked code refuses even
--    the right PIN, as before). Only a human does -- `unlock_code` and
--    `regenerate_code` zero the counter and the window.
--    Thresholds are unchanged: 5 -> 1 min, 10 -> 15 min, 15 -> 1 h, 20 -> locked
--    until a manager unlocks it.
--
-- 2. BANKING DETAILS (M3). 00105 gave `horeca_payment_methods` the shape
--    `staff OR horeca_id = user_horeca_id()`. 00129 made user_horeca_id() return
--    the venue for an unlocked QR Staff login too, so a kitchen phone could read
--    the free-text bank details the venue's Customer login keeps there. The
--    own-venue arm now also requires the caller to BE the venue's Customer
--    login. Same policy name; the staff arm is untouched.
--
-- 3. REVOKED STAFF STAY INVISIBLE TO THE VENUE (E6). The venue arm of
--    qr_staff's SELECT policy returned revoked rows (the client filtered them
--    out, RLS did not). It now requires revoked_at IS NULL. Admin/Manager and the
--    venue's assigned reps still see every row (they audit who was removed), and
--    a login still reads its OWN row, revoked or not, which is how a phone learns
--    its session is over.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The failure window
-- -----------------------------------------------------------------------------
ALTER TABLE public.qr_codes
    ADD COLUMN IF NOT EXISTS failure_window_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.qr_codes.failure_window_started_at IS
    'When the current run of wrong PINs began (mig 00132). failed_attempts counts '
    'failures since then; a failure more than 24 h after it starts a fresh run at 1. '
    'NULL = no run in progress. Set only by qr_verify_pin(); cleared by unlock_code '
    'and regenerate_code, never by a successful unlock.';

-- A counter already running when this ships keeps counting (its window starts now)
-- rather than being forgotten by the first failure that finds no window.
UPDATE public.qr_codes
   SET failure_window_started_at = now()
 WHERE failed_attempts > 0
   AND failure_window_started_at IS NULL;

-- Same signature (TEXT, TEXT) -> JSONB as 00129, so this is a true replacement and
-- not a second overload. Grants are restated below anyway.
--
-- Returns the same four shapes as before:
--   {ok:false, reason:'unknown_code'}
--   {ok:false, reason:'locked',  locked_until, horeca_id}
--   {ok:false, reason:'bad_pin', failed_attempts, locked_until, horeca_id}
--   {ok:true,  staff_id, auth_user_id, horeca_id, name, unlocked_until}
CREATE OR REPLACE FUNCTION public.qr_verify_pin(p_token TEXT, p_pin_hmac TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code    public.qr_codes%ROWTYPE;
    v_staff   public.qr_staff%ROWTYPE;
    v_failed  INT;
    v_window  TIMESTAMPTZ;
    v_locked  TIMESTAMPTZ;
    v_until   TIMESTAMPTZ;
BEGIN
    IF p_token IS NULL OR p_pin_hmac IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
    END IF;

    SELECT * INTO v_code
      FROM public.qr_codes
     WHERE token = p_token
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
    END IF;

    -- A locked code refuses before the PIN is compared and counts nothing, so
    -- waiting cannot be turned into escalation by a third party, and a correct
    -- PIN is refused too -- that is the point of a lock.
    IF v_code.locked_until IS NOT NULL AND v_code.locked_until > now() THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'locked',
            'locked_until', v_code.locked_until,
            'horeca_id', v_code.horeca_id
        );
    END IF;

    SELECT * INTO v_staff
      FROM public.qr_staff
     WHERE horeca_id  = v_code.horeca_id
       AND pin_hmac   = p_pin_hmac
       AND revoked_at IS NULL;

    IF NOT FOUND THEN
        -- Rolling 24 h window: continue the run in progress, or start a new one
        -- at 1 when there is none or it has lapsed.
        IF v_code.failed_attempts <= 0
           OR v_code.failure_window_started_at IS NULL
           OR v_code.failure_window_started_at <= now() - INTERVAL '24 hours' THEN
            v_failed := 1;
            v_window := now();
        ELSE
            v_failed := v_code.failed_attempts + 1;
            v_window := v_code.failure_window_started_at;
        END IF;

        -- Backoff, from the NEW count (so it applies at and after each
        -- threshold, not only when crossing it).
        v_locked := CASE
            WHEN v_failed >= 20 THEN 'infinity'::TIMESTAMPTZ
            WHEN v_failed >= 15 THEN now() + INTERVAL '1 hour'
            WHEN v_failed >= 10 THEN now() + INTERVAL '15 minutes'
            WHEN v_failed >= 5  THEN now() + INTERVAL '1 minute'
            ELSE NULL
        END;

        UPDATE public.qr_codes
           SET failed_attempts           = v_failed,
               failure_window_started_at = v_window,
               locked_until              = v_locked
         WHERE horeca_id = v_code.horeca_id;

        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'bad_pin',
            'failed_attempts', v_failed,
            'locked_until', v_locked,
            'horeca_id', v_code.horeca_id
        );
    END IF;

    -- A correct PIN stamps the unlock and NOTHING ELSE. It must not reset the
    -- failure counter: the counter belongs to the code, not to whoever happened
    -- to type a valid PIN in between a guesser's attempts.
    UPDATE public.qr_staff
       SET unlocked_until   = now() + INTERVAL '2 hours',
           last_unlocked_at = now()
     WHERE id = v_staff.id
    RETURNING unlocked_until INTO v_until;

    RETURN jsonb_build_object(
        'ok', true,
        'staff_id', v_staff.id,
        'auth_user_id', v_staff.auth_user_id,
        'horeca_id', v_staff.horeca_id,
        'name', v_staff.name,
        'unlocked_until', v_until
    );
END;
$$;

REVOKE ALL ON FUNCTION public.qr_verify_pin(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_verify_pin(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.qr_verify_pin(TEXT, TEXT) IS
    'One PIN attempt for a venue QR, under a row lock on qr_codes. A wrong PIN is '
    'counted over a rolling 24 h window and backs off at 5/10/15/20 -> 1 min/15 min/'
    '1 h/locked; a correct one stamps qr_staff.unlocked_until = now()+2h and leaves '
    'the counter and any lock ALONE (mig 00132). service_role only.';

-- -----------------------------------------------------------------------------
-- 2. horeca_payment_methods -- the venue's own CUSTOMER login only
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "horeca_payment_methods_select_staff_or_own" ON public.horeca_payment_methods;
CREATE POLICY "horeca_payment_methods_select_staff_or_own"
    ON public.horeca_payment_methods FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR (
            (SELECT public.user_role()) = 'Restaurant/Hotel Customer'
            AND horeca_id = (SELECT public.user_horeca_id())
        )
    );

COMMENT ON POLICY "horeca_payment_methods_select_staff_or_own" ON public.horeca_payment_methods IS
    'Staff, or the venue''s own Restaurant/Hotel Customer login. Narrowed in 00132: '
    'a QR Staff login also resolves user_horeca_id() to its venue, and `details` is '
    'free-text banking detail a kitchen phone has no use for.';

-- -----------------------------------------------------------------------------
-- 3. qr_staff -- the venue arm no longer lists revoked staff
-- -----------------------------------------------------------------------------
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
            AND revoked_at IS NULL
        )
        OR auth_user_id = (SELECT auth.uid())
    );

COMMENT ON POLICY "qr_staff_select_scoped" ON public.qr_staff IS
    'Admin/Manager and the venue''s ASSIGNED reps (horeca_reps) see every row, '
    'revoked included; the venue itself (customer-side, via user_horeca_id(), so a '
    'lapsed QR Staff unlock sees nothing) sees its ACTIVE staff only; and a login '
    'always reads its own row. (00130, revoked arm added in 00132.)';

COMMIT;

-- =============================================================================
-- Verify (service_role / Management API):
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'qr_codes' AND column_name = 'failure_window_started_at';
--   SELECT pg_get_functiondef('public.qr_verify_pin(text,text)'::regprocedure);
--       -- no UPDATE of failed_attempts = 0 on the success path
--   SELECT policyname, qual FROM pg_policies
--    WHERE tablename IN ('horeca_payment_methods','qr_staff') ORDER BY 1;
--
-- And as a real QR Staff session against PostgREST: horeca_payment_methods
-- returns [] while qr_staff.unlocked_until is in the future, and the venue's
-- Customer login still reads its own rows.
--
-- Rollback: restore the 00129 qr_verify_pin body (counter reset on success), the
-- 00105 payment-methods policy and the 00130 qr_staff policy, and drop
-- qr_codes.failure_window_started_at.
-- =============================================================================
