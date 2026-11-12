// NX-0035 A1/A2: the 3D view is a module of its own, and is NOT SHIPPED where off.
//
// A source assertion, like voiceAssistantMount.test.ts: "not shipped" is proven
// by building and grepping dist/ (a manual acceptance row); what can silently
// regress in a unit test is the GATE — a lazy import declared ungated ships
// three.js to a tenant that never bought it.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { ALL_MODULES, MODULE_REQUIRES, TARGETS } from '../../config/environments.mjs'

const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

describe('warehouse_3d module', () => {
  it('requires inventory_dispatch and is enabled on dev only', () => {
    expect(ALL_MODULES).toContain('warehouse_3d')
    expect((MODULE_REQUIRES as Record<string, string[]>).warehouse_3d).toEqual(['inventory_dispatch'])
    const enabledOn = Object.entries(TARGETS as Record<string, { modules: string[] }>)
      .filter(([, t]) => t.modules.includes('warehouse_3d'))
      .map(([name]) => name)
    expect(enabledOn).toEqual(['dev'])
    // Amadiya's set is untouched by this change.
    expect((TARGETS as any).amadiya.modules).toEqual(['sales_orders', 'inventory_dispatch'])
  })

  it('is mirrored in the Edge Functions module vocabulary', () => {
    expect(read('supabase/functions/_shared/modules.ts')).toContain("'warehouse_3d'")
  })
})

const THREE_DIR = 'components/inventory/warehouse/three'

function threeSources(): { file: string; src: string }[] {
  const dir = resolve(root, THREE_DIR)
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: join(THREE_DIR, f), src: readFileSync(join(dir, f), 'utf8') }))
}

describe('3D lazy gate', () => {
  it('declares the 3D view only behind MODULE_WAREHOUSE_3D', () => {
    const lazy = read(`${THREE_DIR}/lazy3d.ts`)
    expect(lazy).toContain(
      "export const Warehouse3DView = MODULE_WAREHOUSE_3D ? lazyWithRetry(() => import('./Warehouse3DView')) : null",
    )
    expect(lazy).toMatch(/import \{[^}]*\bMODULE_WAREHOUSE_3D\b[^}]*\} from '@\/lib\/modules'/)

    // No other file outside three/ may import the view (or three itself)
    // directly — that would put it in an eager chunk.
    const workspace = read('components/inventory/warehouse/RackedWorkspace.tsx')
    expect(workspace).not.toMatch(/from '\.\/three\/Warehouse3DView'/)
    expect(workspace).not.toMatch(/from 'three'|from '@react-three\//)
    expect(workspace).toMatch(/from '\.\/three\/lazy3d'/)
  })

  it('imports nothing from drei outside the allow-list', () => {
    // CameraControls, Html and Line need no CDN, worker or eval. Text/Text3D
    // (troika), Environment presets (CDN HDRI), useGLTF/Draco/KTX2 (CDN
    // decoders) would all break under script-src 'self'.
    const ALLOWED = new Set(['CameraControls', 'Html', 'Line'])
    const seen: string[] = []
    for (const { file, src } of threeSources()) {
      for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@react-three\/drei'/g)) {
        for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
          seen.push(name)
          expect(ALLOWED.has(name), `${file} imports ${name} from drei`).toBe(true)
        }
      }
      expect(src, `${file} must import named drei exports only`).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+'@react-three\/drei'/)
    }
    expect(seen.length).toBeGreaterThan(0)
  })
})
