import { describe, expect, it } from 'vitest'

import {
  QR_MAX_ACTIVE_STAFF,
  canApproveHoreca,
  canManageHoreca,
  qrAccessActionAllowed,
  requireManageHoreca,
  type QrAccessCaller,
} from '@/supabase/functions/_shared/qrAccess'

/**
 * Who may manage a venue's QR access / decide its held orders. The same rule
 * serves both, so it is tested once, and the negative cases carry the weight:
 * a wrong "yes" here lets a rep who is not assigned approve another rep's
 * customer's order, or a kitchen login manage its own PINs.
 */

type Assignment = { horeca_id: number; rep_id: string }

/** The slice of supabase-js `canManageHoreca` touches: from().select().eq().eq().maybeSingle(). */
function fakeService(assignments: Assignment[], fail = false) {
  const queries: string[] = []
  const service = {
    from(table: string) {
      queries.push(table)
      const filters: Record<string, unknown> = {}
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val
          return builder
        },
        maybeSingle: async () => {
          if (fail) return { data: null, error: { message: 'boom' } }
          const hit = assignments.find(
            (a) => a.horeca_id === filters.horeca_id && a.rep_id === filters.rep_id,
          )
          return { data: hit ?? null, error: null }
        },
      }
      return builder
    },
  }
  return { service: service as never, queries }
}

const caller = (role: string, horecaId: number | null = null, userId = 'user-1'): QrAccessCaller => ({
  userId,
  role,
  profile: { horeca_id: horecaId },
})

describe('canManageHoreca', () => {
  it('lets Admin and Manager manage any venue without a lookup', async () => {
    const { service, queries } = fakeService([])
    expect(await canManageHoreca(service, caller('Admin'), 5)).toBe(true)
    expect(await canManageHoreca(service, caller('Manager'), 5)).toBe(true)
    expect(queries).toEqual([])
  })

  it('lets a Customer manage only the venue on their own profile', async () => {
    const { service } = fakeService([])
    expect(await canManageHoreca(service, caller('Restaurant/Hotel Customer', 5), 5)).toBe(true)
    expect(await canManageHoreca(service, caller('Restaurant/Hotel Customer', 5), 6)).toBe(false)
  })

  it('refuses a Customer with no venue, even for a nonsense venue id', async () => {
    const { service } = fakeService([])
    expect(await canManageHoreca(service, caller('Restaurant/Hotel Customer', null), 5)).toBe(false)
  })

  it.each(['Field Sales Rep', 'Office Sales Rep'])('lets %s manage only an assigned venue', async (role) => {
    const { service } = fakeService([{ horeca_id: 5, rep_id: 'rep-a' }])
    expect(await canManageHoreca(service, caller(role, null, 'rep-a'), 5)).toBe(true)
    expect(await canManageHoreca(service, caller(role, null, 'rep-a'), 6)).toBe(false)
    expect(await canManageHoreca(service, caller(role, null, 'rep-b'), 5)).toBe(false)
  })

  it('refuses Warehouse and QR Staff everywhere', async () => {
    const { service } = fakeService([{ horeca_id: 5, rep_id: 'user-1' }])
    expect(await canManageHoreca(service, caller('Warehouse', null), 5)).toBe(false)
    // A kitchen login must never manage its own PINs, even on its own venue
    // and even if an assignment row somehow named it.
    expect(await canManageHoreca(service, caller('QR Staff', 5), 5)).toBe(false)
  })

  it('refuses an unknown role', async () => {
    const { service } = fakeService([])
    expect(await canManageHoreca(service, caller('Superuser'), 5)).toBe(false)
    expect(await canManageHoreca(service, caller(''), 5)).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a malformed venue id %s even for Admin',
    async (id) => {
      const { service } = fakeService([])
      expect(await canManageHoreca(service, caller('Admin'), id)).toBe(false)
    },
  )

  it('throws rather than answering "no" when the assignment lookup fails', async () => {
    const { service } = fakeService([], true)
    await expect(canManageHoreca(service, caller('Field Sales Rep'), 5)).rejects.toMatchObject({
      code: 'INTERNAL',
    })
  })
})

describe('canApproveHoreca', () => {
  it('is the same rule as managing', () => {
    expect(canApproveHoreca).toBe(canManageHoreca)
  })
})

describe('requireManageHoreca', () => {
  it('resolves when allowed', async () => {
    const { service } = fakeService([])
    await expect(requireManageHoreca(service, caller('Admin'), 5)).resolves.toBeUndefined()
  })

  it('throws FORBIDDEN when not', async () => {
    const { service } = fakeService([])
    await expect(
      requireManageHoreca(service, caller('Restaurant/Hotel Customer', 9), 5),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})

describe('qrAccessActionAllowed -- mutate-qr-access role gate', () => {
  const MANAGE_ACTIONS = ['get', 'regenerate_code', 'create_staff', 'rename_staff', 'reset_pin', 'revoke_staff', 'unlock_code']
  const MANAGERS = ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep', 'Restaurant/Hotel Customer']

  it('lets a kitchen login call lock_self and nothing else', () => {
    expect(qrAccessActionAllowed('QR Staff', 'lock_self')).toBe(true)
    for (const action of MANAGE_ACTIONS) {
      expect(qrAccessActionAllowed('QR Staff', action), action).toBe(false)
    }
  })

  it('keeps lock_self for the kitchen alone', () => {
    for (const role of [...MANAGERS, 'Warehouse']) {
      expect(qrAccessActionAllowed(role, 'lock_self'), role).toBe(false)
    }
  })

  it('lets the managing roles run every management action', () => {
    for (const role of MANAGERS) {
      for (const action of MANAGE_ACTIONS) {
        expect(qrAccessActionAllowed(role, action), `${role} ${action}`).toBe(true)
      }
    }
  })

  it('refuses Warehouse, an unknown role, and an unknown action', () => {
    for (const action of MANAGE_ACTIONS) {
      expect(qrAccessActionAllowed('Warehouse', action), action).toBe(false)
      expect(qrAccessActionAllowed('', action), action).toBe(false)
      expect(qrAccessActionAllowed('Superuser', action), action).toBe(false)
    }
    expect(qrAccessActionAllowed('QR Staff', 'drop_everything')).toBe(false)
  })
})

describe('QR_MAX_ACTIVE_STAFF', () => {
  it('is fifty', () => {
    expect(QR_MAX_ACTIVE_STAFF).toBe(50)
  })
})
