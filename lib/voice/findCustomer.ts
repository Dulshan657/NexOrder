// Fuzzy customer lookup for "how is Harbour Cafe doing?".
//
// The scoring lives in nameMatch.ts (shared with find_product since NX-0014):
// exact 100 · starts with 80 · contains 60 · otherwise shared words x 50, and
// `ambiguous` when two venues look equally likely, so Nex asks which one.
//
// Filler words (the, pty, ltd, cafe, restaurant) say nothing about WHICH venue
// is meant, so they are left out when counting shared words and when breaking a
// tie, where "Harbour" should prefer "Harbour Cafe" over "Harbour Bistro".

import type { HoReCa } from '@/types'
import { matchNames } from './nameMatch'

export interface CustomerCandidate {
  id: number
  name: string
  address: string
  score: number
}

export interface CustomerMatch {
  candidates: CustomerCandidate[]
  ambiguous: boolean
}

const FILLER: ReadonlySet<string> = new Set(['the', 'pty', 'ltd', 'cafe', 'restaurant'])

/**
 * Up to five customers whose names fit `query`, best first.
 *
 * `allowedIds` limits the search (a rep may only look up customers they have
 * sold to). An empty set therefore matches nobody; "no restriction" is `undefined`,
 * and the caller decides which one it means.
 */
export function findCustomer(
  query: string,
  hoReCas: readonly HoReCa[],
  allowedIds?: ReadonlySet<number>,
): CustomerMatch {
  const { matches, ambiguous } = matchNames(query, hoReCas, { filler: FILLER }, allowedIds)
  return {
    candidates: matches.map(({ item, score }) => ({ id: item.id, name: item.name, address: item.address ?? '', score })),
    ambiguous,
  }
}
