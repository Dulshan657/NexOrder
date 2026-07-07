// Apply a .sql file (or inline --query) to Supabase via the Management API.
// Works on this Windows box where the direct DB host is unresolvable.
//
//   node supabase/apply-sql.mjs supabase/migrations/00042_tenant_scoping.sql
//   node supabase/apply-sql.mjs --query "SELECT tenant, count(*) FROM products GROUP BY 1"
//
// Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (fallback to the known ref)
// from .env.local / the environment.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..') // NexOrder/

function loadEnv() {
  const env = { ...process.env }
  try {
    const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = v
    }
  } catch {
    /* rely on process.env */
  }
  return env
}

const ENV = loadEnv()
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN
const REF = ENV.SUPABASE_PROJECT_REF || 'lsgkznyiabqitqfpveey'

if (!TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (set in NexOrder/.env.local).')
  process.exit(1)
}

const args = process.argv.slice(2)
let query
const qIdx = args.indexOf('--query')
if (qIdx !== -1) {
  query = args[qIdx + 1]
} else {
  const file = args.find(a => !a.startsWith('--'))
  if (!file) {
    console.error('Usage: node supabase/apply-sql.mjs <file.sql> | --query "<sql>"')
    process.exit(1)
  }
  query = readFileSync(resolve(file), 'utf8')
}

const resp = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})

const text = await resp.text()
if (!resp.ok) {
  console.error(`HTTP ${resp.status}: ${text}`)
  process.exit(1)
}
console.log(text || '(ok, no rows returned)')
