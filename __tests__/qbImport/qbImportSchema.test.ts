import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LOCKED_TABLES } from '../../config/lockedTables.mjs'

// NX-0025: what migration 00139 must say about who can touch the import tables
// and transactions. SQL behaviour is proven in qbImportTx.integration.test.ts;
// this is the offline half, so the gate can run it fail-first. A missing file
// reads as empty, so on the base these fail by assertion rather than by a throw.

const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '00139_qb_invoice_import.sql')
const TABLES = ['qb_product_map', 'qb_invoice_imports']
const TRANSACTIONS = ['qb_import_invoice_tx', 'qb_update_invoice_tx']
const HELPERS = ['qb_release_own_allocation', 'qb_validate_invoice_input', 'qb_write_order_lines', 'qb_lines_total', 'qb_sync_fulfilments']

/** The migration with comments removed, so prose can neither satisfy nor trip a check. */
function migrationSql(): string {
  if (!existsSync(MIGRATION)) return ''
  return readFileSync(MIGRATION, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

/** Every function the migration creates, each with its own text up to the next one. */
function functionsIn(sql: string): Map<string, string> {
  const parts = sql.split(/(?=CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s)/i).slice(1)
  return new Map(
    parts.map((part) => {
      const name = /FUNCTION\s+public\.(\w+)\s*\(/i.exec(part)?.[1]
      return [name ?? part.slice(0, 40), part]
    }),
  )
}

describe('qb import schema', () => {
  it('locks both import tables in the grant check', () => {
    for (const table of TABLES) {
      const entry = (LOCKED_TABLES as Array<{ table: string; fn: string; migration: string }>).find(
        (e) => e.table === table,
      )
      expect(entry, table).toEqual({ table, fn: 'import-qb-invoices', migration: '00139' })
    }
  })

  it("keeps the migration's tables and transactions away from client roles", () => {
    const sql = migrationSql()

    for (const table of TABLES) {
      expect(sql, table).toMatch(new RegExp(String.raw`CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public\.${table}\b`, 'i'))
      expect(sql, table).toMatch(new RegExp(String.raw`ALTER\s+TABLE\s+public\.${table}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`, 'i'))
      expect(sql, table).toMatch(new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+public\.${table}\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;`, 'i'))
    }
    expect(sql).not.toMatch(/CREATE\s+POLICY/i)

    const functions = functionsIn(sql)
    for (const name of [...TRANSACTIONS, ...HELPERS]) expect([...functions.keys()], name).toContain(name)
    for (const [name, text] of functions) {
      expect(text, name).toMatch(/SECURITY\s+DEFINER/i)
      expect(text, name).toMatch(/SET\s+search_path\s*=\s*public\b/i)
      expect(sql, name).toMatch(new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.${name}\([^)]*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;`, 'i'))
      expect(sql, name).toMatch(new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${name}\([^)]*\)\s+TO\s+service_role\s*;`, 'i'))
    }
    expect(sql).not.toMatch(/GRANT\s[^;]*\bTO\s[^;]*\b(anon|authenticated|PUBLIC)\b/i)

    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX[^;]*public\.orders\s*\(\s*qb_invoice_number\s*\)\s*WHERE\s+qb_invoice_number\s+IS\s+NOT\s+NULL/i)

    // supabase/migrate.mjs wraps the file; the integration test runs its text
    // inside a transaction it rolls back. Its own BEGIN or COMMIT would break both.
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it('writes no invoice and uses no product-wide release', () => {
    const sql = migrationSql()
    const functions = functionsIn(sql)

    for (const name of TRANSACTIONS) expect([...functions.keys()], name).toContain(name)
    expect(sql).not.toMatch(/\binvoices\b/i)
    expect(sql).not.toMatch(/\binv_release_reservation\b/i)
    expect(functions.get('qb_update_invoice_tx')).toMatch(/\bqb_release_own_allocation\s*\(/)
  })
})
