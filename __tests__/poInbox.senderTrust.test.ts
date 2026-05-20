import { describe, it, expect } from 'vitest'

import { isSenderTrusted } from '../supabase/functions/_shared/poInbox/senderTrust'

describe('isSenderTrusted', () => {
  const trusted = ['orders@grandhotelsydney.com.au', 'reception@grandhotelsydney.com.au']

  it('trusts a sender whose exact address is in the set', () => {
    expect(isSenderTrusted('orders@grandhotelsydney.com.au', trusted)).toBe(true)
  })

  it('flags a sender whose address is not in the set (different mailbox, same company)', () => {
    expect(isSenderTrusted('chef@grandhotelsydney.com.au', trusted)).toBe(false)
  })

  it('flags a webmail sender that is not explicitly trusted', () => {
    expect(isSenderTrusted('grandhotelorders@gmail.com', trusted)).toBe(false)
  })

  it('is case- and whitespace-insensitive on both sides', () => {
    expect(isSenderTrusted('  Orders@GrandHotelSydney.COM.au ', trusted)).toBe(true)
    expect(isSenderTrusted('orders@grandhotelsydney.com.au', ['  ORDERS@grandhotelsydney.com.au'])).toBe(true)
  })

  it('never trusts a null/empty/undefined sender', () => {
    expect(isSenderTrusted(null, trusted)).toBe(false)
    expect(isSenderTrusted('', trusted)).toBe(false)
    expect(isSenderTrusted(undefined, trusted)).toBe(false)
    expect(isSenderTrusted('   ', trusted)).toBe(false)
  })

  it('flags when the trusted set is empty (brand-new customer, no known addresses)', () => {
    expect(isSenderTrusted('orders@grandhotelsydney.com.au', [])).toBe(false)
  })

  it('ignores null/empty entries in the trusted set', () => {
    expect(isSenderTrusted('orders@grandhotelsydney.com.au', [null, '', 'orders@grandhotelsydney.com.au'])).toBe(true)
    expect(isSenderTrusted('orders@grandhotelsydney.com.au', [null, ''])).toBe(false)
  })
})
