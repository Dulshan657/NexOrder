// How AppShell wires the "Not approved" feature. A source assertion rather than a
// mount, for the reason appShellStaffOrderingNav.test.ts gives: AppShell takes
// dozens of props and contexts and no test here renders it. What can silently
// regress is GATING and WIRING, and both are visible in the source:
//
//   - the live toasts run for kitchen staff only, and only on a build with the Shop;
//   - a rejection's bell entry has a way to Order home, and only for kitchen staff;
//   - order history is given the resend callback, for kitchen staff only.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'components/AppShell.tsx'), 'utf8')

describe('AppShell: QR decisions', () => {
  it('mounts the decision toasts behind MODULE_SHOP, enabled for QR Staff only, on the shell\'s own notifications', () => {
    const at = src.indexOf('useQrDecisionToasts({')
    expect(at).toBeGreaterThan(-1)
    // The call sits in a MODULE_SHOP branch, so a tenant without the Shop never bundles the hook.
    const before = src.slice(Math.max(0, at - 160), at)
    expect(before).toMatch(/MODULE_SHOP/)

    const call = src.slice(at, src.indexOf('})', at) + 2)
    expect(call).toMatch(/enabled:\s*isQrStaff/)
    expect(call).toMatch(/notifications:\s*userNotifications/)
    expect(call).toMatch(/addToast/)
  })

  it('waits for the notification list to load before it takes its baseline', () => {
    const call = src.slice(src.indexOf('useQrDecisionToasts({'), src.indexOf('useQrDecisionToasts({') + 400)
    expect(call).toMatch(/ready:/)
    expect(call).toMatch(/notifications/)
  })

  it('opens Order home from a rejection\'s bell entry, for kitchen staff only', () => {
    const bell = src.slice(src.indexOf('<NotificationCenter'), src.indexOf('/>', src.indexOf('<NotificationCenter')))
    expect(bell).toMatch(/onOpenKitchen=\{isQrStaff\s*\?\s*\(\)\s*=>\s*setView\('kitchen'\)\s*:\s*undefined\}/)
  })

  it('gives order history the resend callback for kitchen staff only', () => {
    const history = src.slice(src.indexOf('<OrdersHistoryView'), src.indexOf('/>', src.indexOf('<OrdersHistoryView')))
    expect(history).toMatch(/onResendQrRequest=\{isQrStaff/)
  })

  it('passes a resent order\'s notes and delivery on to the cart, and plain "Edit before ordering" none', () => {
    const at = src.indexOf('const handleEditKitchenItems = useCallback(')
    expect(at).toBeGreaterThan(-1)
    const def = src.slice(at, src.indexOf('[handleReorderItems', at))
    // Optional second argument, forwarded as handleReorderItems' third: absent for a plain edit.
    expect(def).toMatch(/\(items: OrderItem\[\], details\?: ReorderDetails\)/)
    expect(def).toMatch(/handleReorderItems\(items, 'replace', details\)/)

    // The resend hook is handed the same function, so its details reach the cart.
    expect(src).toMatch(/onEditItems: handleEditKitchenItems,/)
  })

  it('keeps the history section chunk out of a build without the Shop', () => {
    // The lazy import() runs at module scope, so the gate must be on the DECLARATION.
    const history = readFileSync(resolve(process.cwd(), 'components/OrderHistory.tsx'), 'utf8')
    const decl = history.split(/\r?\n/).find((l) => /const DecidedQrRequests\s*=/.test(l))
    expect(decl).toBeTruthy()
    expect(decl).toMatch(/MODULE_SHOP \? lazyWithRetry\(\(\) => import\('\.\/qr\/DecidedQrRequests'\)\) : null/)

    // AppShell must not declare it (or the home card) a second time ungated.
    for (const line of src.split(/\r?\n/)) {
      if (/lazyWithRetry\(.*(NotApprovedCard|DecidedQrRequests)/.test(line)) expect(line).toMatch(/MODULE_SHOP \?/)
    }
  })
})
