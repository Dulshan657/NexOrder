import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The WIE engine must run in BOTH Deno edge functions and the Vite frontend, so
// every file under _shared/wie/ has to be pure TypeScript: no Deno globals, no
// URL/npm imports, and relative imports carry an explicit .ts extension (Deno
// requires it). This guard fails the build the moment an impurity sneaks in.

const WIE_DIR = join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'wie')

function wieFiles(): string[] {
  return readdirSync(WIE_DIR).filter((f) => f.endsWith('.ts'))
}

describe('_shared/wie purity', () => {
  it('has engine files to check', () => {
    expect(wieFiles().length).toBeGreaterThan(0)
  })

  for (const file of wieFiles()) {
    describe(file, () => {
      const src = readFileSync(join(WIE_DIR, file), 'utf8')

      it('uses no Deno globals', () => {
        expect(src).not.toMatch(/\bDeno\./)
      })

      it('uses no URL or npm imports', () => {
        expect(src).not.toMatch(/from\s+['"]https?:\/\//)
        expect(src).not.toMatch(/from\s+['"]npm:/)
        expect(src).not.toMatch(/from\s+['"]esm\.sh/)
      })

      it('gives every relative import a .ts extension', () => {
        const importRe = /from\s+['"](\.[^'"]+)['"]/g
        for (const match of src.matchAll(importRe)) {
          expect(match[1]).toMatch(/\.ts$/)
        }
      })

      it('does no obvious I/O', () => {
        expect(src).not.toMatch(/\bfetch\(/)
        expect(src).not.toMatch(/require\(/)
      })
    })
  }
})
