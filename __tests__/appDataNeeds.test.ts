import { describe, it, expect } from 'vitest'
import { appDataNeeds } from '@/lib/appDataNeeds'
import { UserRole } from '@/types'

describe('appDataNeeds', () => {
    it('Admin and Manager load everything', () => {
        for (const role of [UserRole.ADMIN, UserRole.MANAGER]) {
            expect(Object.values(appDataNeeds(role)).every(Boolean)).toBe(true)
        }
    })

    it('reps load everything except suppliers', () => {
        for (const role of [UserRole.FIELD_REP, UserRole.OFFICE_REP]) {
            const n = appDataNeeds(role)
            expect(n.suppliers).toBe(false)
            expect([n.invoices, n.promotions, n.routes, n.visits, n.users, n.salesTargets].every(Boolean)).toBe(true)
        }
    })

    it('a customer keeps invoices and promotions (pricing, overdue block) and drops the field-ops lists', () => {
        const n = appDataNeeds(UserRole.CUSTOMER)
        expect(n.invoices).toBe(true)
        expect(n.promotions).toBe(true)
        expect([n.suppliers, n.routes, n.visits, n.users, n.salesTargets].some(Boolean)).toBe(false)
    })

    it('QR Staff loads promotions for shop pricing and nothing else', () => {
        // Invoices are Customer-only under RLS (kitchen staff do not see them), and
        // like a Customer a QR Staff login reads only its own profile.
        const n = appDataNeeds(UserRole.QR_STAFF)
        expect(n.promotions).toBe(true)
        expect(n.invoices).toBe(false)
        expect([n.suppliers, n.routes, n.visits, n.users, n.salesTargets].some(Boolean)).toBe(false)
    })

    it('the warehouse role loads none of the seven', () => {
        expect(Object.values(appDataNeeds(UserRole.WAREHOUSE)).some(Boolean)).toBe(false)
    })
})
