#!/usr/bin/env node
// Assert vercel.ts's CSP is right for each target, and that the /storage image
// proxy is ordered ahead of the SPA catch-all.
//
//   node scripts/check-csp.mjs
//
// The CSP used to be hand-copied into static `vercel.json`, and this script
// existed to stop that copy drifting. `vercel.ts` now DERIVES it from the
// registry, so drift of that kind is gone — but two new things can go wrong,
// and both are silent:
//
//   1. The config is evaluated per target via NEXORDER_ENV. A target whose
//      Supabase host is missing from its own CSP is invisible while the policy
//      is Report-Only (Phase B promotes it to enforcing, at which point every
//      image, every realtime socket and every PDF preview breaks at once).
//   2. `rewrites` are matched IN ORDER and the SPA catch-all matches
//      everything. If /storage ever sorts after it, every product image is
//      served index.html — with a 200, so it reads as a broken image rather
//      than as a routing bug.
//
// `frame-src` is checked because it was once missing entirely — with no
// frame-src, CSP falls back to default-src 'self', which would have broken the
// PO Inbox document preview (POInboxDetailModal) and the document viewer the
// moment the policy went enforcing.

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { TARGETS, isProvisioned } from '../config/environments.mjs'
import { ROOT } from './lib/env.mjs'

const REQUIRED_DIRECTIVES = ['img-src', 'connect-src', 'frame-src']

const problems = []

/**
 * Load vercel.ts as the platform would for one target.
 *
 * A cache-busting query is appended because the module is imported once per
 * target and reads NEXORDER_ENV at module scope — without it every target after
 * the first would silently re-check the first one's config and pass.
 */
async function loadConfig(targetName) {
  process.env.NEXORDER_ENV = targetName
  const url = `${pathToFileURL(resolve(ROOT, 'vercel.ts')).href}?target=${targetName}`
  const mod = await import(url)
  return mod.config ?? mod.default
}

function directivesOf(csp) {
  /** @type {Record<string,string>} */
  const out = {}
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name) out[name.toLowerCase()] = values.join(' ')
  }
  return out
}

for (const [name, target] of Object.entries(TARGETS)) {
  if (!isProvisioned(target)) {
    console.log(`[check-csp] ${name}: not provisioned yet — skipping.`)
    continue
  }

  const config = await loadConfig(name)

  const cspHeader = config.headers
    ?.flatMap((entry) => entry.headers ?? [])
    ?.find((h) => /^content-security-policy(-report-only)?$/i.test(h.key))

  if (!cspHeader) {
    problems.push(`${name}: no Content-Security-Policy header in vercel.ts.`)
    continue
  }

  const directives = directivesOf(cspHeader.value)
  const host = target.supabaseUrl.replace(/^https:\/\//, '')

  for (const directive of REQUIRED_DIRECTIVES) {
    if (!(directive in directives)) {
      problems.push(
        `${name}: ${directive} is absent — CSP falls back to default-src, which is 'self' here.`,
      )
      continue
    }
    if (!directives[directive].includes(host)) {
      problems.push(`${name}: ${directive} does not allow ${host}.`)
    }
  }

  // Realtime uses a wss: origin, which is a separate CSP source from https:.
  if (!(directives['connect-src'] ?? '').includes(`wss://${host}`)) {
    problems.push(`${name}: connect-src does not allow wss://${host} — Realtime will be blocked.`)
  }

  // The /storage image proxy must be matched before the SPA catch-all.
  const sources = (config.rewrites ?? []).map((r) => r.source)
  const storageAt = sources.findIndex((s) => s.startsWith('/storage'))
  const catchAllAt = sources.findIndex((s) => s === '/(.*)')
  if (storageAt < 0) {
    problems.push(`${name}: no /storage rewrite — image URLs would not be proxied.`)
  } else if (catchAllAt >= 0 && storageAt > catchAllAt) {
    problems.push(
      `${name}: the /storage rewrite is ordered AFTER the SPA catch-all, so every image ` +
        `would be served index.html with a 200.`,
    )
  }

  console.log(`[check-csp] ${name}: OK (${host}, /storage rewrite at position ${storageAt}).`)
}

if (problems.length) {
  console.error('\n[check-csp] vercel.ts is wrong:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nvercel.ts derives all of this from config/environments.mjs — fix it there.\n')
  process.exit(1)
}

console.log('[check-csp] OK — every provisioned target has a correct CSP and image proxy.')
