// Fuzzy name matching: the bridge from a name the model heard to an id the
// tools need. Shared by find_customer (venues) and find_product (the catalogue).
//
// It errs toward asking: when two candidates look equally likely it says so
// (`ambiguous`) and the assistant asks which one rather than guessing and
// reporting figures for the wrong thing.
//
// Scoring, on names lowercased with punctuation and accents removed:
//   exact 100 · starts with the query 80 · contains it 60 · otherwise the share
//   of the spoken words found in the name, times 50. Under 30 is not a candidate.
//
// Filler words say nothing about WHICH one is meant ("the", "pty", "cafe" for a
// venue), so they are left out when counting shared words and when breaking a
// tie, where "Harbour" should prefer "Harbour Cafe" over "Harbour Bistro". Each
// caller supplies its own.

export interface NameMatchItem {
  id: number
  name: string
}

export interface NameMatchOptions {
  filler?: ReadonlySet<string>
  /** Applied to the query and every name after normalising, e.g. unit folding. */
  fold?: (normalised: string) => string
}

export interface ScoredMatch<T extends NameMatchItem> {
  item: T
  score: number
}

export interface NameMatch<T extends NameMatchItem> {
  matches: ScoredMatch<T>[]
  ambiguous: boolean
}

const EXACT = 100
const STARTS_WITH = 80
const CONTAINS = 60
const OVERLAP_WEIGHT = 50
const MIN_SCORE = 30
const MAX_CANDIDATES = 5
const AMBIGUITY_GAP = 10
const NO_FILLER: ReadonlySet<string> = new Set()

/** Lowercase, drop accents and apostrophes, turn other punctuation into single spaces. */
export function normaliseName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function contentTokens(normalised: string, filler: ReadonlySet<string>): string[] {
  return normalised.split(' ').filter((token) => token.length > 0 && !filler.has(token))
}

/** The exact / starts-with / contains ladder; 0 when none applies. */
function ladder(query: string, name: string): number {
  if (query.length === 0) return 0
  if (name === query) return EXACT
  if (name.startsWith(query)) return STARTS_WITH
  if (name.includes(query)) return CONTAINS
  return 0
}

function overlapScore(query: string, name: string, filler: ReadonlySet<string>): number {
  const wanted = contentTokens(query, filler)
  if (wanted.length === 0) return 0
  const have = new Set(contentTokens(name, filler))
  const matched = wanted.filter((token) => have.has(token)).length
  return Math.round((matched / wanted.length) * OVERLAP_WEIGHT)
}

interface Ranked<T extends NameMatchItem> extends ScoredMatch<T> {
  rank: number
  key: string
}

function compare<T extends NameMatchItem>(a: Ranked<T>, b: Ranked<T>): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.rank !== b.rank) return b.rank - a.rank
  if (a.key !== b.key) return a.key < b.key ? -1 : 1
  return a.item.id - b.item.id
}

function isAmbiguous(scores: readonly number[]): boolean {
  if (scores.length < 2) return false
  const top = scores[0]
  // An exact name wins outright, unless two different items carry that same name.
  if (top === EXACT) return scores.filter((s) => s === EXACT).length >= 2
  return scores.filter((s) => s >= top - AMBIGUITY_GAP).length >= 2
}

/**
 * Up to five items whose names fit `query`, best first.
 *
 * `allowedIds` limits the search (a rep may only look up customers they have
 * sold to). An empty set therefore matches nothing; "no restriction" is
 * `undefined`, and the caller decides which one it means.
 */
export function matchNames<T extends NameMatchItem>(
  query: string,
  items: readonly T[],
  options: NameMatchOptions = {},
  allowedIds?: ReadonlySet<number>,
): NameMatch<T> {
  const filler = options.filler ?? NO_FILLER
  const fold = options.fold ?? ((s: string) => s)
  const wanted = fold(normaliseName(query))
  if (wanted.length === 0) return { matches: [], ambiguous: false }

  const ranked: Ranked<T>[] = []
  for (const item of items) {
    if (allowedIds && !allowedIds.has(item.id)) continue
    const key = fold(normaliseName(item.name))
    const score = ladder(wanted, key) || overlapScore(wanted, key, filler)
    if (score < MIN_SCORE) continue
    const rank = ladder(contentTokens(wanted, filler).join(' '), contentTokens(key, filler).join(' '))
    ranked.push({ item, score, rank, key })
  }

  const matches = ranked
    .sort(compare)
    .slice(0, MAX_CANDIDATES)
    .map(({ item, score }) => ({ item, score }))
  return { matches, ambiguous: isAmbiguous(matches.map((m) => m.score)) }
}
