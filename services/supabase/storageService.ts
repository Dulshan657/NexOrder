import { supabase } from '@/lib/supabase';

export type StorageBucket = 'company-assets' | 'visit-photos' | 'signatures';

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
