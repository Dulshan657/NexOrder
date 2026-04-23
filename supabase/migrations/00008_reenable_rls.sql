-- Re-enable row level security on every table that 00002 disabled.
-- Auth is now wired (AuthGate + LoginPage), so `auth.uid()` is populated
-- for all requests and the existing policies from 00001 / 00003 (plus the
-- new profiles_select_staff from 00007) gate access correctly.
--
-- Note: 00003 renamed `routes` -> `scheduled_visits`, so this lists the
-- new name.

ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horecas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horeca_pricing           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horeca_payment_methods   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantry_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_targets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_visits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings             ENABLE ROW LEVEL SECURITY;
