import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LOCKED_TABLES } from '../../config/lockedTables.mjs'
import { FUNCTION_MODULES } from '../../config/moduleOwnership.mjs'

// NX-0029: what migration 00140 must say. Behaviour is proven in
// shortPick, pickBeyondReservation and releaseOwnReservation (*.integration.test.ts);
// this is the offline half, so the gate can run it fail-first. A missing file reads as
// empty, so on the base these fail by assertion rather than by a throw.

const migrationPath = (file: string): string => join(process.cwd(), 'supabase', 'migrations', file)
const MIGRATION = '00140_pick_differences.sql'
const HELPERS = [
  'inv_order_bin_remainder',
  'inv_others_bin_holdings',
  'inv_order_held_outside_warehouse',
  'inv_release_bin',
  'inv_assert_pick_location',
  'inv_pick_imported_line',
]

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
}

function read(file: string): string {
  return existsSync(migrationPath(file)) ? stripComments(readFileSync(migrationPath(file), 'utf-8')) : ''
}

/** Every function a migration creates, each with its own text up to the next one. */
function functionsIn(sql: string): Map<string, string> {
  const parts = sql.split(/(?=CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s)/i).slice(1)
  return new Map(
    parts.map((part) => {
      const name = /FUNCTION\s+public\.(\w+)\s*\(/i.exec(part)?.[1]
      return [name ?? part.slice(0, 40), part]
    }),
  )
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The text of a function's definition from `from` up to its closing dollar quote. */
function bodyFrom(fn: string | undefined, from: string): string {
  if (!fn || !fn.includes(from)) return ''
  const tail = fn.slice(fn.indexOf(from))
  return squash(tail.slice(0, tail.indexOf('$$')))
}

describe('short pick schema', () => {
  it('keeps pick_differences and inv_close_line_short away from client roles', () => {
    const sql = read(MIGRATION)

    expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public\.pick_differences\b/i)
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.pick_differences\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.pick_differences\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i)
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+SEQUENCE\s+public\.pick_differences_id_seq\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i)
    expect(sql).not.toMatch(/CREATE\s+POLICY/i)
    expect(sql).not.toMatch(/GRANT\s[^;]*\bTO\s[^;]*\b(anon|authenticated|PUBLIC)\b/i)

    const functions = functionsIn(sql)
    for (const name of ['inv_close_line_short', ...HELPERS]) {
      const text = functions.get(name)
      expect(text, name).toMatch(/SECURITY\s+DEFINER/i)
      expect(text, name).toMatch(/SET\s+search_path\s*=\s*public\b/i)
      expect(sql, name).toMatch(new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.${name}\([^)]*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;`, 'i'))
      expect(sql, name).toMatch(new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${name}\([^)]*\)\s+TO\s+service_role\s*;`, 'i'))
    }
    expect(functions.get('inv_close_line_short')).toMatch(
      /public\.inv_close_line_short\(\s*p_order_item_id\s+INT,\s*p_location_id\s+INT,\s*p_actor\s+UUID\s*\)\s*RETURNS\s+JSONB/i,
    )

    // supabase/migrate.mjs wraps the file; the integration tests run its text
    // inside a transaction they roll back. Its own BEGIN or COMMIT would break both.
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it('replaces the pick, release and completion functions with their existing signatures', () => {
    const sql = read(MIGRATION)
    const functions = functionsIn(sql)

    expect(functions.get('inv_release_reservation')).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.inv_release_reservation\(\s*p_order_id\s+TEXT,\s*p_location_id\s+INT\s+DEFAULT\s+NULL,\s*p_actor\s+UUID\s+DEFAULT\s+NULL\s*\)\s*RETURNS\s+VOID/i,
    )
    expect(functions.get('inv_pick_order_line')).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.inv_pick_order_line\(\s*p_order_item_id\s+INT,\s*p_picked_qty\s+NUMERIC,\s*p_location_id\s+INT\s+DEFAULT\s+NULL,\s*p_actor\s+UUID\s+DEFAULT\s+NULL\s*\)\s*RETURNS\s+JSONB/i,
    )
    expect(functions.get('inv_warehouse_pick_complete')).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.inv_warehouse_pick_complete\(\s*p_order_id\s+TEXT,\s*p_warehouse_id\s+INT\s*\)\s*RETURNS\s+BOOLEAN\s+LANGUAGE\s+plpgsql\s+STABLE/i,
    )
    expect(functions.get('qb_update_invoice_tx')).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.qb_update_invoice_tx\(\s*p_invoice_number\s+TEXT,\s*p_horeca_id\s+INT,\s*p_invoice_date\s+DATE,\s*p_lines\s+JSONB,\s*p_actor\s+UUID,\s*p_location_pref\s+INT\[\]\s*\)\s*RETURNS\s+JSONB/i,
    )
    // A changed signature leaves the old function behind as an overload, and an
    // RPC call then fails as ambiguous: the trap at record-pick/index.ts:296.
    expect(sql).not.toMatch(/DROP\s+FUNCTION/i)
  })

  it('applies the new pick and completion rules to imported orders only', () => {
    const functions = functionsIn(read(MIGRATION))
    const pick = functions.get('inv_pick_order_line') ?? ''
    const complete = functions.get('inv_warehouse_pick_complete') ?? ''

    // Both turn on the invoice number, and pick_differences is reached only behind it.
    expect(pick).toMatch(/qb_invoice_number/)
    expect(pick).toMatch(/IF\s+v_invoice\s+IS\s+NOT\s+NULL\s+THEN\s+RETURN\s+public\.inv_pick_imported_line\(/i)
    expect(pick).not.toMatch(/pick_differences/)
    expect(complete).toMatch(/IF\s+\(\s*SELECT\s+o\.qb_invoice_number[\s\S]*IS\s+NOT\s+NULL\s+THEN[\s\S]*pick_differences/i)

    // Every other order runs the previous text, whitespace aside. Compared with the
    // migrations those paths last lived in, so a drift cannot be written off as a
    // rewrite that behaves the same.
    const oldPick = functionsIn(read('00075_handling_units.sql')).get('inv_pick_order_line')
    const oldComplete = functionsIn(read('00040_wms_directed.sql')).get('inv_warehouse_pick_complete') ?? ''
    const pickStart = 'v_factor := COALESCE(v_item.pack_size, 1);'
    expect(bodyFrom(oldPick, pickStart).length).toBeGreaterThan(500)
    expect(bodyFrom(pick, pickStart)).toBe(bodyFrom(oldPick, pickStart))

    const loopStart = 'FOR r IN'
    const oldLoop = bodyFrom(oldComplete, loopStart).split('END LOOP;')[0]
    expect(oldLoop.length).toBeGreaterThan(300)
    expect(squash(complete)).toContain(oldLoop)
  })

  it('serialises an imported pick with a close: it reads the status under the order lock', () => {
    // A text check, because the behaviour cannot be pinned on this suite's terms. It needs a
    // second session to block on the order row, and a second session cannot see an order
    // created in a transaction that is never committed.
    const pick = functionsIn(read(MIGRATION)).get('inv_pick_imported_line') ?? ''
    expect(pick).toMatch(/SELECT\s+o\.status\s+INTO\s+v_status\s+FROM\s+public\.orders\s+o\s+WHERE\s+o\.id\s*=\s*v_item\.order_id\s+FOR\s+UPDATE\s*;/i)
    expect(pick.indexOf('FOR UPDATE')).toBeLessThan(pick.indexOf('pick_differences'))
  })

  it('indexes pick_differences by line and by bin', () => {
    const sql = read(MIGRATION)
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+public\.pick_differences\s*\(\s*order_item_id\s*\)\s*;/i)
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+public\.pick_differences\s*\(\s*location_id\s*\)\s*;/i)
  })

  it('locks pick_differences and assigns record-short-pick to inventory_dispatch', () => {
    const entry = (LOCKED_TABLES as Array<{ table: string; fn: string; migration: string }>).find(
      (e) => e.table === 'pick_differences',
    )
    expect(entry).toEqual({ table: 'pick_differences', fn: 'record-short-pick / record-pick', migration: '00140' })
    expect((FUNCTION_MODULES as Record<string, string>)['record-short-pick']).toBe('inventory_dispatch')
    expect(existsSync(join(process.cwd(), 'supabase', 'functions', 'record-short-pick', 'index.ts'))).toBe(true)
  })
})
