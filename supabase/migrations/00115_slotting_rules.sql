-- =============================================================================
-- Slotting Rules — assign blocks of a warehouse to products, brands,
--                  categories and suppliers
-- Migration: 00115_slotting_rules.sql
-- =============================================================================
-- WHY THIS EXISTS. Before this, exactly ONE thing in the system constrained
-- which product may go where: zone_profiles.allowed_categories, an exact-string
-- Array.includes on products.category, applied as hard filter #4 in
-- _shared/wie/scoring.ts. That is category-only, has no ranking, no per-rule
-- strictness, and no notion of brand or SKU. An operator standing in a warehouse
-- saying "all the Milwaukee goes in aisle C, and if C is full put it in the
-- mezzanine" had no way to tell the system so.
--
-- WHY NOT wie_rules. It looks like the right table and it cannot do this. Five
-- reasons, each disqualifying on its own:
--   1. Its targets are PREDICATES, not SETS. RuleTarget is {scope, attr, op,
--      value} evaluated against resolveAttr's closed vocabulary; `definition` is
--      one JSONB column and there is nowhere to hang forty location ids.
--   2. Widening resolveAttr for product identity would change the meaning of
--      every EXISTING putaway rule's condition set at the same instant, in a
--      module three Edge Functions bundle independently.
--   3. wie_rules.priority breaks ties; this feature's precedence is a fixed
--      specificity ladder with no numbers. Both signals on one row is a bug
--      generator.
--   4. Rank is per (rule, block). There is nowhere to put it.
--   5. mutate-wie-rule is Admin-only; this is Admin+Manager.
-- `rule_type='slotting'` has sat unused in 00045's CHECK since the beginning.
-- LEAVE IT DEAD -- a string in a CHECK constraint is not a design.
--
-- SPECIFICITY IS A GENERATED BITMASK, AND IT HAS TO BE. Conditions combine with
-- AND, so "brand = Milwaukee AND category = Batteries" is strictly more specific
-- than "brand = Milwaukee" alone. A single subject_kind enum ("the most specific
-- axis present") ties those two and breaks the tie by id -- arbitrarily, and
-- invisibly. The bitmask orders all fifteen non-empty combinations correctly and
-- keeps SKU (8) above every combination that lacks it (max 4+2+1 = 7), so
-- ORDER BY specificity DESC, id ASC IS the ladder. Nobody maintains a priority
-- number, so nobody can get one wrong.
--
-- BLOCKS ARE NAMED, REUSABLE AND SHARED. "Aisle C" is defined once and any
-- number of rules may rank it, which is what makes the many-to-many honest:
-- fixing the block's footprint fixes every rule that references it at once.
--
-- MEMBERSHIP IS STORED ON THE UNIT AND EXPANDED BY PATH. A member row names a
-- flat BIN, a RACK parent (meaning all its levels) or one SHELF level, and
-- v_slotting_block_bins expands it. That survives the world moving in the ways
-- that actually happen here: a recode sweep never changes an id; re-levelling a
-- rack adds and removes levels with no re-sync to forget; bind_zones rewrites a
-- rack's path and its children's in the same batch, so the prefix relation
-- holds. The rejected alternatives each fail on a real mechanism -- a code
-- prefix cannot express many-to-many at all (locations.code_block is one per bin
-- and NULL on every site predating 00107), and a live area lookup would put the
-- geometric layout_objects x layout_placements intersection in the hot path of
-- every receipt, which is precisely why that intersection is done in TS.
--
-- AN AREA IS A SOURCE, NOT A SELECTOR. Painting materialises members once;
-- resync_block re-derives them with a dry run, exactly as bind_zones does, and
-- carries bind_zones' proof obligation: re-running it must report zero changes.
--
-- NEW TABLES ARE NOT BORN LOCKED IN THIS PROJECT. 00102 records that this
-- database carries ALTER DEFAULT PRIVILEGES for anon / authenticated /
-- service_role, so CREATE TABLE hands all seven privileges to all three. Every
-- REVOKE below is therefore in THIS file, not a follow-up: the usual
-- "lockdown migration last" ordering exists to protect an EXISTING client write
-- path, and there is none here. Omitting them would ship these tables
-- world-writable.
-- =============================================================================

BEGIN;

-- ── 1. Blocks — a named, reusable set of locations ───────────────────────────

CREATE TABLE IF NOT EXISTS public.slotting_blocks (
    id                SERIAL       PRIMARY KEY,
    warehouse_id      INT          NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    name              TEXT         NOT NULL
                          CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    -- Provenance is STORED, never derived. The same argument as
    -- locations.name_area (00094): once an area is repainted or renamed, no
    -- amount of geometry can say which area a block was built from.
    source_kind       TEXT         NOT NULL DEFAULT 'manual'
                          CHECK (source_kind IN ('manual','area')),
    source_area_name  TEXT,
    created_by        UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by        UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT slotting_blocks_area_needs_name
        CHECK (source_kind <> 'area' OR source_area_name IS NOT NULL)
);

-- Folded, for the same reason products.brand's index is: an operator typing
-- "aisle c" must collide with "Aisle C" rather than create a second block.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slotting_blocks_name
    ON public.slotting_blocks (warehouse_id, lower(btrim(name)));

COMMENT ON TABLE public.slotting_blocks IS
    'A named, reusable set of warehouse locations that slotting rules rank. '
    'Shared: several rules may reference one block, so correcting its footprint '
    'corrects every rule at once. Written only by mutate-slotting-rule.';

CREATE TABLE IF NOT EXISTS public.slotting_block_members (
    block_id     INT  NOT NULL REFERENCES public.slotting_blocks(id) ON DELETE CASCADE,
    location_id  INT  NOT NULL REFERENCES public.locations(id)       ON DELETE CASCADE,
    -- 'rack' expands to every level beneath it; 'bin'/'level' are themselves.
    unit_kind    TEXT NOT NULL CHECK (unit_kind IN ('bin','rack','level')),
    PRIMARY KEY (block_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_slotting_members_location
    ON public.slotting_block_members (location_id);

-- ── 2. Rules ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.slotting_rules (
    id                SERIAL      PRIMARY KEY,
    warehouse_id      INT         NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    name              TEXT        NOT NULL
                          CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    -- Match axes. NULL = no opinion on this axis; the non-NULL ones are ANDed.
    match_product_id  INT         REFERENCES public.products(id)  ON DELETE CASCADE,
    match_brand       TEXT,
    -- No FK: categories are free text with no table (00069 dropped the enum).
    -- Consequence stated rather than left to be found -- renaming a category
    -- silently stops a rule matching, which is why the settings table shows
    -- each rule's live match count so a zero is visible.
    match_category    TEXT,
    match_supplier_id INT         REFERENCES public.suppliers(id) ON DELETE CASCADE,
    enforcement       TEXT        NOT NULL CHECK (enforcement IN ('hard','soft')),
    -- Hold the block's bins empty for this rule's products. Default OFF: the
    -- reserving behaviour costs real racking in a full warehouse and must be
    -- something an operator asked for.
    reserve_empty     BOOLEAN     NOT NULL DEFAULT false,
    is_active         BOOLEAN     NOT NULL DEFAULT true,
    created_by        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT slotting_rules_needs_an_axis
        CHECK (num_nonnulls(match_product_id, match_brand, match_category, match_supplier_id) >= 1),
    -- See the header. SKU(8) > any combination without it (max 7); adding an
    -- axis always outranks not having it.
    specificity       INT GENERATED ALWAYS AS (
          (CASE WHEN match_product_id  IS NOT NULL THEN 8 ELSE 0 END)
        + (CASE WHEN match_brand       IS NOT NULL THEN 4 ELSE 0 END)
        + (CASE WHEN match_category    IS NOT NULL THEN 2 ELSE 0 END)
        + (CASE WHEN match_supplier_id IS NOT NULL THEN 1 ELSE 0 END)
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_slotting_rules_warehouse
    ON public.slotting_rules (warehouse_id) WHERE is_active;

COMMENT ON COLUMN public.slotting_rules.specificity IS
    'Generated bitmask implementing the fixed precedence ladder '
    'SKU > brand > category > supplier. ORDER BY specificity DESC, id ASC picks '
    'the governing rule. A bitmask rather than an enum because conditions AND '
    'together, so brand+category must outrank brand alone.';

CREATE TABLE IF NOT EXISTS public.slotting_rule_blocks (
    rule_id  INT NOT NULL REFERENCES public.slotting_rules(id)  ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: deleting a block a rule ranks must refuse and name
    -- the rules, the wie_level_role_usage all-zero pattern. Silently dropping a
    -- rule's primary home would leave the rule looking configured.
    block_id INT NOT NULL REFERENCES public.slotting_blocks(id) ON DELETE RESTRICT,
    rank     INT NOT NULL CHECK (rank >= 1),
    PRIMARY KEY (rule_id, block_id),
    -- DEFERRABLE is load-bearing. A drag-reorder rewrites every rank at once and
    -- a non-deferrable UNIQUE trips 23505 mid-statement -- the same problem the
    -- location code sweep needed a two-phase write for (00107). CONSEQUENCE: a
    -- deferrable constraint CANNOT be an ON CONFLICT arbiter, so the write path
    -- is delete-then-insert inside one transaction, never an upsert.
    CONSTRAINT uq_slotting_rule_rank UNIQUE (rule_id, rank) DEFERRABLE INITIALLY DEFERRED
);

-- ── 3. The one definition of "which bins are in this block" ──────────────────
--
-- Nothing else may re-derive this. plan-reslot is the cautionary tale: three
-- places answered "what zone is this bin in", two were wrong, and it ran
-- zone-blind for months with nothing failing.
--
-- The trailing '/' in the LIKE prefix is not cosmetic -- without it RACK1 would
-- swallow RACK10's levels.
CREATE OR REPLACE VIEW public.v_slotting_block_bins AS
SELECT m.block_id, l.id AS location_id
  FROM public.slotting_block_members m
  JOIN public.locations u ON u.id = m.location_id
  JOIN public.locations l
    ON (m.unit_kind =  'rack' AND l.materialized_path LIKE u.materialized_path || '/%')
    OR (m.unit_kind <> 'rack' AND l.id = u.id)
 WHERE l.is_active
   AND l.kind <> 'RACK';

COMMENT ON VIEW public.v_slotting_block_bins IS
    'Expands slotting_block_members (which name UNITS) to the leaf bins they '
    'cover. The single definition of block membership -- never re-derive this '
    'expansion in TypeScript or in another query.';

-- ── 4. Recommendation provenance ─────────────────────────────────────────────
-- A badge must not require parsing `explanation` JSONB.
ALTER TABLE public.wie_putaway_recommendations
    ADD COLUMN IF NOT EXISTS off_home BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.wie_putaway_recommendations
    ADD COLUMN IF NOT EXISTS slotting_rule_id INT
        REFERENCES public.slotting_rules(id) ON DELETE SET NULL;

-- ── 5. RLS and grants — see the header on ALTER DEFAULT PRIVILEGES ───────────
--
-- Staff read, service_role writes. user_is_staff() rather than a role literal,
-- per 00105: there is ONE definition of "internal" and this is not allowed to
-- become a second.

ALTER TABLE public.slotting_blocks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slotting_block_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slotting_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slotting_rule_blocks   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS slotting_blocks_select_staff        ON public.slotting_blocks;
DROP POLICY IF EXISTS slotting_block_members_select_staff ON public.slotting_block_members;
DROP POLICY IF EXISTS slotting_rules_select_staff         ON public.slotting_rules;
DROP POLICY IF EXISTS slotting_rule_blocks_select_staff   ON public.slotting_rule_blocks;

CREATE POLICY slotting_blocks_select_staff        ON public.slotting_blocks
    FOR SELECT TO authenticated USING ((SELECT public.user_is_staff()));
CREATE POLICY slotting_block_members_select_staff ON public.slotting_block_members
    FOR SELECT TO authenticated USING ((SELECT public.user_is_staff()));
CREATE POLICY slotting_rules_select_staff         ON public.slotting_rules
    FOR SELECT TO authenticated USING ((SELECT public.user_is_staff()));
CREATE POLICY slotting_rule_blocks_select_staff   ON public.slotting_rule_blocks
    FOR SELECT TO authenticated USING ((SELECT public.user_is_staff()));

-- REVOKE ALL covers TRUNCATE explicitly, which RLS cannot constrain (there is no
-- row to filter) -- so a policy alone would leave every one of these tables
-- truncatable by any logged-in user. That is the DB-3 finding 00112 recorded,
-- applied here at creation rather than left for an audit to find.
REVOKE ALL ON public.slotting_blocks        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.slotting_block_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.slotting_rules         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.slotting_rule_blocks   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_slotting_block_bins  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.slotting_blocks        TO authenticated;
GRANT SELECT ON public.slotting_block_members TO authenticated;
GRANT SELECT ON public.slotting_rules         TO authenticated;
GRANT SELECT ON public.slotting_rule_blocks   TO authenticated;

-- The view is read by the engine (service_role) and by the settings UI through
-- wie_slotting_rule_rows, which is SECURITY DEFINER. `authenticated` needs no
-- direct grant, and giving one would expose every bin id in the site.
GRANT SELECT ON public.v_slotting_block_bins TO service_role;

-- Sequences: SERIAL creates them with the same default privileges.
REVOKE ALL ON SEQUENCE public.slotting_blocks_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.slotting_rules_id_seq  FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   -- The ladder, over every non-empty combination. Expect a strict ordering
--   -- in which any row containing a more specific axis outranks one without:
--   SELECT specificity, match_product_id IS NOT NULL AS sku, match_brand IS NOT NULL AS brand,
--          match_category IS NOT NULL AS cat, match_supplier_id IS NOT NULL AS sup
--     FROM public.slotting_rules ORDER BY specificity DESC, id;
--
--   -- No client role may write, and none may TRUNCATE:
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name LIKE 'slotting%'
--      AND grantee IN ('anon','authenticated','PUBLIC') ORDER BY table_name, grantee;
--     -- expect: SELECT only, for authenticated only
--
--   -- The rank constraint must be deferrable, or a reorder cannot be written:
--   SELECT conname, condeferrable, condeferred FROM pg_constraint
--    WHERE conname = 'uq_slotting_rule_rank';   -- expect: t | t
--
-- Rollback:
--   DROP VIEW  IF EXISTS public.v_slotting_block_bins;
--   DROP TABLE IF EXISTS public.slotting_rule_blocks;
--   DROP TABLE IF EXISTS public.slotting_rules;
--   DROP TABLE IF EXISTS public.slotting_block_members;
--   DROP TABLE IF EXISTS public.slotting_blocks;
--   ALTER TABLE public.wie_putaway_recommendations
--     DROP COLUMN IF EXISTS off_home, DROP COLUMN IF EXISTS slotting_rule_id;
-- =============================================================================
