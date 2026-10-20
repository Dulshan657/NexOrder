import { describe, it, expect } from 'vitest'
import { mkHoReCa } from '../fixtures'
import { findCustomer } from '../../lib/voice/findCustomer'

const venues = [
  mkHoReCa({ id: 1, name: 'Harbour Cafe', address: '1 Wharf Rd' }),
  mkHoReCa({ id: 2, name: 'Harbour Bistro', address: '2 Wharf Rd' }),
  mkHoReCa({ id: 3, name: 'Bayside Bistro', address: '3 Beach St' }),
  mkHoReCa({ id: 4, name: 'Grove Restaurant Pty Ltd', address: '4 Park Ave' }),
  mkHoReCa({ id: 5, name: "O'Brien's Pub", address: '5 High St' }),
]

describe('findCustomer', () => {
  describe('exact, partial and no match', () => {
    it('scores an exact name 100 whatever the case or punctuation', () => {
      const got = findCustomer('  BAYSIDE, bistro!! ', venues)
      expect(got.candidates[0]).toMatchObject({ id: 3, name: 'Bayside Bistro', address: '3 Beach St', score: 100 })
      expect(got.ambiguous).toBe(false)
    })

    it('scores a name that starts with the query 80', () => {
      const got = findCustomer('bayside', venues)
      expect(got.candidates).toEqual([{ id: 3, name: 'Bayside Bistro', address: '3 Beach St', score: 80 }])
    })

    it('scores a name that merely contains the query 60', () => {
      const got = findCustomer('bistro', venues)
      // Equal on every score, so the name decides: Bayside before Harbour.
      expect(got.candidates.map((c) => [c.id, c.score])).toEqual([[3, 60], [2, 60]])
    })

    it('scores word overlap by the share of the spoken words found', () => {
      // Two of three words are in the name: 2/3 x 50 = 33, over the 30 floor.
      const got = findCustomer('bayside bistro sydney', venues)
      expect(got.candidates).toEqual([{ id: 3, name: 'Bayside Bistro', address: '3 Beach St', score: 33 }])
    })

    it('ignores filler words when counting overlap', () => {
      // "the" is dropped from the query and "restaurant", "pty", "ltd" from the name.
      const got = findCustomer('the grove', venues)
      expect(got.candidates[0].id).toBe(4)
      expect(got.candidates[0].score).toBeGreaterThanOrEqual(30)
    })

    it('does not match a query made of nothing but filler through the overlap path', () => {
      const got = findCustomer('pty ltd', venues)
      expect(got.candidates.every((c) => c.score >= 60)).toBe(true)
    })

    it('strips punctuation inside names too', () => {
      expect(findCustomer('obriens pub', venues).candidates[0].id).toBe(5)
      expect(findCustomer("o'brien's", venues).candidates[0].id).toBe(5)
    })

    it('finds nothing for a stranger, an empty query or only punctuation', () => {
      for (const query of ['zzzz qqqq', '', '   ', '!!!']) {
        expect(findCustomer(query, venues)).toEqual({ candidates: [], ambiguous: false })
      }
    })

    it('finds nothing in an empty customer list', () => {
      expect(findCustomer('harbour', [])).toEqual({ candidates: [], ambiguous: false })
    })

    it('keeps only scores of 30 or more', () => {
      // One word in four found is 12: below the floor.
      expect(findCustomer('bayside north shore sydney', venues).candidates).toEqual([])
    })
  })

  describe('ordering and the cap', () => {
    it('lists the best match first and returns at most five', () => {
      const many = Array.from({ length: 9 }, (_, i) => mkHoReCa({ id: 100 + i, name: `Corner Deli ${i}`, address: 'x' }))
      const got = findCustomer('corner deli', [...many, mkHoReCa({ id: 1, name: 'Corner Deli', address: 'y' })])
      expect(got.candidates).toHaveLength(5)
      expect(got.candidates[0]).toMatchObject({ id: 1, score: 100 })
      const scores = got.candidates.map((c) => c.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
    })

    it('breaks a tie on score by the name without its filler words, then by id', () => {
      // Both start with "harbour" (80). With "cafe" dropped, Harbour Cafe is an exact match.
      const got = findCustomer('harbour', venues)
      expect(got.candidates.map((c) => c.id)).toEqual([1, 2])
      const same = [mkHoReCa({ id: 9, name: 'Alpha One' }), mkHoReCa({ id: 8, name: 'Alpha One' })]
      expect(findCustomer('alpha', same).candidates.map((c) => c.id)).toEqual([8, 9])
    })
  })

  describe('ambiguity', () => {
    it('is ambiguous when two candidates sit within 10 points of the top', () => {
      const got = findCustomer('harbour', venues)
      expect(got.candidates.map((c) => c.score)).toEqual([80, 80])
      expect(got.ambiguous).toBe(true)
    })

    it('is ambiguous at exactly 10 points apart', () => {
      // "grove park" is contained in the first name (60); the second only shares both words (50).
      const pair = [mkHoReCa({ id: 1, name: 'The Grove Park Cafe' }), mkHoReCa({ id: 2, name: 'Park Lane Grove' })]
      const got = findCustomer('grove park', pair)
      expect(got.candidates.map((c) => c.score)).toEqual([60, 50])
      expect(got.ambiguous).toBe(true)
    })

    it('is not ambiguous at 20 points apart', () => {
      const pair = [mkHoReCa({ id: 1, name: 'Bay Cafe North' }), mkHoReCa({ id: 2, name: 'Cove Bay Cafe' })]
      const got = findCustomer('bay', pair)
      expect(got.candidates.map((c) => c.score)).toEqual([80, 60])
      expect(got.ambiguous).toBe(false)
    })

    it('is not ambiguous when the top is one clear match', () => {
      const got = findCustomer('bayside', venues)
      expect(got.ambiguous).toBe(false)
    })

    it('is not ambiguous for an exact name when a weaker candidate follows', () => {
      const got = findCustomer('harbour cafe', venues)
      expect(got.candidates[0]).toMatchObject({ id: 1, score: 100 })
      expect(got.ambiguous).toBe(false)
    })

    it('is ambiguous when two different customers carry the very same name', () => {
      // Top is 100 here, so the "top < 100" rule alone would hide a real choice.
      const twins = [
        mkHoReCa({ id: 21, name: 'Corner Deli', address: '1 North St' }),
        mkHoReCa({ id: 22, name: 'Corner Deli', address: '9 South St' }),
      ]
      const got = findCustomer('corner deli', twins)
      expect(got.candidates.map((c) => c.id)).toEqual([21, 22])
      expect(got.ambiguous).toBe(true)
    })

    it('is not ambiguous with no candidates', () => {
      expect(findCustomer('nobody', venues).ambiguous).toBe(false)
    })
  })

  describe('rep restriction', () => {
    it('only returns customers in the allowed set', () => {
      const got = findCustomer('harbour', venues, new Set([2]))
      expect(got.candidates.map((c) => c.id)).toEqual([2])
      expect(got.ambiguous).toBe(false)
    })

    it('finds nothing when the allowed set excludes every match', () => {
      expect(findCustomer('harbour', venues, new Set([3, 4]))).toEqual({ candidates: [], ambiguous: false })
    })

    it('treats an empty allowed set as "no customers", not "all of them"', () => {
      expect(findCustomer('harbour', venues, new Set()).candidates).toEqual([])
    })

    it('searches everyone when no set is given', () => {
      expect(findCustomer('harbour', venues).candidates).toHaveLength(2)
    })
  })

  it('does not modify its inputs', () => {
    const frozen = Object.freeze(venues.map((v) => Object.freeze({ ...v })))
    const allowed: ReadonlySet<number> = new Set([1, 2])
    expect(() => findCustomer('harbour', frozen, allowed)).not.toThrow()
  })
})
