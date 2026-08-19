import { supabase } from '@/lib/supabase'
import { toStorageRef } from '@/lib/storageKey'

// The order-verification signature, private since mig 00113 (security-audit
// findings STOR-1 / STOR-2).
//
// Both directions go through an Edge Function as service_role, because the
// `signatures` bucket now carries no client policy at all. The browser can
// neither upload to it nor read from it directly, which is the point: under the
// old `FOR ALL TO authenticated` policy any customer login could list every
// signature path and delete them, and there is no object-storage backup to
// restore from.

/** Upload a canvas PNG and get back the bare storage key to persist. */
export async function uploadSignature(pngDataUrl: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ key: string; bucket: string }>(
    'upload-signature',
    { body: { pngBase64: pngDataUrl } },
  )
  if (error) throw error
  if (!data?.key) throw new Error('No storage key returned')
  return data.key
}

/**
 * A short-lived signed URL for the signature on `orderId`.
 *
 * Keyed on the ORDER, not on a storage path: `orders` RLS is what decides who
 * may see it, which is how a customer keeps sight of the signature on their own
 * order. The storage path carries no link back to a row, so this question could
 * not have been asked with a storage policy.
 */
export async function getSignatureUrl(orderId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ signedUrl: string }>(
    'create-signature-url',
    { body: { orderId } },
  )
  if (error) throw error
  if (!data?.signedUrl) throw new Error('No signed URL returned')
  return data.signedUrl
}

/**
 * What to render for a stored signature value, without a round trip when one is
 * not needed.
 *
 * Returns the value itself for a legacy `data:` signature — three of those are
 * still seeded (supabase/seedData/orders.ts:99) and mig 00113 deliberately left
 * them alone, because a base64 image has no object behind it to sign. Returns
 * null when the value is a storage key, meaning "ask the server".
 */
export function inlineSignature(stored: string | null | undefined): string | null {
  const ref = toStorageRef('signatures', stored)
  return ref.kind === 'inline' || ref.kind === 'external' ? ref.url : null
}

/** True when there is a stored signature of any shape worth rendering. */
export function hasSignature(stored: string | null | undefined): boolean {
  return toStorageRef('signatures', stored).kind !== 'empty'
}
