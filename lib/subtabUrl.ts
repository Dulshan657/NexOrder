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
 * Resolve which Settings sub-tab to open from a search string. A warehouse
 * layout-designer deep link (`?designer=` / `?import=`) always wins over the
 * plain `?subtab=` value so the openDesigner flow lands on the Warehouse tab.
 * Everything else defers to `parseSubtab`, so a stale `?subtab=queue` handed
 * over from PO Inbox degrades to `general`.
 */
export function settingsSubtabFromSearch(search: string): SettingsSubTab {
  const params = new URLSearchParams(search)
  if (params.get('designer') || params.get('import')) return 'warehouse'
  return parseSubtab(search, SETTINGS_SUBTABS, 'general')
}
