// voice-session Edge Function (SKELETON)
//
// Nex Assistant: mints the short-lived realtime voice session the browser
// connects with. Owned by the `voice_assistant` module
// (`config/moduleOwnership.mjs`), which requires `sales_orders`.
//
// This file exists so the module ownership map and its test
// (`__tests__/moduleOwnership.test.ts`) agree from the commit that introduces
// the flag. It gates on the module, authenticates the four sales roles and
// then refuses: a function that answered 200 without doing the work would
// look like it had shipped. The real body (rate limit, audit, session mint)
// replaces everything after `requireAuth` in a later task.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = [
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
]

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('voice_assistant')
    await requireAuth(req, { allowedRoles: ALLOWED })

    throw new EdgeFunctionError('NOT_FOUND', 'Not implemented yet')
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
