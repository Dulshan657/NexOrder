import { supabase } from '@/lib/supabase';

/**
 * The buckets a signed-in browser may still write to directly.
 *
 * `signatures` and `visit-photos` were removed from this union by mig 00113
 * (security-audit findings STOR-1 / STOR-2). Both are now private and carry no
 * client policy at all, so every read and write goes through an Edge Function
 * as service_role — see `services/supabase/signatureService.ts` and
 * `visitPhotoService.ts`. Do not add them back: the direct-upload capability
 * and the "any customer can list and delete every object" hole were the same
 * `FOR ALL TO authenticated` policy.
 *
 * The three that remain are public BY DESIGN — the operator logo is on every
 * page and every generated PDF, product images are on the customer Shop, and
 * an avatar sits in the header of every session — so a public URL is the right
 * return value for them. What 00113 changed is who may write: Admin for
 * `company-assets` and `avatars`, Admin/Manager for `product-images`, matching
 * the Edge Function that owns the column pointing at each.
 */
export type StorageBucket =
    | 'company-assets'
    | 'product-images'
    | 'avatars';

/**
 * Upload a Blob/File to a Supabase Storage bucket and return the public URL.
 * Path is always `${prefix}/${randomId}.${ext}` so concurrent uploads don't collide.
 */
export async function uploadToBucket(
    bucket: StorageBucket,
    file: Blob | File,
    options: { prefix?: string; contentType?: string; ext?: string } = {},
): Promise<string> {
    const ext = options.ext ?? guessExtension(options.contentType ?? (file instanceof File ? file.type : 'image/png'));
    const id = crypto.randomUUID();
    const path = options.prefix ? `${options.prefix}/${id}.${ext}` : `${id}.${ext}`;

    const { error } = await supabase.storage.from(bucket).upload(path, file, {
        contentType: options.contentType ?? (file instanceof File ? file.type : undefined),
        upsert: false,
    });
    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}

/**
 * Convert a base64 data URL into a Blob suitable for upload.
 * Useful for canvas signatures and any in-browser-generated image.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/png';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/**
 * True when a URL points at an object in the given bucket. Use this to guard
 * deletes so we never try to remove an external CDN URL or a legacy data URL
 * that merely happens to be stored in the same column.
 */
export function isBucketUrl(bucket: StorageBucket, publicUrl: string | null | undefined): boolean {
    if (!publicUrl) return false;
    return publicUrl.includes(`/storage/v1/object/public/${bucket}/`);
}

/**
 * Delete an object from a bucket given its public URL (best-effort; ignores 404s).
 */
export async function deleteFromBucketByUrl(bucket: StorageBucket, publicUrl: string): Promise<void> {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx < 0) return;
    const path = publicUrl.substring(idx + marker.length);
    await supabase.storage.from(bucket).remove([path]);
}

function guessExtension(mime: string): string {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('svg')) return 'svg';
    return 'bin';
}
