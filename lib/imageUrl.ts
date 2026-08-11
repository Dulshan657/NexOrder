/**
 * Image URL helpers — Supabase Storage on-the-fly transforms with graceful
 * fallback.
 *
 * A Storage object can be served through Supabase's `render/image` CDN to
 * resize on the fly and auto-negotiate WebP/AVIF via the browser `Accept`
 * header. That endpoint is a *paid-plan* feature, so every transform here is
 * gated behind `VITE_SUPABASE_IMAGE_TRANSFORMS`, and `<OptimizedImage>`
 * additionally retries the raw object URL on any load error. The combination
 * makes this safe to ship on the free tier and against external/data URLs.
 */

const PUBLIC_OBJECT_MARKER = '/storage/v1/object/public/';
const RENDER_IMAGE_MARKER = '/storage/v1/render/image/public/';

export interface ImageTransform {
  /** Target render width in pixels (longest side is scaled to fit). */
  width: number;
  /** Optional target height; when set, `resize` controls the fit. */
  height?: number;
  /** Output quality, 20–100. Defaults to 75. */
  quality?: number;
  /** Fit mode when both width and height are given. Defaults to 'cover'. */
  resize?: 'cover' | 'contain' | 'fill';
}

/** True when this build opts into Supabase image transforms. */
export function imageTransformsEnabled(): boolean {
  return import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS === 'true';
}

/**
 * Only a Supabase Storage *public object* URL can be routed through
 * render/image. External CDN URLs (a supplier's own image host, say) and
 * `data:` URLs cannot.
 */
export function isSupabaseStorageObjectUrl(url: string): boolean {
  return url.includes(PUBLIC_OBJECT_MARKER);
}

/**
 * Rewrite a Supabase public object URL to its render/image transform URL.
 * Pure and unconditional: callers decide whether to use it. Returns the input
 * unchanged when it isn't a Supabase Storage object URL.
 */
export function buildSupabaseRenderUrl(url: string, transform: ImageTransform): string {
  if (!isSupabaseStorageObjectUrl(url)) return url;

  const base = url.replace(PUBLIC_OBJECT_MARKER, RENDER_IMAGE_MARKER);
  const params = new URLSearchParams();
  params.set('width', String(Math.round(transform.width)));
  if (transform.height != null) {
    params.set('height', String(Math.round(transform.height)));
    params.set('resize', transform.resize ?? 'cover');
  }
  params.set('quality', String(transform.quality ?? 75));
  return `${base}?${params.toString()}`;
}

/**
 * The URL to request for a source, honoring the feature flag. Non-storage
 * sources and disabled transforms pass through unchanged.
 */
export function getOptimizedImageUrl(url: string, transform: ImageTransform): string {
  if (!imageTransformsEnabled() || !isSupabaseStorageObjectUrl(url)) return url;
  return buildSupabaseRenderUrl(url, transform);
}

/**
 * Rewrite a Supabase Storage URL to a same-origin path.
 *
 * WHY: image columns store ABSOLUTE Supabase URLs containing the project ref,
 * so `<img src>` advertises `lsgkznyiabqitqfpveey.supabase.co` to anyone who
 * opens devtools or copies an image address. The ref is immutable and cannot be
 * renamed. `vercel.ts` rewrites `/storage/:path*` back to the Supabase host, so
 * returning a RELATIVE path is enough to hide it.
 *
 * Relative, not absolute-with-app-origin, deliberately: the same string then
 * works on localhost, on a preview deployment and in production with nothing to
 * configure and no origin to get wrong.
 *
 * Only the ORIGIN is replaced. The path is untouched, which is what lets one
 * rewrite rule serve both `/storage/v1/object/public/…` and the transform
 * endpoint `/storage/v1/render/image/public/…` — and it is why this composes
 * with `buildSupabaseRenderUrl` in either order.
 *
 * Returns the input unchanged for anything that is not a Supabase Storage URL
 * (external CDN, `data:`, already-relative).
 */
export function publicImageUrl(url: string): string {
  const marker = url.indexOf('/storage/');
  if (marker < 0) return url;
  if (!/^https?:\/\//.test(url)) return url;
  // Guard against a path that merely CONTAINS "/storage/" further along:
  // the marker must be the start of the path, i.e. the next "/" after the host.
  const pathStart = url.indexOf('/', url.indexOf('://') + 3);
  if (pathStart !== marker) return url;
  return url.slice(marker);
}

/**
 * Ordered candidate sources for `<OptimizedImage>`: the same-origin proxied URL
 * first, then the direct Supabase URL, then the raw one.
 *
 * The direct URL is retained ON PURPOSE. `<OptimizedImage>` retries the next
 * candidate on load error, so if the `/storage` rewrite is ever missing —
 * a Vercel config that did not take, a preview built without it, `vite preview`
 * — the images still load from Supabase directly after one failed request.
 * That turns "every image in the app is broken" into "one wasted round trip",
 * which is the difference between a bad config being a page-one incident and
 * being a line in the network tab.
 */
export function optimizedImageSources(url: string, transform: ImageTransform): string[] {
  const optimized = getOptimizedImageUrl(url, transform);
  const candidates = [publicImageUrl(optimized), optimized, url];
  return candidates.filter((candidate, i) => candidates.indexOf(candidate) === i);
}
