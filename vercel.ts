// Vercel project configuration, derived from the deployment-target registry.
//
// Replaces `vercel.json`. The reason is not tidiness — it is that a static JSON
// file cannot express a per-target value, and the platform reads it BEFORE the
// build runs, so no prebuild script can generate one either. With one Vercel
// project per tenant (MULTI-TENANT-ARCHITECTURE.md) two things in here differ
// per target and both are load-bearing:
//
//   1. the CSP's Supabase host — wrong host, and every image, realtime socket
//      and PDF preview is blocked the moment the policy goes enforcing;
//   2. the /storage proxy destination — see below.
//
// The target comes from NEXORDER_ENV, set as a build env var on each Vercel
// project. That is the same variable `scripts/lib/env.mjs` already accepts and
// the same one vite.config.ts reads, so ONE variable per project decides the
// Supabase credentials, the CSP, the image proxy and (later) the module flags.
//
// It falls back to 'dev' rather than throwing: a preview built from a fork, or
// a local `vercel build`, has no reason to know about this and the demo target
// is the safe guess. A tenant project that lost the variable would serve the
// dev CSP, which fails LOUDLY (its own Supabase host is not in connect-src)
// rather than quietly — that is the right direction for this to fail in.

import { routes, type VercelConfig } from '@vercel/config/v1'

import { TARGETS, isProvisioned } from './config/environments.mjs'

const targetName = process.env.NEXORDER_ENV?.trim() || 'dev'
const target = TARGETS[targetName] ?? TARGETS.dev

/**
 * Every Supabase host the browser may talk to for this target.
 *
 * An unprovisioned target (Amadiya, until §A0.3) has none, so the CSP is built
 * without a Supabase source rather than with the string "null" in it.
 */
const supabaseHost = isProvisioned(target)
  ? target.supabaseUrl.replace(/^https:\/\//, '')
  : null

const supabaseHttps = supabaseHost ? ` https://${supabaseHost}` : ''
const supabaseWss = supabaseHost ? ` wss://${supabaseHost}` : ''

/**
 * Report-Only until Phase B. `frame-src` is listed explicitly because without
 * it CSP falls back to default-src ('self'), which would break the PO Inbox
 * document preview and the document viewer the moment the policy is enforced.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob:${supabaseHttps} https://*.tile.openstreetmap.org`,
  `connect-src 'self'${supabaseHttps}${supabaseWss}`,
  `frame-src 'self' blob:${supabaseHttps}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

/**
 * Serve Supabase Storage through the app's own origin.
 *
 * Image columns store ABSOLUTE Supabase URLs containing the project ref, so
 * `<img src>` advertises `lsgkznyiabqitqfpveey.supabase.co` to anyone who opens
 * devtools or copies an image address. The ref is immutable; this hides it.
 *
 * The rewrite deliberately covers the whole `/storage/` prefix rather than just
 * `/storage/v1/object/public/`, so the transform endpoint
 * (`/storage/v1/render/image/public/…`) rides through the same rule. That is
 * what lets `lib/imageUrl.ts` swap only the ORIGIN and leave the path alone.
 *
 * ORDER MATTERS. `rewrites` are matched in order and the SPA catch-all below
 * matches everything, so this must come first or every image would be served
 * index.html — with a 200, which is the confusing way for it to fail.
 */
const storageRewrite = supabaseHost
  ? [routes.rewrite('/storage/:path*', `https://${supabaseHost}/storage/:path*`)]
  : []

export const config: VercelConfig = {
  framework: 'vite',

  rewrites: [
    ...storageRewrite,
    // SPA catch-all. Must stay last.
    routes.rewrite('/(.*)', '/index.html'),
  ],

  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy-Report-Only', value: csp },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          // `camera=(self)`, NOT `camera=()`. An empty allowlist denies the
          // feature to the document's OWN origin, which silently killed the
          // camera scan fallback on every deployed build: `getUserMedia`
          // rejects with NotAllowedError, and because Permissions-Policy does
          // not remove the API, `isCameraScanAvailable()` still returned true —
          // so ScanField rendered the camera button, opened the sheet, and told
          // the operator to "allow camera access for this site", which is advice
          // nobody can act on because the denial is a response header and not a
          // permission prompt.
          //
          // The hand-held imager is the primary reader (see CLAUDE.md — Code 128
          // over QR precisely because a laser beats a camera), so this is the
          // fallback for a torn or unreachable label. `microphone`, `payment`
          // and `usb` stay fully denied; nothing in the app asks for them.
          key: 'Permissions-Policy',
          value: 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=()',
        },
      ],
    },
    {
      // deploy.mjs polls this to confirm the alias serves the deployed sha.
      source: '/version.json',
      headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
    },
  ],
}

export default config
