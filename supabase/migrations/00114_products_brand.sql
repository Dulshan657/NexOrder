-- =============================================================================
-- products.brand -- the missing third classification axis
-- Migration: 00114_products_brand.sql
-- =============================================================================
-- WHY THIS EXISTS. Slotting Rules (00115) let an operator say "this brand lives
-- in these racks". Before this migration there was nowhere to say which brand a
-- product IS: `products` carries `category` (free text since 00069) and
-- `supplier_id`, and nothing else that classifies. Brand is genuinely a third
-- axis -- a distributor's supplier is not its manufacturer, and "Fertiliser" is
-- not "Yara" -- so neither existing column can stand in for it.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. Every product predating this has no brand
-- and that is the honest value. A '' default would be worse than useless: an
-- empty string is a value a rule condition can match, so seeding one would
-- silently enrol the entire back catalogue in the first brand rule anyone wrote
-- with a blank field. "Unbranded" must have exactly one representation and it
-- is NULL.
--
-- THE INDEX IS ON THE FOLDED EXPRESSION, DELIBERATELY. Rule matching folds both
-- sides (`lower(btrim(...))` in SQL, `foldMatch` in
-- _shared/wie/slotting.ts) because an operator typing "Milwaukee " into a rule
-- must match a product row reading "milwaukee". A plain btree on `brand` cannot
-- serve that predicate -- Postgres will not use it for `lower(btrim(brand)) = $1`
-- -- so it would sit there looking like coverage while every rule match
-- sequentially scanned the catalogue.
--
-- The length CHECK mirrors products_category_length_check (00069:28) exactly,
-- so the two free-text classification columns cannot drift on what they accept.
-- =============================================================================

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand TEXT;

COMMENT ON COLUMN public.products.brand IS
    'Manufacturer / brand name, free text. NULL = unbranded, which is the '
    'honest value for every row predating mig 00114 -- never '''' (an empty '
    'string is matchable by a slotting rule condition). Matched case- and '
    'whitespace-folded by slotting rules; see _shared/wie/slotting.ts '
    'foldMatch, whose folding this column''s index must agree with.';

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_brand_length_check;
ALTER TABLE public.products ADD CONSTRAINT products_brand_length_check
    CHECK (brand IS NULL OR char_length(btrim(brand)) BETWEEN 1 AND 60);

-- Folded, and partial: an unbranded row is the common case on an existing
-- catalogue and indexing thousands of NULLs buys nothing.
CREATE INDEX IF NOT EXISTS idx_products_brand
    ON public.products (lower(btrim(brand)))
    WHERE brand IS NOT NULL;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'brand';
--     -- expect: brand | text | YES
--
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.products'::regclass
--    AND conname = 'products_brand_length_check';   -- expect one row
--
--   -- The CHECK must refuse whitespace-only and over-long values outright:
--   UPDATE public.products SET brand = '   ' WHERE id = (SELECT min(id) FROM public.products);
--     -- expect: violates check constraint "products_brand_length_check"
--
--   -- The folded index must actually be chosen by a folded predicate:
--   EXPLAIN SELECT id FROM public.products WHERE lower(btrim(brand)) = 'milwaukee';
--     -- expect: Index Scan using idx_products_brand
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_products_brand;
--   ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_brand_length_check;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS brand;
-- =============================================================================
