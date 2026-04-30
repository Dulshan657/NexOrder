-- Enable Supabase realtime for the tables that drive live UI updates.
-- The supabase_realtime publication exists by default but is empty; tables
-- have to be added explicitly. RLS policies on each table govern which rows
-- a given subscriber actually receives, so admin/manager/customer clients
-- get filtered streams automatically.
--
-- Tables:
--   orders         — new orders + status changes flow live to admin / rep dashboards
--   order_items    — line-item additions/edits propagate alongside their parent order
--   notifications  — live badge count + panel updates (replaces 30s poll)
--   products       — stock/inventory changes update the admin Stock view in real time

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.products;
