-- 00043_featured_products.sql
-- Adds a `featured` flag so demo/hero products can be pinned to the top of the
-- shop (see hooks/useOrderingState.ts), and extends the products.category CHECK
-- to allow the V2food "Plant-Based" range.
--
-- Apply (this Windows box can't reach the DB host directly — use the Management API):
--   node supabase/apply-sql.mjs supabase/migrations/00043_featured_products.sql

BEGIN;

-- 1. Featured flag (default false → existing rows unaffected).
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;

-- Partial index — the shop only ever filters for the (small) featured set.
CREATE INDEX IF NOT EXISTS idx_products_featured
    ON public.products(featured) WHERE featured;

-- 2. Extend the category CHECK to include 'Plant-Based' (V2food range).
--    The inline column CHECK from 00001 is named products_category_check.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE public.products ADD CONSTRAINT products_category_check CHECK (category IN (
    'Coconut','Meal Pastes','Asian Sauces',
    'Soy Sauces','Chilli Sauces','Condiments',
    'Noodles','Fish','Satay Sauces','Desserts',
    'Ready Meal Sauces','Plant-Based','Other'
));

COMMIT;
