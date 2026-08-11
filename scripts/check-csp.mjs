#!/usr/bin/env node
// Assert vercel.json's CSP covers every provisioned environment.
//
//   node scripts/check-csp.mjs
//
// `vercel.json` is static JSON — it cannot import config/environments.mjs, and
// one file serves both the Production and Preview environments of the single
// Vercel project. So the Supabase hosts are written out by hand, and this
// script is what stops that hand-maintained copy from drifting.
//
// The specific failure it exists to prevent: the Sydney project gets created,
// its ref never makes it into the CSP, and the omission is invisible while the
// policy is Report-Only (Phase B promotes it to enforcing, at which point every
// image, every realtime socket and every PDF preview breaks at once).
//
// `frame-src` is checked because it was missing entirely — with no frame-src,
// CSP falls back to default-src 'self', which would have broken the PO Inbox
// document preview (POInboxDetailModal) and the document viewer the moment the
// policy went enforcing.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { TARGETS, isProvisioned } from '../config/environments.mjs'
import { ROOT } from './lib/env.mjs'

const REQUIRED_DIRECTIVES = ['img-src', 'connect-src', 'frame-src']

const vercelJson = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'))

const cspHeader = vercelJson.headers
  ?.flatMap((entry) => entry.headers ?? [])
  ?.find((h) => /^content-security-policy(-report-only)?$/i.test(h.key))

if (!cspHeader) {
  console.error('[check-csp] No Content-Security-Policy header found in vercel.json.')
  process.exit(1)
}

/** @type {Record<string,string>} */
const directives = {}
for (const part of cspHeader.value.split(';')) {
  const [name, ...values] = part.trim().split(/\s+/)
  if (name) directives[name.toLowerCase()] = values.join(' ')
}

const problems = []

for (const directive of REQUIRED_DIRECTIVES) {
  if (!(directive in directives)) {
    problems.push(
      `${directive} is absent — CSP falls back to default-src, which is 'self' here.`,
    )
  }
}

for (const [name, config] of Object.entries(TARGETS)) {
  if (!isProvisioned(config)) {
    console.log(`[check-csp] ${name}: not provisioned yet — skipping.`)
    continue
  }
  const host = config.supabaseUrl.replace(/^https:\/\//, '')
  for (const directive of REQUIRED_DIRECTIVES) {
    const value = directives[directive] ?? ''
    if (!value.includes(host)) {
      problems.push(`${directive} does not allow ${host} (environment "${name}").`)
    }
  }
  // Realtime uses a wss: origin, which is a separate CSP source from https:.
  if (!(directives['connect-src'] ?? '').includes(`wss://${host}`)) {
    problems.push(`connect-src does not allow wss://${host} (environment "${name}") — Realtime will be blocked.`)
  }
}

if (problems.length) {
  console.error('[check-csp] vercel.json CSP is out of date:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nEdit the CSP value in vercel.json to match config/environments.mjs.\n')
  process.exit(1)
}

console.log('[check-csp] OK — CSP covers every provisioned environment.')
