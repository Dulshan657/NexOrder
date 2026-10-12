// generate-qr-poster Edge Function
//
// Renders the printable QR for a venue -- an A4 wall poster or a 60 x 80 mm
// sticker -- and returns the PDF bytes directly. Nothing is stored.
//
// WHY NOTHING IS STORED. The QR encodes the venue's entry token, which is the
// only thing between a stranger and that venue's PIN pad (`qr_codes`, mig 00129,
// has no client grant for exactly that reason). A PDF parked in a bucket would be
// a second, longer-lived copy of the secret with its own access rules to get
// wrong, and `warehouse-labels` / `order-documents` style signed URLs would hand
// the token to whoever the URL is forwarded to. So the bytes go straight back to
// the caller and `Cache-Control: no-store` keeps them out of every cache on the
// way.
//
// READ-ONLY. If the venue has no code yet this refuses rather than creating one:
// minting a code is a security action (it starts the venue's PIN scheme) and
// belongs to `mutate-qr-access`, behind its own audit entry and rate bucket. A
// "print" button that quietly creates credentials is the wrong surprise.
//
// WHO. The same people who can manage the venue's PINs: `canManageHoreca`
// (Admin/Manager, the venue's assigned reps, the venue's own Customer login).
// Every other role -- Warehouse and QR Staff included -- is refused by
// `allowedRoles` before the venue is even looked at.
//
// The drawing is `_shared/qrPoster/render.ts`; the geometry it follows is the
// pure, unit-tested `_shared/qrPoster/layout.ts`.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { readAppUrl } from '../_shared/appUrl.ts'
import { canManageHoreca } from '../_shared/qrAccess.ts'
import { fetchLogoImage, loadCompanyIdentity } from '../_shared/companyIdentity.ts'
import { encodeQr } from '../_shared/qrPoster/matrix.ts'
import { renderPoster } from '../_shared/qrPoster/render.ts'
import { POSTER_FORMATS, posterFileName, type PosterFormat } from '../_shared/qrPoster/layout.ts'

const ALLOWED: ReadonlyArray<UserRole> = [
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
  'Restaurant/Hotel Customer',
]

const inputSchema = z.object({
  horecaId: z.number().int().positive(),
  format: z.enum(POSTER_FORMATS as unknown as [PosterFormat, ...PosterFormat[]]),
})

const NO_CODE_MESSAGE = 'Open QR & PINs first to create the code'

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('shop')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 10/min/user: a render is a few hundred ms of CPU and a logo fetch.
    const rl = await checkRateLimit(`qr-poster:${auth.userId}`, { windowMs: 60_000, max: 10 })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'horecaId and format (a4 | sticker) required', parsed.error.flatten())
    }
    const { horecaId, format } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (!(await canManageHoreca(admin, auth, horecaId))) {
      throw new EdgeFunctionError('FORBIDDEN', 'You do not have access to this venue')
    }

    // Fail closed on the origin: a poster that encodes the wrong host sends every
    // kitchen to a different environment, and it would only be discovered after
    // it was printed and stuck to a wall. See `_shared/appUrl.ts`.
    const appUrl = readAppUrl()
    if (!appUrl) {
      console.error('[generate-qr-poster] APP_URL is not set on this project')
      throw new EdgeFunctionError('INTERNAL', 'The app address is not configured for this deployment')
    }

    const [horecaRes, codeRes, identity] = await Promise.all([
      admin.from('horecas').select('id, name').eq('id', horecaId).maybeSingle(),
      admin.from('qr_codes').select('token').eq('horeca_id', horecaId).maybeSingle(),
      loadCompanyIdentity(admin),
    ])
    if (horecaRes.error) throw new EdgeFunctionError('INTERNAL', 'Could not read the venue')
    if (!horecaRes.data) throw new EdgeFunctionError('NOT_FOUND', `No venue with id ${horecaId}`)
    if (codeRes.error) throw new EdgeFunctionError('INTERNAL', 'Could not read the venue code')
    const token = (codeRes.data as { token?: string } | null)?.token
    if (!token) throw new EdgeFunctionError('NOT_FOUND', NO_CODE_MESSAGE)

    const venueName = (horecaRes.data as { name: string }).name
    const matrix = encodeQr(`${appUrl}/?qr=${encodeURIComponent(token)}`)
    const logo = await fetchLogoImage(identity.logoUrl)

    const { bytes } = await renderPoster({
      format,
      venueName,
      companyName: identity.name,
      phone: identity.phone,
      logo,
      matrix,
    })

    // `read`, not `create`: nothing is written, but the response hands out the
    // venue's entry token, which no client can otherwise read. The token itself
    // is never logged.
    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'read',
      resource: 'qr_poster',
      resourceId: String(horecaId),
      metadata: { format, bytes: bytes.byteLength, hadLogo: logo !== null },
    })

    // Copied into a plain ArrayBuffer-backed array: pdf-lib hands back
    // `Uint8Array<ArrayBufferLike>`, which `Response` does not accept as a body.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${posterFileName(venueName, format)}"`,
        // The PDF contains the venue's entry token. Never cache it anywhere.
        'Cache-Control': 'no-store',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[generate-qr-poster] unexpected error:', e)
    return errorResponse('INTERNAL', 'Could not generate the poster', undefined, undefined, req)
  }
})
