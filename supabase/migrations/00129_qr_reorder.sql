-- =============================================================================
-- HoReCa location QR reorder -- schema, the 2-hour unlock gate, PIN verifier
-- Migration: 00129_qr_reorder.sql
-- =============================================================================
-- Plan: docs/claude/qr-reorder-plan.md. A printed QR identifies a VENUE (a
-- HoReCa) and nothing more; each kitchen staff member unlocks it with their own
-- PIN, and every order they place is held for approval before it reaches the
-- distributor. This file is the whole database half. It is additive: the new
-- tables are locked at creation, and the policy rewrites only WIDEN a Customer
-- predicate to a role nobody holds yet, so nothing observable changes until
-- the qr-* Edge Functions exist and mint the first QR Staff login.
--
-- -- WHO IS "QR STAFF" ------------------------------------------------------
--
-- One hidden Supabase auth user per staff member, with profiles.role =
-- 'QR Staff' and the venue's horeca_id. It is deliberately NOT one of the five
-- roles in user_is_staff() and NOT 'Restaurant/Hotel Customer', so every Edge
-- Function with a role allow-list (place-order, invite-user, mutate-profile, ...)
-- rejects it by default. The failure mode of forgetting a role here is a
-- refusal, not a leak.
--
-- Probed on dev before writing this: GoTrue accepts qr-<uuid>@qr.nexorder.invalid
-- as an email, admin.generateLink({type:'magiclink'}) sends nothing and returns
-- a hashed_token, and anon verifyOtp({token_hash, type:'magiclink'}) mints a
-- real session. A banned user can neither refresh nor verify a new link.
--
-- -- THE 2-HOUR WINDOW LIVES HERE, NOT IN THE JWT ---------------------------
--
-- A Supabase access token lasts an hour and its refresh token lasts until the
-- session is deleted, so "unlocked for 2 hours" cannot be a JWT property.
-- It is qr_staff.unlocked_until, and user_horeca_id() -- the function every
-- own-venue RLS policy and every realtime subscription is built out of --
-- returns NULL for a QR Staff user without a live, unrevoked unlock.
-- `horeca_id = NULL` is NULL, so at expiry the whole of orders, order_items,
-- horecas, addresses, pricing, pantry and qr_order_requests go dark at once,
-- whatever tokens the phone is still holding. The client timer that signs the
-- phone out is a convenience; this is the control.
--
-- user_horeca_id() also insists that qr_staff.horeca_id equals profiles.horeca_id.
-- The two are written together by the same Edge Function, but they are two
-- copies of one fact and nothing else keeps them agreeing; if they ever drift
-- the answer is NULL (closed), not whichever copy a caller happened to read.
--
-- -- WHY A SEPARATE qr_order_requests TABLE ---------------------------------
--
-- A pending QR order is not an order. Putting it in `orders` behind a new
-- status would put it in reports, the pick queue, invoicing, credit checks and
-- the STATUS_ORDER.indexOf ladder (where an unknown status compares as BEFORE
-- everything). A request is held until a human approves it; approval replays
-- it through the real place-order logic, so pricing, promotions, credit and
-- reservation happen exactly once, at that moment. Same shape as
-- pending_pos -> approve-po. Lines are stored as JSONB so a submit is one
-- INSERT with no half-written state.
--
-- -- WHY qr_codes AND qr_staff.pin_hmac HAVE NO CLIENT GRANT AT ALL ---------
--
-- qr_codes.token is the only thing standing between a stranger and a venue's
-- PIN pad: readable, it would be a directory of every venue's entry URL.
-- pin_hmac is HMAC-SHA256(QR_PIN_PEPPER, horeca_id || ':' || pin); a 4-6 digit
-- PIN has at most a million values, so the pepper is the only secret in the
-- scheme and the hash must never leave the server. qr_codes therefore has RLS
-- on and no policy plus no grant, and qr_staff is readable by COLUMN only
-- (never pin_hmac, never auth_user_id). A client must name its columns:
-- `select=*` on qr_staff is refused, which is the intended behaviour.
--
-- This project carries ALTER DEFAULT PRIVILEGES for anon / authenticated /
-- service_role on new objects in `public` (00101, 00102), TRUNCATE included, so
-- every new table here starts with full privileges for both client roles.
-- Section 3 takes them back. RLS cannot constrain TRUNCATE, which is why the
-- REVOKE is not optional.
--
-- -- WHAT THE TWO RPCs ARE FOR -----------------------------------------------
--
-- qr_verify_pin does the whole attempt in one transaction under a row lock on
-- the venue's qr_codes row: look up the PIN, count the failure, apply the
-- backoff, stamp the unlock. supabase-js has no client transactions, and a
-- read-then-write counter in an Edge Function would let a burst of parallel
-- guesses all read the same failed_attempts. qr_end_sessions deletes a user's
-- auth.sessions (auth.refresh_tokens cascades), which is what makes revoking a
-- staff member or regenerating a code take effect on a phone that is mid-session.
-- Both are service_role only.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The new role
-- -----------------------------------------------------------------------------
-- Same DROP + ADD as 00027, with 'QR Staff' appended. Verified on dev that this
-- is the only CHECK in public naming a role, and that handle_new_user() (which
-- copies raw_user_meta_data->>'role' into profiles) needs no change: it was
-- failing on 'QR Staff' only because of this constraint.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN (
        'Admin',
        'Manager',
        'Field Sales Rep',
        'Office Sales Rep',
        'Restaurant/Hotel Customer',
        'Warehouse',
        'QR Staff'
    ));

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- 2a. qr_codes -- one opaque token per venue. Regenerating replaces the token
-- (old sticker dies, PINs survive). The attempt counters live here, per venue,
-- because the sticker is public: lock-out is a property of the code, not of
-- any one staff member.
CREATE TABLE public.qr_codes (
    horeca_id       INT             PRIMARY KEY
                        REFERENCES public.horecas(id) ON DELETE CASCADE,
    token           TEXT            NOT NULL UNIQUE
                        CHECK (char_length(token) >= 32),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    rotated_at      TIMESTAMPTZ,
    failed_attempts INT             NOT NULL DEFAULT 0
                        CHECK (failed_attempts >= 0),
    locked_until    TIMESTAMPTZ
);

COMMENT ON TABLE public.qr_codes IS
    'One opaque QR token per HoReCa (mig 00129). NO client grant and NO RLS '
    'policy: the token is the entry URL, so it is readable by service_role only. '
    'failed_attempts/locked_until are the per-venue PIN backoff, mutated only by '
    'qr_verify_pin() under a row lock.';

-- 2b. qr_staff -- one row per kitchen staff member, each backed by a hidden auth
-- user. Rows are never deleted by the app: revoking sets revoked_at, bans the
-- auth user and deletes its sessions, so orders submitted by that user keep a
-- resolvable name.
CREATE TABLE public.qr_staff (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    horeca_id         INT           NOT NULL
                          REFERENCES public.horecas(id) ON DELETE CASCADE,
    auth_user_id      UUID          NOT NULL UNIQUE
                          REFERENCES auth.users(id) ON DELETE CASCADE,
    name              TEXT          NOT NULL
                          CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    pin_hmac          TEXT          NOT NULL,
    unlocked_until    TIMESTAMPTZ,
    last_unlocked_at  TIMESTAMPTZ,
    created_by        UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    revoked_at        TIMESTAMPTZ,
    revoked_by        UUID          REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- A PIN is unique within a venue among ACTIVE staff; revoking frees it.
CREATE UNIQUE INDEX qr_staff_horeca_pin_active_uq
    ON public.qr_staff (horeca_id, pin_hmac)
    WHERE revoked_at IS NULL;

CREATE INDEX qr_staff_horeca_idx ON public.qr_staff (horeca_id);

COMMENT ON TABLE public.qr_staff IS
    'Kitchen staff behind a venue QR (mig 00129). Readable by column only -- '
    'never pin_hmac or auth_user_id. unlocked_until is the 2-hour gate that '
    'user_horeca_id() enforces for every own-venue RLS policy.';
COMMENT ON COLUMN public.qr_staff.pin_hmac IS
    'HMAC-SHA256(QR_PIN_PEPPER, horeca_id:pin). Never granted to a client role. '
    'Rotating the pepper invalidates every PIN.';
COMMENT ON COLUMN public.qr_staff.unlocked_until IS
    'NULL or past = locked. Set to now()+2h by qr_verify_pin(); cleared by '
    'revoke / regenerate. Read by user_horeca_id().';

-- 2c. qr_order_requests -- the held order. Never joined into reports, the pick
-- queue or invoicing; approval creates the real order and links it back.
CREATE TABLE public.qr_order_requests (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    horeca_id           INT           NOT NULL
                            REFERENCES public.horecas(id) ON DELETE CASCADE,
    requested_by        UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    qr_staff_id         UUID          REFERENCES public.qr_staff(id) ON DELETE SET NULL,
    status              TEXT          NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approving','approved','rejected','cancelled')),
    -- PlaceOrderItem[] exactly as place-order takes them (productId, quantity,
    -- packSize, uomId). Priced at APPROVAL, never here.
    items               JSONB         NOT NULL
                            CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
    notes               TEXT,
    delivery_date       DATE,
    delivery_time_slot  TEXT          CHECK (delivery_time_slot IN ('AM','PM')),
    delivery_address    JSONB,
    verification        JSONB,
    -- An ESTIMATE shown to the requester; the authoritative total is computed
    -- when the order is placed.
    quoted_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    claimed_at          TIMESTAMPTZ,
    decided_at          TIMESTAMPTZ,
    decided_by          UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    decision_reason     TEXT,
    last_error          TEXT,
    edited_by_approver  BOOLEAN       NOT NULL DEFAULT false,
    approved_order_id   TEXT          UNIQUE
                            REFERENCES public.orders(id) ON DELETE SET NULL,
    CONSTRAINT qr_order_requests_approved_has_order
        CHECK (status <> 'approved' OR approved_order_id IS NOT NULL)
);

CREATE INDEX qr_order_requests_horeca_status_idx
    ON public.qr_order_requests (horeca_id, status, created_at DESC);
CREATE INDEX qr_order_requests_pending_idx
    ON public.qr_order_requests (created_at)
    WHERE status = 'pending';
CREATE INDEX qr_order_requests_requested_by_idx
    ON public.qr_order_requests (requested_by);
CREATE INDEX qr_order_requests_staff_idx
    ON public.qr_order_requests (qr_staff_id);

COMMENT ON TABLE public.qr_order_requests IS
    'A QR-placed order held for approval (mig 00129). Not an order: it is not in '
    'reports, the pick queue or invoicing, and reserves no stock. Approval claims '
    'it (pending -> approving, race-safe), runs the place-order core, and links '
    'approved_order_id. Direct INSERT/UPDATE/DELETE denied to all client roles; '
    'written by qr-order-request as service_role.';

-- 2d. horeca_reps -- which reps look after which venue. Only assigned reps
-- approve QR orders and manage PINs for it. Managed through mutate-horeca.
CREATE TABLE public.horeca_reps (
    horeca_id   INT           NOT NULL
                    REFERENCES public.horecas(id) ON DELETE CASCADE,
    rep_id      UUID          NOT NULL
                    REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by  UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    PRIMARY KEY (horeca_id, rep_id)
);

CREATE INDEX horeca_reps_rep_idx ON public.horeca_reps (rep_id);

COMMENT ON TABLE public.horeca_reps IS
    'Reps assigned to a HoReCa (mig 00129). Decides who may approve QR orders '
    'and manage PINs for that venue. Written by mutate-horeca (Admin, Manager).';

-- -----------------------------------------------------------------------------
-- 3. Grants -- take back what the default privileges handed out, then give the
--    minimum. REVOKE ALL on a table also removes any column-level grants, so
--    the order matters: revoke first, then grant the columns.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.qr_codes          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qr_staff          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qr_order_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.horeca_reps       FROM PUBLIC, anon, authenticated;

-- qr_codes: nothing. Not even SELECT.

-- qr_staff: by column. pin_hmac and auth_user_id are deliberately absent.
GRANT SELECT (id, horeca_id, name, unlocked_until, last_unlocked_at, created_at, revoked_at)
    ON public.qr_staff TO authenticated;

-- RLS narrows these to staff / the caller's own venue (section 5).
GRANT SELECT ON public.qr_order_requests TO authenticated;
GRANT SELECT ON public.horeca_reps       TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.qr_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_staff          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horeca_reps       ENABLE ROW LEVEL SECURITY;

-- qr_codes: deliberately no policy. With RLS on, that is deny-all for every
-- role that does not bypass it (service_role does).

-- qr_staff: staff see all; a customer-side user sees their own venue's staff
-- (names and unlock times only -- the column grant hides the rest); and a QR
-- Staff user whose unlock has lapsed can still read their OWN row, which is
-- how the client learns it must show the PIN pad again.
CREATE POLICY "qr_staff_select_staff_or_own"
    ON public.qr_staff FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR (
            NOT (SELECT public.user_is_staff())
            AND horeca_id = (SELECT public.user_horeca_id())
        )
        OR auth_user_id = (SELECT auth.uid())
    );

CREATE POLICY "qr_order_requests_select_staff_or_own"
    ON public.qr_order_requests FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR (
            NOT (SELECT public.user_is_staff())
            AND horeca_id = (SELECT public.user_horeca_id())
        )
    );

-- horeca_reps: internal. Customers never need to know which rep is assigned
-- through this table.
CREATE POLICY "horeca_reps_select_staff"
    ON public.horeca_reps FOR SELECT
    TO authenticated
    USING ((SELECT public.user_is_staff()));

-- -----------------------------------------------------------------------------
-- 5. user_horeca_id() -- the unlock gate
-- -----------------------------------------------------------------------------
-- Same signature, return type, volatility, SECURITY DEFINER and pinned
-- search_path as 00001 + 00104, so this is a true replacement (not a second
-- overload) and every existing grant and policy reference is untouched.
-- STABLE, and every policy wraps the call in (SELECT ...), so it still runs
-- once per query rather than once per row. For every role except QR Staff the
-- added predicate short-circuits on `p.role <> 'QR Staff'` and costs nothing.
CREATE OR REPLACE FUNCTION public.user_horeca_id()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT p.horeca_id
      FROM public.profiles p
     WHERE p.id = (SELECT auth.uid())
       AND (
            p.role <> 'QR Staff'
            OR EXISTS (
                SELECT 1
                  FROM public.qr_staff s
                 WHERE s.auth_user_id = p.id
                   AND s.horeca_id    = p.horeca_id
                   AND s.revoked_at   IS NULL
                   AND s.unlocked_until > now()
            )
       );
$$;

COMMENT ON FUNCTION public.user_horeca_id() IS
    'The caller''s HoReCa, or NULL. For a QR Staff user it is NULL unless an '
    'unrevoked qr_staff row for them has unlocked_until in the future (mig 00129), '
    'so every own-venue policy and realtime subscription goes dark at expiry '
    'regardless of the JWT or refresh token still held.';

-- -----------------------------------------------------------------------------
-- 6. The four Customer-literal SELECT policies
-- -----------------------------------------------------------------------------
-- Each read `user_role() = 'Restaurant/Hotel Customer' AND <col> = user_horeca_id()`,
-- which would exclude QR Staff by name. Rewritten to the 00105 shape: not staff,
-- and the venue column equals user_horeca_id(). Policy names are kept so
-- nothing that refers to them has to change. A NULL or unknown role still
-- resolves to "not staff" with a NULL venue, so unknown fails closed.
--
-- invoices_select_customer is NOT rewritten: kitchen staff do not see invoices.
DROP POLICY IF EXISTS "horecas_select_customer" ON public.horecas;
CREATE POLICY "horecas_select_customer"
    ON public.horecas FOR SELECT
    TO authenticated
    USING (
        NOT (SELECT public.user_is_staff())
        AND id = (SELECT public.user_horeca_id())
    );

DROP POLICY IF EXISTS "orders_select_customer" ON public.orders;
CREATE POLICY "orders_select_customer"
    ON public.orders FOR SELECT
    TO authenticated
    USING (
        NOT (SELECT public.user_is_staff())
        AND horeca_id = (SELECT public.user_horeca_id())
    );

DROP POLICY IF EXISTS "order_items_select_customer" ON public.order_items;
CREATE POLICY "order_items_select_customer"
    ON public.order_items FOR SELECT
    TO authenticated
    USING (
        NOT (SELECT public.user_is_staff())
        AND EXISTS (
            SELECT 1 FROM public.orders o
             WHERE o.id = order_items.order_id
               AND o.horeca_id = (SELECT public.user_horeca_id())
        )
    );

DROP POLICY IF EXISTS "horeca_addresses_select_customer" ON public.horeca_addresses;
CREATE POLICY "horeca_addresses_select_customer"
    ON public.horeca_addresses FOR SELECT
    TO authenticated
    USING (
        NOT (SELECT public.user_is_staff())
        AND horeca_id = (SELECT public.user_horeca_id())
    );

COMMENT ON POLICY "orders_select_customer" ON public.orders IS
    'Not staff AND own venue (user_horeca_id()). Covers Restaurant/Hotel Customer '
    'and QR Staff; a QR Staff user sees nothing once their unlock lapses (00129).';

-- -----------------------------------------------------------------------------
-- 7. RPCs -- service_role only
-- -----------------------------------------------------------------------------

-- qr_verify_pin: one attempt, one transaction, one row lock.
--
-- Returns jsonb, always, never raises for an ordinary miss:
--   {ok:false, reason:'unknown_code'}
--   {ok:false, reason:'locked',  locked_until, horeca_id}
--   {ok:false, reason:'bad_pin', failed_attempts, locked_until, horeca_id}
--   {ok:true,  staff_id, auth_user_id, horeca_id, name, unlocked_until}
--
-- p_pin_hmac is computed by the caller over horeca_id:pin, so the caller must
-- resolve token -> horeca_id first; if the code is regenerated in between, this
-- answers unknown_code and nothing is counted.
--
-- Backoff, from the NEW failure count (so it applies at and after each
-- threshold, not only when crossing it):
--   >= 20  locked until reset ('infinity')
--   >= 15  1 hour
--   >= 10  15 minutes
--   >= 5   1 minute
-- Attempts made WHILE locked are refused before the PIN is even compared and
-- are not counted, so waiting cannot be turned into escalation by a third
-- party. A correct PIN while locked is refused too -- that is the point of a lock.
-- The counters reset only on a successful unlock or an explicit unlock/regenerate.
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
        v_failed := v_code.failed_attempts + 1;
        v_locked := CASE
            WHEN v_failed >= 20 THEN 'infinity'::TIMESTAMPTZ
            WHEN v_failed >= 15 THEN now() + INTERVAL '1 hour'
            WHEN v_failed >= 10 THEN now() + INTERVAL '15 minutes'
            WHEN v_failed >= 5  THEN now() + INTERVAL '1 minute'
            ELSE NULL
        END;

        UPDATE public.qr_codes
           SET failed_attempts = v_failed,
               locked_until    = v_locked
         WHERE horeca_id = v_code.horeca_id;

        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'bad_pin',
            'failed_attempts', v_failed,
            'locked_until', v_locked,
            'horeca_id', v_code.horeca_id
        );
    END IF;

    UPDATE public.qr_staff
       SET unlocked_until   = now() + INTERVAL '2 hours',
           last_unlocked_at = now()
     WHERE id = v_staff.id
    RETURNING unlocked_until INTO v_until;

    IF v_code.failed_attempts <> 0 OR v_code.locked_until IS NOT NULL THEN
        UPDATE public.qr_codes
           SET failed_attempts = 0,
               locked_until    = NULL
         WHERE horeca_id = v_code.horeca_id;
    END IF;

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

-- qr_end_sessions: kill every session (and, by cascade, every refresh token)
-- of one auth user. The Edge Function bans the user as well; the ban stops a
-- new session, this stops the one already on the phone.
CREATE OR REPLACE FUNCTION public.qr_end_sessions(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_user IS NULL THEN
        RETURN;
    END IF;
    -- auth.refresh_tokens.session_id and auth.mfa_amr_claims.session_id both
    -- reference auth.sessions ON DELETE CASCADE (verified on dev).
    DELETE FROM auth.sessions WHERE user_id = p_user;
END;
$$;

REVOKE ALL ON FUNCTION public.qr_verify_pin(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_verify_pin(TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.qr_end_sessions(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_end_sessions(UUID) TO service_role;

COMMENT ON FUNCTION public.qr_verify_pin(TEXT, TEXT) IS
    'One PIN attempt for a venue QR, under a row lock on qr_codes: counts the '
    'failure and applies the backoff (5/10/15/20 -> 1 min/15 min/1 h/locked), or '
    'stamps qr_staff.unlocked_until = now()+2h and resets the counters. '
    'service_role only (mig 00129).';
COMMENT ON FUNCTION public.qr_end_sessions(UUID) IS
    'Delete every auth session (refresh tokens cascade) of one user. Used when '
    'revoking QR staff or regenerating a code. service_role only (mig 00129).';

-- -----------------------------------------------------------------------------
-- 8. Realtime -- approvers watch the queue live, and a requester sees the
--    decision. RLS (section 4) decides which rows each subscriber is sent, and
--    user_horeca_id() makes that follow the unlock window.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname    = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename  = 'qr_order_requests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_order_requests;
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify (service_role / Management API):
--
--   SELECT has_table_privilege('authenticated','public.qr_codes','SELECT');       -- false
--   SELECT has_table_privilege('anon','public.qr_codes','SELECT');                -- false
--   SELECT has_column_privilege('authenticated','public.qr_staff','pin_hmac','SELECT');     -- false
--   SELECT has_column_privilege('authenticated','public.qr_staff','auth_user_id','SELECT'); -- false
--   SELECT has_column_privilege('authenticated','public.qr_staff','name','SELECT');         -- true
--   SELECT has_function_privilege('authenticated','public.qr_verify_pin(text,text)','EXECUTE'); -- false
--   SELECT has_function_privilege('service_role','public.qr_verify_pin(text,text)','EXECUTE');  -- true
--
-- And as a real QR Staff session against PostgREST: orders / horecas / order_items
-- / horeca_addresses return only the venue while qr_staff.unlocked_until is in
-- the future, and nothing after it; invoices returns nothing at any time.
--
-- Rollback (do not once a QR Staff login exists -- it would lose its role):
--   restore the 00001/00021 policies and user_horeca_id() body, drop the four
--   tables and the two functions, re-add profiles_role_check without 'QR Staff'.
-- =============================================================================
