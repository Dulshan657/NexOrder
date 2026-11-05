import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LOCKED_TABLES } from '../../config/lockedTables.mjs'
import { FUNCTION_MODULES } from '../../config/moduleOwnership.mjs'

// NX-0031: what must hold about the own-product columns and the function's
// ownership. A missing file reads as empty, so on the base these fail by assertion.

const read = (...parts: string[]): string => {
  const path = join(process.cwd(), ...parts)
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

const stripComments = (sql: string): string => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

const MIGRATION = ['supabase', 'migrations', '00141_qb_import_settings.sql']
const FUNCTION = ['supabase', 'functions', 'import-qb-invoices', 'index.ts']

describe('import po schema', () => {
  it('stores the own-product rule without a new client write path', () => {
    const sql = stripComments(read(...MIGRATION))

    for (const column of ['qb_own_product_prefixes', 'qb_own_product_terms']) {
      expect(sql, column).toMatch(
        new RegExp(String.raw`ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?${column}\s+TEXT\[\]\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'`, 'i'),
      )
      expect(read('supabase', 'functions', 'mutate-app-settings', 'index.ts'), column).not.toContain(column)
    }
    expect(sql).not.toMatch(/\bGRANT\b/i)
    expect(sql).not.toMatch(/\bCREATE\s+POLICY\b/i)
    expect(sql).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i)
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)

    expect((LOCKED_TABLES as Array<{ table: string }>).some((entry) => entry.table === 'app_settings')).toBe(true)
  })

  it('assigns import-qb-invoices to sales_orders', () => {
    expect((FUNCTION_MODULES as Record<string, string>)['import-qb-invoices']).toBe('sales_orders')
    expect(read(...FUNCTION)).toMatch(/requireModule\('sales_orders'\)/)
  })

  it('does not place an order, write an invoice or send email from the function', () => {
    const sources = [
      read(...FUNCTION),
      read('supabase', 'functions', '_shared', 'qbImport', 'importDeps.ts'),
      read('supabase', 'functions', '_shared', 'qbImport', 'runImport.ts'),
    ]
    expect(sources.every((source) => source.length > 0)).toBe(true)
    for (const source of sources) {
      const code = source.replace(/\/\/[^\n]*/g, '')
      expect(code).not.toMatch(/place-order|placeOrderCore|send-email/)
      expect(code).not.toMatch(/from\('invoices'\)/)
    }
  })
})
