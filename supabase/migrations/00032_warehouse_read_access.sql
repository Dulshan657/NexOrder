-- =============================================================================
-- Warehouse role — read access for the pick queue
-- Migration: 00032_warehouse_read_access.sql
-- =============================================================================
-- The Warehouse role operates the pick → dispatch flow, so it needs to SELECT
-- the orders it must fulfil, their line items, and the customer (for the
-- delivery destination on pick slips / dispatch advices). It remains a
-- read-only consumer here: all status changes and pick records still route
-- through the update-order-status / record-pick Edge Functions (service_role).
-- products already allow any-authenticated SELECT; inventory tables were granted
-- to Warehouse in 00027.
-- =============================================================================

BEGIN;

CREATE POLICY "orders_select_warehouse"
    ON public.orders FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) = 'Warehouse');

CREATE POLICY "order_items_select_warehouse"
    ON public.order_items FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) = 'Warehouse');

CREATE POLICY "horecas_select_warehouse"
    ON public.horecas FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) = 'Warehouse');

COMMIT;
