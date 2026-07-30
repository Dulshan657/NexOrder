-- 00089_product_embeddings.sql
-- Semantic retrieval for PO product lines.
--
-- Why this exists. `_shared/poInbox/aliasResolver.ts` resolves a PO line to a
-- product by exact alias first, and when that misses it hands the model a
-- catalog to choose from — the WHOLE catalog, capped at 500 rows
-- (fetchProductCatalog). That cap is not a performance knob, it is a
-- correctness ceiling: the 501st SKU can never be matched, and the operator is
-- given no clue why. It also spends ~15k prompt tokens on every unmatched line.
--
-- With embeddings the resolver retrieves ~20 nearest candidates and lets the
-- SAME model pick from those. The pick, its 0.9 auto-alias threshold, the alias
-- write and the audit row are all unchanged; only the candidate list changes.
--
-- `content_hash` is what makes re-embedding idempotent. It is the hash of the
-- exact text that was embedded, produced by `productEmbedText()` in
-- `_shared/poInbox/embeddings.ts` — writer and staleness-checker share that one
-- function so the hash cannot drift from what it describes. Re-running the
-- embed job after no catalog change therefore embeds nothing and costs nothing.
--
-- Rollback: DROP FUNCTION public.match_products(extensions.vector, integer);
--           DROP TABLE public.product_embeddings;
--           (leave the extension — dropping it would take other users' types.)

BEGIN;

-- Supabase convention: extensions live in `extensions`, not `public`. Creating it
-- explicitly with the schema means every reference below can be qualified rather
-- than relying on whatever search_path the caller happens to have.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.product_embeddings (
  -- One row per product; ON DELETE CASCADE so a deleted product cannot leave a
  -- vector behind that would keep being returned as a candidate.
  product_id   integer PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,

  -- SHA-256 of the embedded text. Lets the embed job skip unchanged products.
  content_hash text NOT NULL,

  -- 1536 dimensions = text-embedding-3-small. Changing model means changing this
  -- width, which is a new migration and a full re-embed, not an in-place edit.
  embedding    extensions.vector(1536) NOT NULL,

  -- Stamped per row so a mixed-model table during a migration is diagnosable
  -- rather than silently comparing vectors from different spaces.
  model        text NOT NULL,

  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_embeddings IS
  'Product-catalog embeddings for PO line retrieval (mig 00089). Written by the embed-products Edge Function; read only through match_products(). content_hash is the SHA-256 of productEmbedText() output and makes re-embedding idempotent.';

-- Cosine, because text-embedding-3-small is normalised and the resolver ranks by
-- similarity rather than magnitude. The operator class must be qualified for the
-- same reason the type is.
CREATE INDEX IF NOT EXISTS product_embeddings_embedding_hnsw
  ON public.product_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

-- service_role only: RLS on with no policies, matching environment_marker
-- (00086). Nothing in the browser reads this table — retrieval happens inside an
-- Edge Function, and an embedding of the catalog is not something to hand out.
ALTER TABLE public.product_embeddings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_embeddings FROM anon, authenticated;

-- Nearest active products to a query embedding.
--
-- SECURITY DEFINER with a pinned search_path: the caller is the service_role
-- Edge Function, which already bypasses RLS, but pinning keeps the function
-- honest if it is ever granted more widely, and the qualified search_path is
-- required for the `<=>` operator to resolve at all.
CREATE OR REPLACE FUNCTION public.match_products(
  p_query extensions.vector(1536),
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id          integer,
  sku         text,
  name        text,
  carton_size integer,
  similarity  double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    p.id,
    p.sku,
    p.name,
    p.carton_size,
    -- Cosine DISTANCE is what `<=>` returns; similarity is its complement, which
    -- is what a caller thinking about "how close is this" expects.
    (1 - (e.embedding OPERATOR(extensions.<=>) p_query))::double precision AS similarity
  FROM public.product_embeddings e
  JOIN public.products p ON p.id = e.product_id
  -- `IS DISTINCT FROM false` rather than `= true`: is_active is nullable and a
  -- NULL has always meant active everywhere else in this schema.
  WHERE p.is_active IS DISTINCT FROM false
  ORDER BY e.embedding OPERATOR(extensions.<=>) p_query
  -- Clamped so a bad caller cannot ask for the whole table, and a NULL or 0
  -- cannot collapse the result to nothing.
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200)
$$;

COMMENT ON FUNCTION public.match_products(extensions.vector, integer) IS
  'Top-N active products nearest a query embedding, by cosine similarity (mig 00089). service_role only — called by extract-po via aliasResolver to shortlist candidates for the AI product pick.';

-- EXECUTE is granted to PUBLIC by default, which would let any authenticated
-- user probe the catalog with arbitrary vectors. Take it back explicitly.
REVOKE ALL ON FUNCTION public.match_products(extensions.vector, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_products(extensions.vector, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_products(extensions.vector, integer) TO service_role;

COMMIT;
