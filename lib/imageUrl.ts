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
 * render/image. External CDN URLs (e.g. ayam.com) and `data:` URLs cannot.
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
 * Ordered candidate sources for `<OptimizedImage>`: the optimized URL first,
 * then the raw URL as a fallback when they differ. Lets the component retry
 * the original before giving up and showing a placeholder.
 */
export function optimizedImageSources(url: string, transform: ImageTransform): string[] {
  const optimized = getOptimizedImageUrl(url, transform);
  return optimized === url ? [url] : [optimized, url];
}
