// Fuzzy customer lookup for "how is Harbour Cafe doing?".
//
// The model hears a name; the tools need an id. This is the bridge, and it errs
// toward asking: when two venues look equally likely it says so (`ambiguous`)
// and the assistant asks which one rather than guessing and reporting figures
// for the wrong customer.
//
// Scoring, on names lowercased with punctuation and accents removed:
//   exact 100 · starts with the query 80 · contains it 60 · otherwise the share
//   of the spoken words found in the name, times 50. Under 30 is not a candidate.
//
// Filler words (the, pty, ltd, cafe, restaurant) say nothing about WHICH venue
// is meant, so they are left out when counting shared words and when breaking a
// tie, where "Harbour" should prefer "Harbour Cafe" over "Harbour Bistro".

import type { HoReCa } from '@/types'

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
const EXACT = 100
const STARTS_WITH = 80
const CONTAINS = 60
const OVERLAP_WEIGHT = 50
const MIN_SCORE = 30
const MAX_CANDIDATES = 5
const AMBIGUITY_GAP = 10

/** Lowercase, drop accents and apostrophes, turn other punctuation into single spaces. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function contentTokens(normalised: string): string[] {
  return normalised.split(' ').filter((token) => token.length > 0 && !FILLER.has(token))
}

/** The exact / starts-with / contains ladder; 0 when none applies. */
function ladder(query: string, name: string): number {
  if (query.length === 0) return 0
  if (name === query) return EXACT
  if (name.startsWith(query)) return STARTS_WITH
  if (name.includes(query)) return CONTAINS
  return 0
}

function overlapScore(query: string, name: string): number {
  const wanted = contentTokens(query)
  if (wanted.length === 0) return 0
  const have = new Set(contentTokens(name))
  const matched = wanted.filter((token) => have.has(token)).length
  return Math.round((matched / wanted.length) * OVERLAP_WEIGHT)
}

function scoreOf(query: string, name: string): number {
  return ladder(query, name) || overlapScore(query, name)
}

/** The ladder again with filler removed from both sides: the tie-breaker. */
function tieRank(query: string, name: string): number {
  return ladder(contentTokens(query).join(' '), contentTokens(name).join(' '))
}

interface Scored extends CustomerCandidate {
  rank: number
  key: string
}

function compare(a: Scored, b: Scored): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.rank !== b.rank) return b.rank - a.rank
  if (a.key !== b.key) return a.key < b.key ? -1 : 1
  return a.id - b.id
}

function isAmbiguous(candidates: readonly CustomerCandidate[]): boolean {
  if (candidates.length < 2) return false
  const top = candidates[0].score
  // An exact name wins outright, unless two different venues carry that same name.
  if (top === EXACT) return candidates.filter((c) => c.score === EXACT).length >= 2
  return candidates.filter((c) => c.score >= top - AMBIGUITY_GAP).length >= 2
}

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
  const wanted = normalise(query)
  if (wanted.length === 0) return { candidates: [], ambiguous: false }

  const scored: Scored[] = []
  for (const venue of hoReCas) {
    if (allowedIds && !allowedIds.has(venue.id)) continue
    const key = normalise(venue.name)
    const score = scoreOf(wanted, key)
    if (score < MIN_SCORE) continue
    scored.push({ id: venue.id, name: venue.name, address: venue.address ?? '', score, rank: tieRank(wanted, key), key })
  }

  const candidates = scored
    .sort(compare)
    .slice(0, MAX_CANDIDATES)
    .map(({ id, name, address, score }) => ({ id, name, address, score }))
  return { candidates, ambiguous: isAmbiguous(candidates) }
}
