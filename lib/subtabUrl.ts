// Pure, node-testable URL helpers for settings/PO-inbox style sub-tab routing.
// These take a raw search string (e.g. `window.location.search`) and never touch
// `window` directly, so they can be unit-tested in vitest's node environment.

/**
 * Read the `?subtab=` value from a search string, validating it against a known
 * set. Unknown or missing values fall back to `fallback`.
 */
export function parseSubtab<T extends string>(
  search: string,
  valid: ReadonlyArray<T>,
  fallback: T,
): T {
  const raw = new URLSearchParams(search).get('subtab')
  if (raw && (valid as ReadonlyArray<string>).includes(raw)) {
    return raw as T
  }
  return fallback
}

export type SettingsSubTab =
  | 'general'
  | 'orders'
  | 'inventory'
  | 'warehouse'
  | 'customers'
  | 'automation'

export const SETTINGS_SUBTABS: ReadonlyArray<SettingsSubTab> = [
  'general',
  'orders',
  'inventory',
  'warehouse',
  'customers',
  'automation',
]

/**
 * Params that FORCE a sub-tab, first match wins. A deep link naming a specific
 * surface must land on the sub-tab hosting it, whatever `?subtab=` says —
 * otherwise the consuming effect fires while its host is `hidden`.
 *
 * Note `import` is already claimed globally as *floor-plan import*, which is
 * why the CSV importers use `stockimport` / `prodimport`: a bare `import` here
 * would drag an unrelated tab to Warehouse for the rest of the session.
 */
const FORCED_SUBTAB: ReadonlyArray<readonly [param: string, tab: SettingsSubTab]> = [
  ['designer', 'warehouse'],
  ['import', 'warehouse'],
  ['whrules', 'warehouse'],
]

/** Settings section anchors (`?section=`) and the sub-tab that hosts each. */
const SECTION_SUBTAB: Readonly<Record<string, SettingsSubTab>> = {
  'settings-wh-warehouses': 'warehouse',
  'settings-wh-storage-forms': 'warehouse',
  'settings-wh-level-roles': 'warehouse',
  'settings-wh-zone-profiles': 'warehouse',
  'settings-wh-label-printing': 'warehouse',
  'settings-wh-code-pattern': 'warehouse',
}

/**
 * Resolve which Settings sub-tab to open from a search string. A deep link to a
 * specific surface (`?designer=`, `?whrules=`, `?section=`) always wins over the
 * plain `?subtab=` value. Everything else defers to `parseSubtab`, so a stale
 * `?subtab=queue` handed over from PO Inbox degrades to `general`.
 */
export function settingsSubtabFromSearch(search: string): SettingsSubTab {
  const params = new URLSearchParams(search)
  for (const [param, tab] of FORCED_SUBTAB) {
    if (params.get(param)) return tab
  }
  const section = params.get('section')
  if (section && SECTION_SUBTAB[section]) return SECTION_SUBTAB[section]
  return parseSubtab(search, SETTINGS_SUBTABS, 'general')
}

/** The Settings section ids that `?section=` may name. Anything else is ignored
 *  rather than scrolled to, so a stale link cannot leave the page mid-scroll. */
export function isKnownSettingsSection(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SECTION_SUBTAB, id)
}
