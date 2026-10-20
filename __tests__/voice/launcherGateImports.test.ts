// AppShell imports canUseVoiceAssistant STATICALLY, so everything that file
// reaches lands in the entry chunk and ships whether or not the tenant has
// voice_assistant. It once reached toolSchemas.ts (ten module-level defineTool
// calls Rollup cannot drop), which put the whole tool contract in index-*.js on a
// build with the module off. This walks the VALUE imports (type-only imports are
// erased) from the gate and pins that it reaches roles.ts and nothing voice-y.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const GATE = resolve(ROOT, 'lib/voice/canUseVoiceAssistant.ts')
const ROLES = resolve(ROOT, 'supabase/functions/_shared/voice/roles.ts')

/** Value-import specifiers of a file: `import x from`, `import {..} from`, `export .. from`, side-effect imports. */
function valueImports(file: string): string[] {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const specs: string[] = []
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm
  for (const m of src.matchAll(re)) {
    if (m[5]) specs.push(m[5])
    else if (!m[2]) specs.push(m[4])
  }
  return specs
}

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? resolve(ROOT, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate
  }
  throw new Error(`cannot resolve ${spec} from ${from}`)
}

function reachable(entry: string): string[] {
  const seen = new Set<string>([entry])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    for (const spec of valueImports(file)) {
      const target = resolveSpec(file, spec)
      if (target && !seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
  }
  return [...seen].map((f) => relative(ROOT, f).replace(/\\/g, '/'))
}

describe('launcher gate imports', () => {
  it('roles.ts imports nothing', () => {
    expect(valueImports(ROLES)).toEqual([])
    expect(readFileSync(ROLES, 'utf8')).not.toMatch(/^\s*import\s/m)
  })

  it('canUseVoiceAssistant reaches roles.ts and never toolSchemas.ts', () => {
    const graph = reachable(GATE)
    expect(graph).toContain('supabase/functions/_shared/voice/roles.ts')
    expect(graph.some((f) => f.endsWith('toolSchemas.ts'))).toBe(false)
    expect(graph.sort()).toEqual(['lib/voice/canUseVoiceAssistant.ts', 'supabase/functions/_shared/voice/roles.ts'])
  })

  it('the walker sees a real dependency: toolSchemas reaches roles', () => {
    // Guards the guard: if the parser stopped finding imports, the test above
    // would pass vacuously.
    const graph = reachable(resolve(ROOT, 'supabase/functions/_shared/voice/toolSchemas.ts'))
    expect(graph).toContain('supabase/functions/_shared/voice/roles.ts')
  })

  it('toolSchemas still re-exports the role lists for its existing importers', async () => {
    const schemas = await import('@/supabase/functions/_shared/voice/toolSchemas')
    const roles = await import('@/supabase/functions/_shared/voice/roles')
    expect(schemas.VOICE_ROLES).toBe(roles.VOICE_ROLES)
    expect(schemas.REP_ROLES).toBe(roles.REP_ROLES)
  })
})
