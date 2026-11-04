// Fuzzy product lookup for "how much Oyster Sauce 210ml do we have?" (NX-0014).
//
// Same scoring as find_customer (nameMatch.ts), with one addition: SPOKEN UNITS
// are folded onto the catalogue's spelling before comparing. Speech arrives as
// "210 mill", "210 millilitres" or "two hundred grams"; the catalogue says
// "210ml" and "200g". Without the fold the size, which is what tells "Oyster
// Sauce 210ml" from "Oyster Sauce 510ml", never matches.

import type { Product } from '@/types'
import { matchNames } from './nameMatch'

export interface ProductCandidate {
  id: number
  name: string
  sku: string
  category: string
  score: number
}

export interface ProductMatch {
  candidates: ProductCandidate[]
  ambiguous: boolean
}

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', fifteen: '15', twenty: '20', fifty: '50', hundred: '100',
}

// Longest spellings first, so "millilitres" is not read as "mil" + "litres".
const UNITS: ReadonlyArray<[RegExp, string]> = [
  [/^(millilitres?|milliliters?|mls?|mils?|mills?)$/, 'ml'],
  [/^(litres?|liters?|ltrs?|l)$/, 'l'],
  [/^(kilograms?|kilos?|kgs?)$/, 'kg'],
  [/^(grams?|grammes?|gms?|g)$/, 'g'],
]

function unitOf(token: string): string | null {
  for (const [pattern, unit] of UNITS) if (pattern.test(token)) return unit
  return null
}

/** "oyster sauce 210 mill" -> "oyster sauce 210ml"; "jasmine rice five kilos" -> "jasmine rice 5kg". */
export function foldUnits(normalised: string): string {
  const tokens = normalised.split(' ').map((t) => NUMBER_WORDS[t] ?? t)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const unit = i + 1 < tokens.length ? unitOf(tokens[i + 1]) : null
    if (/^\d+(\.\d+)?$/.test(tokens[i]) && unit) {
      out.push(`${tokens[i]}${unit}`)
      i++
      continue
    }
    // "210mls" or "200gms" written as one word.
    const joined = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(tokens[i])
    const joinedUnit = joined ? unitOf(joined[2]) : null
    out.push(joined && joinedUnit ? `${joined[1]}${joinedUnit}` : tokens[i])
  }
  return out.join(' ')
}

const FILLER: ReadonlySet<string> = new Set(['the', 'of'])

/** Up to five products whose names fit `query`, best first. The caller passes active products only. */
export function findProduct(query: string, products: readonly Product[]): ProductMatch {
  const { matches, ambiguous } = matchNames(query, products, { filler: FILLER, fold: foldUnits })
  return {
    candidates: matches.map(({ item, score }) => ({ id: item.id, name: item.name, sku: item.sku, category: item.category, score })),
    ambiguous,
  }
}
