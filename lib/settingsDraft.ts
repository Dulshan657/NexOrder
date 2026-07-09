// Pure pick/diff helpers for per-tab settings drafts. Kept dependency-free and
// node-testable; the `useSettingsDraft` hook composes these with the settings
// query/mutation.

import type { AppSettings } from '../types'

/** Build a base draft holding only the keys a tab owns. */
export function pickSettings<K extends keyof AppSettings>(
  s: AppSettings,
  keys: ReadonlyArray<K>,
): Pick<AppSettings, K> {
  const out = {} as Pick<AppSettings, K>
  for (const key of keys) {
    out[key] = s[key]
  }
  return out
}

/**
 * Return only the keys whose value changed between `base` and `draft`. Uses
 * `Object.is` so `null` vs `undefined` and `5` vs `'5'` are treated as changes
 * (never conflated). Returns `{}` when the draft is clean.
 */
export function diffSettings<K extends keyof AppSettings>(
  base: Pick<AppSettings, K>,
  draft: Pick<AppSettings, K>,
): Partial<Pick<AppSettings, K>> {
  const out: Partial<Pick<AppSettings, K>> = {}
  for (const key of Object.keys(draft) as K[]) {
    if (!Object.is(base[key], draft[key])) {
      out[key] = draft[key]
    }
  }
  return out
}
