// Per-tab settings draft hook. Wraps useSettings/useUpdateSettings with the
// pure pick/diff/validate helpers so each Settings tab gets consistent
// draft → dirty → validate → save UX without touching snake_case rows directly.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '../../../types'
import type { Database } from '../../../lib/database.types'
import { toAppSettings, fromAppSettings } from '../../../lib/adapters'
import { pickSettings, diffSettings } from '../../../lib/settingsDraft'
import { validateSettings, type SettingsErrors } from '../../../lib/settingsValidation'
import { useSettings, useUpdateSettings } from '../../../hooks/queries/useSettings'
import { useToasts } from '../../../hooks/useToasts'

// The one place the camelCase→snake_case patch is cast to the table Update type
// (fromAppSettings only emits known app_settings columns).
type SettingsUpdate = Database['public']['Tables']['app_settings']['Update']

export interface SettingsDraft<K extends keyof AppSettings> {
  /** False until the settings row has loaded (draft is null before that). */
  loaded: boolean
  draft: Pick<AppSettings, K> | null
  setField: <F extends K>(key: F, value: AppSettings[F]) => void
  isDirty: boolean
  errors: SettingsErrors
  isSaving: boolean
  /** Persists only the changed keys. No-ops when clean or invalid. */
  save: () => Promise<void>
  /** Resets the draft back to the last saved values. */
  discard: () => void
}

/**
 * Draft state for the subset of AppSettings a tab owns.
 * `keys` must be stable for the life of the component (pass a module-level
 * or memoized array).
 */
export function useSettingsDraft<K extends keyof AppSettings>(
  keys: ReadonlyArray<K>,
): SettingsDraft<K> {
  const settingsQuery = useSettings()
  const updateMutation = useUpdateSettings()
  const { addToast } = useToasts()

  // Captured once — tabs pass literal arrays; re-picking on a new identity
  // every render would defeat memoization.
  const keysRef = useRef(keys)

  const [base, setBase] = useState<Pick<AppSettings, K> | null>(null)
  const [draft, setDraft] = useState<Pick<AppSettings, K> | null>(null)

  const serverBase = useMemo(
    () => (settingsQuery.data ? pickSettings(toAppSettings(settingsQuery.data), keysRef.current) : null),
    [settingsQuery.data],
  )

  const isDirty =
    base != null && draft != null && Object.keys(diffSettings(base, draft)).length > 0

  // Resync from the server ONLY while the tab is clean, so background
  // refetches never clobber in-progress edits.
  useEffect(() => {
    if (!serverBase || isDirty) return
    setBase(serverBase)
    setDraft(prev => {
      if (prev == null) return serverBase
      return Object.keys(diffSettings(serverBase, prev)).length === 0 ? prev : serverBase
    })
  }, [serverBase, isDirty])

  const errors = useMemo<SettingsErrors>(
    () => (draft ? validateSettings(draft) : {}),
    [draft],
  )

  const setField = useCallback(<F extends K>(key: F, value: AppSettings[F]) => {
    setDraft(prev => (prev == null ? prev : { ...prev, [key]: value }))
  }, [])

  const save = useCallback(async () => {
    if (base == null || draft == null || updateMutation.isPending) return
    const changed = diffSettings(base, draft)
    if (Object.keys(changed).length === 0) return
    if (Object.keys(validateSettings(draft)).length > 0) return
    try {
      await updateMutation.mutateAsync(fromAppSettings(changed) as SettingsUpdate)
      // Mark clean immediately; the mutation's onSuccess has already seeded
      // the query cache with the returned row, so serverBase is fresh here.
      setBase(draft)
      addToast('Settings saved.', 'success')
    } catch (err) {
      addToast(
        `Couldn't save settings: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error',
      )
    }
  }, [base, draft, updateMutation, addToast])

  const discard = useCallback(() => {
    setDraft(base)
  }, [base])

  return {
    loaded: draft != null,
    draft,
    setField,
    isDirty,
    errors,
    isSaving: updateMutation.isPending,
    save,
    discard,
  }
}
