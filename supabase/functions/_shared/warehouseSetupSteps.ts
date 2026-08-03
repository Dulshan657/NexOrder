// The warehouse setup step vocabulary — ONE definition, both runtimes.
//
// Imported by `mutate-warehouse-setup-ack` (Deno) to validate an incoming
// step_key, and by `lib/warehouseSetup/steps.ts` (Vite) which builds the rich
// UI definitions — titles, prose, navigation targets — on top of it. If these
// forked, the server would accept a key no panel can ever show or clear, or
// reject one the panel offers. Dependency-free for that reason.
//
// The keys are STORED, in warehouse_setup_acknowledgements.step_key. Renaming
// one orphans every sign-off that used it; add and deprecate instead.

/** Steps an operator states, because no table can prove them. */
export const SIGNOFF_STEP_KEYS = [
  // Config that ships SEEDED, so "a row exists" proves nothing — what matters
  // is that someone checked the defaults against the real racking.
  'storage_forms_reviewed',
  'level_roles_reviewed',
  'zone_profiles_reviewed',
  // Physical: leaves no trace anywhere.
  'wifi_walked',
  // Pre-go-live exercises. Rows for these do exist, but a seeded or demo row
  // would false-positive them, so they are stated rather than inferred.
  'exercise_putaway',
  'exercise_pick',
  'exercise_replen',
] as const

/** Steps read from the database. Listed here so the two sets can be checked
 *  against each other, and so nothing can be acknowledged that is derivable —
 *  a sign-off on a derived step would be a lie the panel then displays. */
export const DERIVED_STEP_KEYS = [
  'optimizer_rules',
  'layout_published',
  'labels_confirmed',
  'catalogue_loaded',
  'replen_min_max',
  'opening_stock',
] as const

export type SignoffStepKey = typeof SIGNOFF_STEP_KEYS[number]
export type DerivedStepKey = typeof DERIVED_STEP_KEYS[number]
export type SetupStepKey = SignoffStepKey | DerivedStepKey

export const SETUP_STEP_KEYS: readonly SetupStepKey[] = [
  ...SIGNOFF_STEP_KEYS,
  ...DERIVED_STEP_KEYS,
]

/** True when `key` is a step an operator may acknowledge. Deliberately NOT
 *  "is a known step" — acknowledging a derived step is refused, because the
 *  panel would keep showing the derived truth and the row would sit there
 *  claiming otherwise. */
export function isSignoffStepKey(key: string): key is SignoffStepKey {
  return (SIGNOFF_STEP_KEYS as readonly string[]).includes(key)
}
