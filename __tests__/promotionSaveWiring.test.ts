// NX-0024: every promotion save failed from 2026-04-29 because the function and the app
// disagreed on the id and on created_by, and nothing ran them together. The function cannot
// be loaded here (it imports from esm.sh and starts a server), so these read the source.
// The browser walk in the brief's FINAL is what proves the saves.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

const FUNCTION = 'supabase/functions/mutate-promotion/index.ts'

describe('promotion saving', () => {
  it('the server sets id and created_by itself', () => {
    const code = source(FUNCTION)
    expect(code).toContain('id: crypto.randomUUID()')
    expect(code).toContain('created_by: auth.userId')
  })

  it('the function no longer requires a UUID id', () => {
    const code = source(FUNCTION)
    expect(code).not.toContain('.uuid()')
    expect(code).toContain('buildPromotionInputSchema(z)')
  })

  it("a refused save reports the server's reason", () => {
    const code = source('services/supabase/promotionDbService.ts')
    // Create, update and delete. The read-only list keeps its plain error.
    expect(code.split('throw new Error(await extractFunctionErrorMessage(error, REFUSED))')).toHaveLength(4)
  })

  it('the form stays open when a save is refused', () => {
    const admin = source('components/PromotionAdmin.tsx')
    expect(admin).toContain('await onAdd(promo)')
    expect(admin).toContain('await onUpdate(promo)')

    const form = source('components/PromotionForm.tsx')
    expect(form).toContain('await onSave(promo)')
    expect(form).toContain('promotionProblem(')
    expect(source(FUNCTION)).toContain('promotionProblem(')
  })

  it('delete asks first', () => {
    const admin = source('components/PromotionAdmin.tsx')
    expect(admin).toContain('<ConfirmDialog')
    expect(admin).not.toContain('onClick={() => onDelete(promo.id)}')
  })

  it('the used-on-orders check is skipped only for an on or off change, and never for a delete', () => {
    const code = source(FUNCTION)
    expect(code).toContain('if (!isOnOffOnly(d)) await assertNotUsedInOrders(admin, input.id)')
    expect(code.split('await assertNotUsedInOrders(admin, input.id)')).toHaveLength(3)
    expect(source('components/PromotionAdmin.tsx')).toContain('onUpdate({ id: promo.id, isActive: !promo.isActive })')
  })
})
