-- =============================================================================
-- Nex Order — Initial Schema Migration
-- Migration: 00001_initial_schema.sql
-- =============================================================================
-- Table creation order respects FK dependencies:
--   suppliers → products
--   horecas   → profiles (circular: profiles.horeca_id → horecas.id)
--             → horeca_pricing, horeca_payment_methods, pantry_items
--   profiles  → orders, purchase_orders, promotions, sales_targets,
--               routes, visits, notifications
--   orders    → order_items, invoices
--   purchase_orders → purchase_order_items
--   routes    → visits
-- The profiles ↔ horecas circularity is resolved by adding the FK to
-- profiles.horeca_id as a deferred ALTER TABLE after both tables exist.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE public.suppliers (
    id              SERIAL          PRIMARY KEY,
    name            TEXT            NOT NULL,
    contact_person  TEXT            NOT NULL,
    email           TEXT            NOT NULL,
    phone           TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. products
-- ---------------------------------------------------------------------------
CREATE TABLE public.products (
    id                      SERIAL          PRIMARY KEY,
    sku                     TEXT            NOT NULL UNIQUE,
    name                    TEXT            NOT NULL,
    description             TEXT,
    price                   NUMERIC(10,2)   NOT NULL,
    category                TEXT            NOT NULL
                                CHECK (category IN (
                                    'Coconut','Meal Pastes','Asian Sauces',
                                    'Soy Sauces','Chilli Sauces','Condiments',
                                    'Noodles','Fish','Satay Sauces','Desserts',
                                    'Ready Meal Sauces','Other'
                                )),
    inventory               INT             NOT NULL DEFAULT 0,
    image_url               TEXT,
    unit                    TEXT            NOT NULL,
    carton_size             INT             NOT NULL,
    dietary_labels          TEXT[]          NOT NULL DEFAULT '{}',
    supplier_id             INT             NOT NULL REFERENCES public.suppliers(id),
    cubic_meters_unit       NUMERIC(10,6),
    cubic_meters_carton     NUMERIC(10,6),
    length_cm               NUMERIC(8,2),
    width_cm                NUMERIC(8,2),
    height_cm               NUMERIC(8,2),
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. horecas
-- ---------------------------------------------------------------------------
CREATE TABLE public.horecas (
    id                  SERIAL          PRIMARY KEY,
    name                TEXT            NOT NULL,
    address             TEXT            NOT NULL,
    discount_percent    NUMERIC(5,2)    NOT NULL DEFAULT 0,
    credit_limit        NUMERIC(10,2)   NOT NULL DEFAULT 5000,
    show_stock_tab      BOOLEAN,
    tier                TEXT
                            CHECK (tier IN ('Gold','Silver','Bronze')),
    lat                 NUMERIC(10,6),
    lng                 NUMERIC(10,6),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. profiles  (extends auth.users — no horeca_id FK yet; added below)
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id          UUID            PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT            NOT NULL,
    email       TEXT            NOT NULL,
    role        TEXT            NOT NULL
                    CHECK (role IN (
                        'Admin',
                        'Manager',
                        'Field Sales Rep',
                        'Office Sales Rep',
                        'Restaurant/Hotel Customer'
                    )),
    avatar_url  TEXT,
    horeca_id   INT,            -- FK added after horecas exists (see ALTER below)
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Now that both tables exist, add the FK from profiles → horecas
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_horeca_id_fkey
    FOREIGN KEY (horeca_id)
    REFERENCES public.horecas(id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. horeca_pricing
-- ---------------------------------------------------------------------------
CREATE TABLE public.horeca_pricing (
    id              SERIAL          PRIMARY KEY,
    horeca_id       INT             NOT NULL REFERENCES public.horecas(id) ON DELETE CASCADE,
    product_id      INT             NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    custom_price    NUMERIC(10,2)   NOT NULL,
    UNIQUE (horeca_id, product_id)
);

-- ---------------------------------------------------------------------------
-- 6. horeca_payment_methods
-- ---------------------------------------------------------------------------
CREATE TABLE public.horeca_payment_methods (
    id          SERIAL      PRIMARY KEY,
    horeca_id   INT         NOT NULL REFERENCES public.horecas(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL
                    CHECK (type IN ('Credit Card','Bank Transfer','On Account')),
    details     TEXT        NOT NULL,
    is_default  BOOLEAN     NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- 7. orders
-- ---------------------------------------------------------------------------
CREATE TABLE public.orders (
    id                  TEXT            PRIMARY KEY,     -- e.g. 'ORD-1001'
    horeca_id           INT             NOT NULL REFERENCES public.horecas(id),
    submitted_by        UUID            NOT NULL REFERENCES public.profiles(id),
    total               NUMERIC(12,2)   NOT NULL,
    order_date          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    notes               TEXT,
    status              TEXT            NOT NULL DEFAULT 'processing'
                            CHECK (status IN (
                                'processing','confirmed','packed',
                                'shipped','delivered'
                            )),
    status_history      JSONB           NOT NULL DEFAULT '[]',
    delivery_date       DATE,
    delivery_time_slot  TEXT
                            CHECK (delivery_time_slot IN (
                                'Morning (8am-12pm)',
                                'Afternoon (12pm-4pm)',
                                'Evening (4pm-8pm)'
                            )),
    verification        JSONB,
    applied_promotions  JSONB,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 8. order_items
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_items (
    id              SERIAL          PRIMARY KEY,
    order_id        TEXT            NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id      INT             NOT NULL REFERENCES public.products(id),
    quantity        INT             NOT NULL CHECK (quantity > 0),
    pack_size       INT,            -- null = single unit
    unit_price      NUMERIC(10,2)   NOT NULL,
    product_name    TEXT            NOT NULL,   -- snapshot at order time
    product_sku     TEXT            NOT NULL    -- snapshot at order time
);

-- ---------------------------------------------------------------------------
-- 9. invoices
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoices (
    id              TEXT            PRIMARY KEY,
    order_id        TEXT            NOT NULL REFERENCES public.orders(id),
    horeca_id       INT             NOT NULL REFERENCES public.horecas(id),
    horeca_name     TEXT            NOT NULL,
    amount          NUMERIC(12,2)   NOT NULL,
    due_date        DATE            NOT NULL,
    status          TEXT            NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','overdue')),
    paid_date       DATE,
    created_date    DATE            NOT NULL DEFAULT CURRENT_DATE
);

-- ---------------------------------------------------------------------------
-- 10. purchase_orders
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_orders (
    id              TEXT            PRIMARY KEY,
    supplier_id     INT             NOT NULL REFERENCES public.suppliers(id),
    total           NUMERIC(12,2)   NOT NULL,
    order_date      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    status          TEXT            NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending','Submitted','Completed','Cancelled')),
    submitted_by    UUID            NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 11. purchase_order_items
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_items (
    id                  SERIAL          PRIMARY KEY,
    purchase_order_id   TEXT            NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id          INT             NOT NULL REFERENCES public.products(id),
    product_name        TEXT            NOT NULL,
    quantity            INT             NOT NULL CHECK (quantity > 0),
    cost                NUMERIC(10,2)   NOT NULL
);

-- ---------------------------------------------------------------------------
-- 12. promotions
-- ---------------------------------------------------------------------------
CREATE TABLE public.promotions (
    id                          TEXT            PRIMARY KEY,
    name                        TEXT            NOT NULL,
    description                 TEXT,
    type                        TEXT            NOT NULL
                                    CHECK (type IN (
                                        'percentage','fixed_price','bogo',
                                        'bundle','clearance'
                                    )),
    percent_off                 NUMERIC(5,2),
    fixed_price                 NUMERIC(10,2),
    bogo_config                 JSONB,
    bundle_config               JSONB,
    clearance_percent           NUMERIC(5,2),
    -- scope: {kind:'storewide'} | {kind:'products',productIds:number[]}
    --        | {kind:'categories',categories:string[]}
    scope                       JSONB           NOT NULL,
    -- targeting: {kind:'all'} | {kind:'horecas',hoReCaIds:number[]}
    --            | {kind:'tier',tiers:string[]} | {kind:'rep',repUserId:string}
    targeting                   JSONB           NOT NULL,
    min_order_value             NUMERIC(10,2),
    stack_with_horeca_pricing   BOOLEAN         NOT NULL DEFAULT true,
    start_date                  DATE,
    end_date                    DATE,
    is_active                   BOOLEAN         NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_by                  UUID            NOT NULL REFERENCES public.profiles(id),
    priority                    INT             NOT NULL DEFAULT 10
);

-- ---------------------------------------------------------------------------
-- 13. pantry_items
-- ---------------------------------------------------------------------------
CREATE TABLE public.pantry_items (
    id                  SERIAL  PRIMARY KEY,
    horeca_id           INT     NOT NULL REFERENCES public.horecas(id) ON DELETE CASCADE,
    product_id          INT     NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    preferred_pack_size INT,
    default_quantity    INT     NOT NULL DEFAULT 1,
    UNIQUE (horeca_id, product_id)
);

-- ---------------------------------------------------------------------------
-- 14. sales_targets
-- ---------------------------------------------------------------------------
CREATE TABLE public.sales_targets (
    id              TEXT            PRIMARY KEY,
    user_id         UUID            NOT NULL REFERENCES public.profiles(id),
    type            TEXT            NOT NULL
                        CHECK (type IN ('revenue','orders','new_horecas')),
    target_value    NUMERIC(12,2)   NOT NULL,
    start_date      DATE            NOT NULL,
    end_date        DATE            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 15. routes  (self-referencing: template_id → routes.id)
-- ---------------------------------------------------------------------------
CREATE TABLE public.routes (
    id              TEXT        PRIMARY KEY,
    name            TEXT        NOT NULL,
    date            DATE,                       -- null for templates
    stops           JSONB       NOT NULL DEFAULT '[]',
    status          TEXT        NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','in_progress','completed')),
    created_by      UUID        NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    assigned_to     UUID        REFERENCES public.profiles(id),
    assigned_by     UUID        REFERENCES public.profiles(id),
    assigned_at     TIMESTAMPTZ,
    is_template     BOOLEAN     NOT NULL DEFAULT false,
    template_id     TEXT        REFERENCES public.routes(id),
    recurrence      JSONB,
    change_requests JSONB       NOT NULL DEFAULT '[]'
);

-- ---------------------------------------------------------------------------
-- 16. visits
-- ---------------------------------------------------------------------------
CREATE TABLE public.visits (
    id                          TEXT        PRIMARY KEY,
    horeca_id                   INT         NOT NULL REFERENCES public.horecas(id),
    user_id                     UUID        NOT NULL REFERENCES public.profiles(id),
    route_id                    TEXT        REFERENCES public.routes(id),
    arrival_time                TIMESTAMPTZ NOT NULL,
    departure_time              TIMESTAMPTZ,
    outcome                     TEXT
                                    CHECK (outcome IN (
                                        'order_placed','follow_up_needed',
                                        'not_available','no_interest',
                                        'stock_check_only'
                                    )),
    notes                       TEXT,
    competitor_notes            TEXT,
    stock_check_notes           TEXT,
    next_visit_recommendation   TEXT,
    photos                      TEXT[]      NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 17. notifications
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
    id              TEXT        PRIMARY KEY,
    type            TEXT        NOT NULL,
    message         TEXT        NOT NULL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    read            BOOLEAN     NOT NULL DEFAULT false,
    target_roles    TEXT[],
    metadata        JSONB,
    user_id         UUID        REFERENCES public.profiles(id)
);

-- ---------------------------------------------------------------------------
-- 18. app_settings  (singleton — only row id=1 allowed)
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_settings (
    id                      INT             PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    company_name            TEXT            NOT NULL DEFAULT 'Nex Order',
    company_address         TEXT            NOT NULL DEFAULT '100 Harris St, Pyrmont NSW 2009',
    company_phone           TEXT            NOT NULL DEFAULT '',
    company_email           TEXT            NOT NULL DEFAULT '',
    order_id_prefix         TEXT            NOT NULL DEFAULT 'ORD',
    minimum_order_value     NUMERIC(10,2)   NOT NULL DEFAULT 0,
    default_credit_limit    NUMERIC(10,2)   NOT NULL DEFAULT 5000,
    carton_discount_percent NUMERIC(5,2)    NOT NULL DEFAULT 5,
    low_stock_threshold     INT             NOT NULL DEFAULT 10,
    currency                TEXT            NOT NULL DEFAULT 'AUD',
    show_stock_to_horeca    BOOLEAN         NOT NULL DEFAULT false
);

-- Seed singleton row
INSERT INTO public.app_settings (id) VALUES (1);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- orders
CREATE INDEX idx_orders_horeca_id    ON public.orders(horeca_id);
CREATE INDEX idx_orders_submitted_by ON public.orders(submitted_by);
CREATE INDEX idx_orders_status       ON public.orders(status);

-- order_items
CREATE INDEX idx_order_items_order_id   ON public.order_items(order_id);
CREATE INDEX idx_order_items_product_id ON public.order_items(product_id);

-- invoices
CREATE INDEX idx_invoices_order_id   ON public.invoices(order_id);
CREATE INDEX idx_invoices_horeca_id  ON public.invoices(horeca_id);
CREATE INDEX idx_invoices_status     ON public.invoices(status);

-- routes
CREATE INDEX idx_routes_assigned_to ON public.routes(assigned_to);
CREATE INDEX idx_routes_created_by  ON public.routes(created_by);
CREATE INDEX idx_routes_template_id ON public.routes(template_id);

-- visits
CREATE INDEX idx_visits_user_id   ON public.visits(user_id);
CREATE INDEX idx_visits_horeca_id ON public.visits(horeca_id);
CREATE INDEX idx_visits_route_id  ON public.visits(route_id);

-- horeca_pricing
CREATE INDEX idx_horeca_pricing_horeca_id  ON public.horeca_pricing(horeca_id);
CREATE INDEX idx_horeca_pricing_product_id ON public.horeca_pricing(product_id);

-- products
CREATE INDEX idx_products_supplier_id ON public.products(supplier_id);
CREATE INDEX idx_products_category    ON public.products(category);

-- notifications
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);

-- sales_targets
CREATE INDEX idx_sales_targets_user_id ON public.sales_targets(user_id);

-- purchase_orders
CREATE INDEX idx_purchase_orders_supplier_id  ON public.purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_submitted_by ON public.purchase_orders(submitted_by);

-- purchase_order_items
CREATE INDEX idx_purchase_order_items_purchase_order_id ON public.purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_order_items_product_id        ON public.purchase_order_items(product_id);

-- pantry_items
CREATE INDEX idx_pantry_items_horeca_id  ON public.pantry_items(horeca_id);
CREATE INDEX idx_pantry_items_product_id ON public.pantry_items(product_id);

-- profiles
CREATE INDEX idx_profiles_horeca_id ON public.profiles(horeca_id);
CREATE INDEX idx_profiles_role      ON public.profiles(role);

-- horeca_payment_methods
CREATE INDEX idx_horeca_payment_methods_horeca_id ON public.horeca_payment_methods(horeca_id);

-- promotions
CREATE INDEX idx_promotions_created_by ON public.promotions(created_by);
CREATE INDEX idx_promotions_is_active  ON public.promotions(is_active);

-- =============================================================================
-- RLS HELPER FUNCTIONS
-- =============================================================================
-- Placed in the auth schema so they can be called from RLS policies without
-- granting any additional search_path access to application roles.
-- SECURITY DEFINER + STABLE means Postgres caches the result within a query,
-- preventing per-row function calls from becoming sequential scans.

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT role FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.user_horeca_id()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT horeca_id FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================================

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
ALTER TABLE public.routes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings             ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Every authenticated user can read their own profile row.
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (id = (SELECT auth.uid()));

-- Admins can read all profiles.
CREATE POLICY "profiles_select_admin"
    ON public.profiles FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- Users may update their own profile; Admins may update any.
CREATE POLICY "profiles_update_own_or_admin"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR (SELECT public.user_role()) = 'Admin'
    )
    WITH CHECK (
        id = (SELECT auth.uid())
        OR (SELECT public.user_role()) = 'Admin'
    );

-- INSERT is handled exclusively via the auth trigger (see below).
-- No application-level INSERT policy is granted.

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
CREATE POLICY "suppliers_select_authenticated"
    ON public.suppliers FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "suppliers_insert_admin_manager"
    ON public.suppliers FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "suppliers_update_admin_manager"
    ON public.suppliers FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "suppliers_delete_admin_manager"
    ON public.suppliers FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE POLICY "products_select_authenticated"
    ON public.products FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "products_insert_admin_manager"
    ON public.products FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "products_update_admin_manager"
    ON public.products FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "products_delete_admin_manager"
    ON public.products FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- horecas
-- ---------------------------------------------------------------------------
-- Admin/Manager/Field Sales Rep/Office Sales Rep: all rows.
-- Customer: only their own horeca.
CREATE POLICY "horecas_select_staff"
    ON public.horecas FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Admin','Manager','Field Sales Rep','Office Sales Rep')
    );

CREATE POLICY "horecas_select_customer"
    ON public.horecas FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) = 'Restaurant/Hotel Customer'
        AND id = (SELECT public.user_horeca_id())
    );

CREATE POLICY "horecas_insert_admin_manager"
    ON public.horecas FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "horecas_update_admin_manager"
    ON public.horecas FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "horecas_delete_admin_manager"
    ON public.horecas FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- horeca_pricing
-- ---------------------------------------------------------------------------
CREATE POLICY "horeca_pricing_select_authenticated"
    ON public.horeca_pricing FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "horeca_pricing_insert_admin_manager"
    ON public.horeca_pricing FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "horeca_pricing_update_admin_manager"
    ON public.horeca_pricing FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "horeca_pricing_delete_admin_manager"
    ON public.horeca_pricing FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- horeca_payment_methods
-- ---------------------------------------------------------------------------
CREATE POLICY "horeca_payment_methods_select_authenticated"
    ON public.horeca_payment_methods FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "horeca_payment_methods_insert_admin_manager"
    ON public.horeca_payment_methods FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "horeca_payment_methods_update_admin_manager"
    ON public.horeca_payment_methods FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "horeca_payment_methods_delete_admin_manager"
    ON public.horeca_payment_methods FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
-- SELECT: Admin/Manager see all; Rep sees own submitted; Customer sees own horeca.
CREATE POLICY "orders_select_admin_manager"
    ON public.orders FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "orders_select_rep"
    ON public.orders FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Field Sales Rep','Office Sales Rep')
        AND submitted_by = (SELECT auth.uid())
    );

CREATE POLICY "orders_select_customer"
    ON public.orders FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) = 'Restaurant/Hotel Customer'
        AND horeca_id = (SELECT public.user_horeca_id())
    );

-- INSERT: any authenticated user may create an order they own.
CREATE POLICY "orders_insert_authenticated"
    ON public.orders FOR INSERT
    TO authenticated
    WITH CHECK (submitted_by = (SELECT auth.uid()));

-- UPDATE: Admin/Manager only (status transitions, verification, etc.).
CREATE POLICY "orders_update_admin_manager"
    ON public.orders FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

-- DELETE: Admin only.
CREATE POLICY "orders_delete_admin"
    ON public.orders FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
-- Access mirrors orders — checked through the related order.

CREATE POLICY "order_items_select_admin_manager"
    ON public.order_items FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "order_items_select_rep"
    ON public.order_items FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Field Sales Rep','Office Sales Rep')
        AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
              AND o.submitted_by = (SELECT auth.uid())
        )
    );

CREATE POLICY "order_items_select_customer"
    ON public.order_items FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) = 'Restaurant/Hotel Customer'
        AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
              AND o.horeca_id = (SELECT public.user_horeca_id())
        )
    );

-- INSERT: authenticated users may insert items for orders they own.
CREATE POLICY "order_items_insert_authenticated"
    ON public.order_items FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
              AND o.submitted_by = (SELECT auth.uid())
        )
    );

-- UPDATE/DELETE: Admin/Manager only.
CREATE POLICY "order_items_update_admin_manager"
    ON public.order_items FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "order_items_delete_admin_manager"
    ON public.order_items FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
CREATE POLICY "invoices_select_admin_manager"
    ON public.invoices FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "invoices_select_customer"
    ON public.invoices FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) = 'Restaurant/Hotel Customer'
        AND horeca_id = (SELECT public.user_horeca_id())
    );

CREATE POLICY "invoices_insert_admin_manager"
    ON public.invoices FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "invoices_update_admin_manager"
    ON public.invoices FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "invoices_delete_admin"
    ON public.invoices FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- purchase_orders
-- ---------------------------------------------------------------------------
CREATE POLICY "purchase_orders_select_authenticated"
    ON public.purchase_orders FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "purchase_orders_insert_admin_manager"
    ON public.purchase_orders FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "purchase_orders_update_admin_manager"
    ON public.purchase_orders FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "purchase_orders_delete_admin"
    ON public.purchase_orders FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- purchase_order_items
-- ---------------------------------------------------------------------------
CREATE POLICY "purchase_order_items_select_admin_manager"
    ON public.purchase_order_items FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "purchase_order_items_insert_admin_manager"
    ON public.purchase_order_items FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "purchase_order_items_update_admin_manager"
    ON public.purchase_order_items FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "purchase_order_items_delete_admin"
    ON public.purchase_order_items FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- promotions
-- ---------------------------------------------------------------------------
CREATE POLICY "promotions_select_authenticated"
    ON public.promotions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "promotions_insert_admin"
    ON public.promotions FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) = 'Admin');

CREATE POLICY "promotions_update_admin"
    ON public.promotions FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin')
    WITH CHECK ((SELECT public.user_role()) = 'Admin');

CREATE POLICY "promotions_delete_admin"
    ON public.promotions FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- pantry_items
-- ---------------------------------------------------------------------------
CREATE POLICY "pantry_items_select_authenticated"
    ON public.pantry_items FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "pantry_items_insert_admin_manager"
    ON public.pantry_items FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "pantry_items_update_admin_manager"
    ON public.pantry_items FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "pantry_items_delete_admin_manager"
    ON public.pantry_items FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- sales_targets
-- ---------------------------------------------------------------------------
CREATE POLICY "sales_targets_select_admin_manager"
    ON public.sales_targets FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- Reps can see their own targets.
CREATE POLICY "sales_targets_select_own"
    ON public.sales_targets FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY "sales_targets_insert_admin_manager"
    ON public.sales_targets FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "sales_targets_update_admin_manager"
    ON public.sales_targets FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "sales_targets_delete_admin"
    ON public.sales_targets FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------
-- SELECT: Admin/Manager see all; Rep sees routes they created or are assigned to.
CREATE POLICY "routes_select_admin_manager"
    ON public.routes FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "routes_select_rep"
    ON public.routes FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Field Sales Rep','Office Sales Rep')
        AND (
            created_by = (SELECT auth.uid())
            OR assigned_to = (SELECT auth.uid())
        )
    );

-- INSERT: Admin, Manager, or Field/Office Sales Rep.
CREATE POLICY "routes_insert_staff"
    ON public.routes FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.user_role()) IN ('Admin','Manager','Field Sales Rep','Office Sales Rep')
    );

-- UPDATE: creator, assignee, or Admin/Manager.
CREATE POLICY "routes_update_creator_assignee_admin_manager"
    ON public.routes FOR UPDATE
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Admin','Manager')
        OR created_by = (SELECT auth.uid())
        OR assigned_to = (SELECT auth.uid())
    )
    WITH CHECK (
        (SELECT public.user_role()) IN ('Admin','Manager')
        OR created_by = (SELECT auth.uid())
        OR assigned_to = (SELECT auth.uid())
    );

-- DELETE: Admin only.
CREATE POLICY "routes_delete_admin"
    ON public.routes FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- visits
-- ---------------------------------------------------------------------------
CREATE POLICY "visits_select_admin_manager"
    ON public.visits FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "visits_select_rep"
    ON public.visits FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Field Sales Rep','Office Sales Rep')
        AND user_id = (SELECT auth.uid())
    );

CREATE POLICY "visits_insert_staff"
    ON public.visits FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.user_role()) IN ('Admin','Manager','Field Sales Rep','Office Sales Rep')
    );

CREATE POLICY "visits_update_own_or_admin_manager"
    ON public.visits FOR UPDATE
    TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR (SELECT public.user_role()) IN ('Admin','Manager')
    )
    WITH CHECK (
        user_id = (SELECT auth.uid())
        OR (SELECT public.user_role()) IN ('Admin','Manager')
    );

CREATE POLICY "visits_delete_admin"
    ON public.visits FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
-- A notification is visible if it is addressed to the current user directly,
-- or if it is a broadcast (user_id IS NULL) and the user's role is in target_roles.
CREATE POLICY "notifications_select_targeted"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR (
            user_id IS NULL
            AND (SELECT public.user_role()) = ANY(target_roles)
        )
    );

CREATE POLICY "notifications_insert_admin_manager"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

-- Allow users to mark their own notifications as read.
CREATE POLICY "notifications_update_own"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- Admin/Manager can update any notification (e.g. bulk mark-read, corrections).
CREATE POLICY "notifications_update_admin_manager"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "notifications_delete_admin"
    ON public.notifications FOR DELETE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- ---------------------------------------------------------------------------
-- app_settings  (singleton)
-- ---------------------------------------------------------------------------
CREATE POLICY "app_settings_select_authenticated"
    ON public.app_settings FOR SELECT
    TO authenticated
    USING (true);

-- Only Admins may change global settings.
CREATE POLICY "app_settings_update_admin"
    ON public.app_settings FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin')
    WITH CHECK ((SELECT public.user_role()) = 'Admin');

-- Nobody inserts/deletes — the singleton row was seeded in the migration.
-- (No INSERT or DELETE policies are created intentionally.)

-- =============================================================================
-- AUTH TRIGGER — auto-create profile on sign-up
-- =============================================================================
-- The trigger function runs with SECURITY DEFINER so it can INSERT into
-- public.profiles even though the new user has no session yet.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role', 'Restaurant/Hotel Customer')
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- GRANT minimal privileges to the Supabase anon / authenticated roles
-- =============================================================================
-- Supabase's default configuration grants USAGE on public schema to both
-- anon and authenticated. The statements below are additive guards; RLS
-- policies are the authoritative access control layer.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- authenticated: SELECT/INSERT/UPDATE/DELETE on all application tables
-- (RLS policies further restrict what rows are accessible).
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.profiles,
    public.suppliers,
    public.products,
    public.horecas,
    public.horeca_pricing,
    public.horeca_payment_methods,
    public.orders,
    public.order_items,
    public.invoices,
    public.purchase_orders,
    public.purchase_order_items,
    public.promotions,
    public.pantry_items,
    public.sales_targets,
    public.routes,
    public.visits,
    public.notifications,
    public.app_settings
TO authenticated;

-- Sequence usage for SERIAL columns
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- anon role: no table access (login flow only; all data is behind RLS)
-- No additional grants needed for anon beyond schema USAGE.

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
