/**
 * Minimal .env.dev.local loader for integration tests (no `dotenv` dependency).
 *
 * Reads NexOrder/.env.dev.local and copies any keys that are not already present
 * in process.env. Used as a vitest `setupFiles` entry for the integration config
 * so the live-DB test can read SUPABASE_DB_PASSWORD / SUPABASE_PROJECT_REF
 * without the operator having to export them by hand. Values are never logged.
 *
 * DEV ONLY, asserted below. The integration suite writes to whatever database it
 * is pointed at; against the client's project that is data loss, so a prod URL
 * here is a hard failure rather than something the suite tries to cope with.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENVIRONMENTS } from '../../config/environments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__/support -> project root (NexOrder/)
const ENV_PATH = resolve(here, '..', '..', '.env.dev.local');

function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

try {
  const parsed = parseEnv(readFileSync(ENV_PATH, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // No .env.dev.local (e.g. CI) — the integration test self-skips when creds are absent.
}

// Fail closed if anything pointed this suite at production.
const prodUrl = ENVIRONMENTS.prod.supabaseUrl;
const prodRef = ENVIRONMENTS.prod.projectRef;
const loadedUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const loadedRef = process.env.SUPABASE_PROJECT_REF ?? '';

if ((prodUrl && loadedUrl.startsWith(prodUrl)) || (prodRef && loadedRef === prodRef)) {
  throw new Error(
    'The integration suite is pointed at the PRODUCTION Supabase project. ' +
      'It writes to the database it connects to. Refusing to run.',
  );
}
