// Where Nex Assistant is mounted, asserted on AppShell's source.
//
// A source assertion rather than a mount, like appShellStaffOrderingNav.test.ts:
// AppShell takes dozens of props and contexts and no test renders it. What can
// silently regress is the GATING (the lazy import declared ungated ships the chunk
// to a tenant without the module; a missing role test shows the mic to a Warehouse
// login) and the PLACEMENT (outside the relative content column, an absolute
// button lands somewhere else entirely).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'components/AppShell.tsx'), 'utf8')
const mainClose = src.indexOf('</main>')
const mountAt = src.indexOf('<VoiceAssistantLauncher')

describe('AppShell: Nex Assistant mount', () => {
  it('declares the lazy chunk behind the folded module constant', () => {
    expect(src).toContain(
      "const VoiceAssistantLauncher = MODULE_VOICE_ASSISTANT ? lazyWithRetry(() => import('./voice/VoiceAssistantLauncher')) : null;",
    )
    expect(src).toMatch(/import \{[^}]*\bMODULE_VOICE_ASSISTANT\b[^}]*\} from '\.\.\/lib\/modules'/)
  })

  it('mounts once, gated by the module, the chunk and canUseVoiceAssistant', () => {
    expect(src.split('<VoiceAssistantLauncher').length - 1).toBe(1)
    expect(src).toContain(
      '{MODULE_VOICE_ASSISTANT && VoiceAssistantLauncher && canUseVoiceAssistant(currentUser.role) && (',
    )
    expect(src).toContain("import { canUseVoiceAssistant } from '../lib/voice/canUseVoiceAssistant'")
  })

  it('sits right after the scroll container, still inside the relative column, in a null Suspense', () => {
    expect(mainClose).toBeGreaterThan(-1)
    expect(mountAt).toBeGreaterThan(mainClose)
    const between = src.slice(mainClose, mountAt)
    // Nothing closes the column between </main> and the mount.
    expect(between).not.toContain('</div>')
    expect(between).toContain('<Suspense fallback={null}>')
    const columnOpen = src.lastIndexOf('<div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">', mainClose)
    expect(columnOpen).toBeGreaterThan(-1)
  })

  it('passes the launcher its data props by their AppShell names', () => {
    const tagEnd = src.indexOf('/>', mountAt)
    const tag = src.slice(mountAt, tagEnd)
    for (const prop of [
      'currentUser={currentUser}',
      'currentUserUuid={currentUserUuid}',
      'allOrders={allOrders}',
      'products={products}',
      'hoReCas={hoReCas}',
      'salesTargets={salesTargets}',
      'visits={visits}',
      'routes={routes}',
      'appSettings={appSettings}',
    ]) {
      expect(tag).toContain(prop)
    }
  })
})
