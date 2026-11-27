import { describe, expect, it } from 'vitest'
import { z } from 'zod/v3'

// mutate-app-settings strips any key its schema does not list, so a setting
// missing from it saves nothing and reverts on reload. The schema lives in a
// zod-free _shared module (the function imports zod from esm.sh, which vitest
// cannot load); this passes in the client's zod/v3, the same API.
//
// Loaded inside the test, not at the top: on the base commit the module does
// not exist, and a top-level import would stop the file loading at all.

describe('mutate-app-settings schema', () => {
  it('accepts putaway_ignore_capacity as a boolean', async () => {
    const { buildSettingsDataSchema } = await import('../supabase/functions/_shared/appSettingsBody')
    const schema = buildSettingsDataSchema(z as never)
    expect(schema.parse({ putaway_ignore_capacity: true })).toEqual({ putaway_ignore_capacity: true })
    expect(schema.parse({ putaway_ignore_capacity: false })).toEqual({ putaway_ignore_capacity: false })
    expect(schema.safeParse({ putaway_ignore_capacity: 'yes' }).success).toBe(false)
  })

  it('still strips a key it does not list and checks the ones it does', async () => {
    const { buildSettingsDataSchema } = await import('../supabase/functions/_shared/appSettingsBody')
    const schema = buildSettingsDataSchema(z as never)
    expect(schema.parse({ low_stock_threshold: 3, not_a_setting: 1 })).toEqual({ low_stock_threshold: 3 })
    expect(schema.safeParse({ carton_discount_percent: 90 }).success).toBe(false)
  })
})
