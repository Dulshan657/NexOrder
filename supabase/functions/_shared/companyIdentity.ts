// Who the operator of this deployment is, read from `app_settings`.
//
// `app_settings` stores six identity columns — company_name, company_address,
// company_phone, company_email, currency, company_logo_url — every one of which
// was editable in Settings → General and rendered NOWHERE. The operator filled
// the form in, saved, and nothing anywhere changed. Meanwhile
// `_shared/orderDocuments.ts` printed the literal 'Nex Order' onto every pick
// slip and dispatch advice.
//
// That is fine while NexGen is the only user of the system. It stops being fine
// the moment a deployment belongs to a client: the product is NexOrder, but the
// document is Amadiya's, and a picking note that names the software vendor as
// the supplier is simply wrong. See MULTI-TENANT-ARCHITECTURE.md §2 layer 1 —
// "express a tenant difference as data" only works if something reads the data.
//
// ── THERE IS NO DEFAULT, ON PURPOSE ─────────────────────────────────────────
//
// If `company_name` is unset this returns an empty string and the document
// prints no company name. It does NOT fall back to 'Nex Order'. A blank header
// is obviously broken and gets reported in minutes; a header confidently naming
// the wrong company is not noticed at all, and every document already sent
// carried it. Same argument as APP_URL in `_shared/appUrl.ts`, which used to
// default to the demo origin and so "succeeded" while emailing customers links
// to a different deployment.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export interface CompanyIdentity {
  name: string
  address: string
  phone: string
  email: string
  currency: string
  logoUrl: string | null
}

export const EMPTY_COMPANY_IDENTITY: CompanyIdentity = {
  name: '',
  address: '',
  phone: '',
  email: '',
  currency: 'AUD',
  logoUrl: null,
}

/**
 * Read the singleton `app_settings` row. Requires a service-role client —
 * `app_settings` is Admin-only for writes and the caller is always an Edge
 * Function that already holds one.
 *
 * Never throws. A document that cannot name its company is still a document the
 * warehouse needs in order to pick, so a settings read failure degrades to a
 * blank header rather than failing the whole request. It is logged, because a
 * silent blank is the one outcome worse than a loud one.
 */
export async function loadCompanyIdentity(admin: SupabaseClient): Promise<CompanyIdentity> {
  const { data, error } = await admin
    .from('app_settings')
    .select('company_name, company_address, company_phone, company_email, currency, company_logo_url')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) {
    console.error('[companyIdentity] could not read app_settings:', error?.message ?? 'no row')
    return EMPTY_COMPANY_IDENTITY
  }

  const row = data as Record<string, string | null>
  return {
    name: (row.company_name ?? '').trim(),
    address: (row.company_address ?? '').trim(),
    phone: (row.company_phone ?? '').trim(),
    email: (row.company_email ?? '').trim(),
    // Currency is the one field with a safe default: it is a formatting choice,
    // not an identity claim, and every price in the system is already AUD.
    currency: (row.currency ?? '').trim() || 'AUD',
    logoUrl: (row.company_logo_url ?? '').trim() || null,
  }
}

export interface LogoImage {
  bytes: Uint8Array
  format: 'png' | 'jpg'
}

const LOGO_TIMEOUT_MS = 2000
const LOGO_MAX_BYTES = 1024 * 1024

/**
 * Fetch the operator's logo for embedding in a PDF, or null.
 *
 * Three things this deliberately does NOT do:
 *
 * - **Trust the Content-Type.** Storage serves whatever was uploaded and will
 *   happily label something `application/octet-stream`. The format is sniffed
 *   from magic bytes instead, because handing pdf-lib the wrong decoder throws
 *   inside PDF generation, which turns a cosmetic problem into a failed pick
 *   slip.
 * - **Support WebP or SVG.** pdf-lib embeds PNG and JPEG only. The logo upload
 *   in `GeneralTab.tsx:125` does not run images through
 *   `lib/imageCompression.ts`, so whatever the operator picked is what is
 *   stored — and PRODUCTION-LAUNCH-PLAN.md asks the client for "PNG/SVG". An
 *   SVG logo will therefore be silently skipped and the header will be
 *   text-only. That is the correct outcome; the alternative is a document that
 *   fails to generate because of a picture.
 * - **Block for long.** This sits in `update-order-status`, a user-facing
 *   action. Two seconds, one megabyte, and any failure at all means no logo.
 */
export async function fetchLogoImage(url: string | null): Promise<LogoImage | null> {
  if (!url) return null

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) })
    if (!resp.ok) {
      console.error(`[companyIdentity] logo fetch returned ${resp.status} for ${url}`)
      return null
    }

    const buf = new Uint8Array(await resp.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > LOGO_MAX_BYTES) {
      console.error(`[companyIdentity] logo is ${buf.byteLength} bytes — skipping`)
      return null
    }

    const format = sniffImageFormat(buf)
    if (!format) {
      console.error('[companyIdentity] logo is not PNG or JPEG (pdf-lib supports no others) — skipping')
      return null
    }

    return { bytes: buf, format }
  } catch (e) {
    console.error('[companyIdentity] logo fetch failed:', e instanceof Error ? e.message : e)
    return null
  }
}

function sniffImageFormat(b: Uint8Array): 'png' | 'jpg' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  return null
}
