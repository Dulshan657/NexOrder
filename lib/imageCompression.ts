/**
 * Client-side image compression — resize + WebP conversion before upload.
 *
 * Replaces the old "stuff a base64 data URL into the DB" pattern: admin image
 * uploads are now downscaled and re-encoded in the browser, then sent to
 * Supabase Storage as a small WebP. The `browser-image-compression` library is
 * imported lazily so it only loads when someone actually uploads, and so the
 * pure `buildCompressionOptions` helper stays testable under the node test env.
 */

export interface CompressOptions {
  /** Longest-edge cap in pixels; the image is scaled down to fit. */
  maxWidthOrHeight: number;
  /** Output quality, 0–1. Defaults to 0.8. */
  quality?: number;
  /** Output MIME type. Defaults to 'image/webp'. */
  fileType?: string;
}

export interface ResolvedCompressionOptions {
  maxWidthOrHeight: number;
  initialQuality: number;
  fileType: string;
  useWebWorker: boolean;
}

/** Pure: map our options onto the `browser-image-compression` option shape. */
export function buildCompressionOptions(opts: CompressOptions): ResolvedCompressionOptions {
  return {
    maxWidthOrHeight: opts.maxWidthOrHeight,
    initialQuality: opts.quality ?? 0.8,
    fileType: opts.fileType ?? 'image/webp',
    useWebWorker: true,
  };
}

/**
 * Compress + resize an image File in the browser, converting to WebP by
 * default. Throws on failure so callers can surface a clear error to the user.
 */
export async function compressImage(file: File, opts: CompressOptions): Promise<File> {
  const { default: imageCompression } = await import('browser-image-compression');
  return imageCompression(file, buildCompressionOptions(opts));
}
