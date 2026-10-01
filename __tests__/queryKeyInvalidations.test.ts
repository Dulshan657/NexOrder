import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// TanStack Query invalidates by element-wise array PREFIX, so an
// invalidation whose first element names no query refreshes nothing and
// fails silently. Five stock-moving hooks invalidated 'inventory-balances' /
// 'inventoryBalances' / 'inventory' for months while the real key was
// 'inventory_balances' — balances only refreshed when the realtime channel
// happened to fire, and that channel is staff-only.
//
// This guard collects every string-literal key ROOT used to DEFINE a query
// (key factories and `queryKey:` outside an invalidate call) and asserts
// every literal-rooted invalidation names one of them.

const ROOT = join(__dirname, '..')
const SCAN_DIRS = ['hooks', 'components', 'context', 'views', 'lib']

function walk(dir: string): string[] {
  let out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
const INVALIDATE = /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*'([^']+)'/g
const ROOT_LITERAL = /\[\s*'([a-zA-Z_][\w-]*)'/g
// Realtime handlers hand key lists to the batcher: schedule([['orders'], ...]).
const SCHEDULE = /schedule\(\s*\[((?:\s*\[[^\]]*\]\s*,?)+)\]\s*\)/g

function definedRoots(): Set<string> {
  const roots = new Set<string>()
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/invalidateQueries|removeQueries|cancelQueries|refetchQueries/.test(line)) continue
      if (!/queryKey|as const/.test(line)) continue
      for (const m of line.matchAll(ROOT_LITERAL)) roots.add(m[1])
    }
  }
  return roots
}

describe('query key invalidations', () => {
  const roots = definedRoots()

  it('finds query key definitions to check against', () => {
    expect(roots.has('inventory_balances')).toBe(true)
    expect(roots.has('orders')).toBe(true)
  })

  it('sees the realtime batcher keys', () => {
    const src = readFileSync(join(ROOT, 'hooks', 'useRealtimeSubscriptions.ts'), 'utf8')
    expect([...src.matchAll(SCHEDULE)].length).toBeGreaterThan(5)
  })

  it('every literal-rooted invalidation targets a key some query defines', () => {
    const dead: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const where = (i: number | undefined) => `${relative(ROOT, file)}:${src.slice(0, i).split('\n').length}`
      for (const m of src.matchAll(INVALIDATE)) {
        if (!roots.has(m[1])) dead.push(`${where(m.index)} → ['${m[1]}']`)
      }
      for (const m of src.matchAll(SCHEDULE)) {
        for (const k of m[1].matchAll(ROOT_LITERAL)) {
          if (!roots.has(k[1])) dead.push(`${where(m.index)} → ['${k[1]}']`)
        }
      }
    }
    expect(dead).toEqual([])
  })
})
