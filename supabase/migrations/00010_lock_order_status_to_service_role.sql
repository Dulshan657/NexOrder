-- Lock down direct UPDATE on orders to the service role only.
-- After this migration, status changes (including verification, notes,
-- delivery slot edits) must go through the update-order-status Edge
-- Function, which validates the role, the transition direction, and
-- appends to status_history with the actor.

DROP POLICY IF EXISTS "orders_update_admin_manager" ON public.orders;
DROP POLICY IF EXISTS "orders_update_admin" ON public.orders;

COMMENT ON COLUMN public.orders.status IS
  'Updateable only by service role (update-order-status Edge Function). Direct UPDATE is denied.';
