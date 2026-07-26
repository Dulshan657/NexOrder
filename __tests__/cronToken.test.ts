import { describe, it, expect, afterEach } from 'vitest'
import {
  constantTimeEquals,
  isAuthorizedCronCall,
  isServiceRoleCall,
} from '../supabase/functions/_shared/cronToken'

const SERVICE_KEY = 'sb_secret_test_key_0123456789'

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  setEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
  setEnv('TEST_CRON_TOKEN', undefined)
})

describe('constantTimeEquals', () => {
  it('matches identical strings and rejects differing ones', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
    expect(constantTimeEquals('abc', 'abd')).toBe(false)
  })

  it('rejects on length mismatch without indexing past the end', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false)
    expect(constantTimeEquals('', 'a')).toBe(false)
  })
})

describe('isAuthorizedCronCall', () => {
  it('accepts the configured secret', () => {
    setEnv('TEST_CRON_TOKEN', 'tok-123')
    expect(isAuthorizedCronCall('Bearer tok-123', 'TEST_CRON_TOKEN')).toBe(true)
  })

  it('refuses every call when the secret is not configured', () => {
    expect(isAuthorizedCronCall('Bearer tok-123', 'TEST_CRON_TOKEN')).toBe(false)
  })
})

// send-email is `verify_jwt = false`, so this gate is the only thing standing
// between the internet and a function that mails real customers. Regressing it
// re-opens the hole documented in PRODUCTION-READINESS-AUDIT.md.
describe('isServiceRoleCall', () => {
  it('accepts a bearer token equal to the service-role key', () => {
    setEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    expect(isServiceRoleCall(`Bearer ${SERVICE_KEY}`)).toBe(true)
  })

  it('is case-insensitive on the scheme and tolerates extra whitespace', () => {
    setEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    expect(isServiceRoleCall(`bearer  ${SERVICE_KEY} `)).toBe(true)
  })

  it('rejects a missing, malformed, or non-bearer header', () => {
    setEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    expect(isServiceRoleCall(null)).toBe(false)
    expect(isServiceRoleCall('')).toBe(false)
    expect(isServiceRoleCall(SERVICE_KEY)).toBe(false)
    expect(isServiceRoleCall(`Basic ${SERVICE_KEY}`)).toBe(false)
  })

  it('rejects a different key — e.g. a browser sending the publishable key', () => {
    setEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    expect(isServiceRoleCall('Bearer sb_publishable_something_else')).toBe(false)
  })

  it('rejects a prefix of the real key rather than matching loosely', () => {
    setEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    expect(isServiceRoleCall(`Bearer ${SERVICE_KEY.slice(0, -1)}`)).toBe(false)
  })

  it('fails closed when the service-role key is absent from the environment', () => {
    expect(isServiceRoleCall(`Bearer ${SERVICE_KEY}`)).toBe(false)
  })
})
