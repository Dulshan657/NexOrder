// The New Order screen's state: the order being keyed, and its draft.
//
// Every edit marks the order dirty; a debounced save then writes it through
// `mutate-order-draft`. The first save creates the draft and every later one
// updates it, so one order is one draft however long it takes to key.
//
// The rules that keep a shared, auto-saved draft honest (NX-0048 review):
//   * ONE save at a time. A save that comes due while another is in flight
//     waits for it and then re-checks; two concurrent first saves would create
//     two drafts of one order.
//   * ONE timer, owned by a ref and cleared on every re-arm and on unmount, so
//     no orphaned retry can save an order that has since been cleared or placed.
//   * A GENERATION per order on screen (bumped by open, clear, place). A save
//     that finishes for an earlier generation writes nothing back — and if it
//     CREATED a draft, that draft is deleted, or it would sit in the shared list
//     holding an order that was already placed.
//   * A draft that has GONE (placed or deleted by someone else) or CHANGED
//     (edited by someone else) is never retried into a loop: the order on screen
//     is saved as a new draft, so neither person's work is lost.
//   * `flush()` saves now. The screen awaits it before placing (so the draft id
//     is known) and before opening another draft, and fires it on unmount.

import { useCallback, useEffect, useRef, useState } from 'react'

import { useDeleteOrderDraft, useSaveOrderDraft } from '../../../hooks/queries/useOrderDrafts'
import { DraftSaveError } from '../../../services/supabase/orderDraftService'
import { mergeLines, sameLine, type DraftLine } from '../../../lib/newOrder/orderLineModel'
import { isDraftWorthSaving, type OrderDraft } from '../../../lib/newOrder/orderDraft'

export const AUTOSAVE_DELAY_MS = 1500

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface OrderFields {
  hoReCaId: number | null
  lines: DraftLine[]
  deliveryDate: string
  notes: string
}

interface DraftRef {
  id: string | null
  updatedAt: string | null
}

const EMPTY: OrderFields = { hoReCaId: null, lines: [], deliveryDate: '', notes: '' }
const NO_DRAFT: DraftRef = { id: null, updatedAt: null }

/** Codes after which the order on screen is saved as a NEW draft instead. */
const FORK_CODES = new Set(['NOT_FOUND', 'CONFLICT'])

const toPayloadLines = (lines: DraftLine[]) =>
  // A cleared quantity box is mid-edit; the draft keeps it as 0.
  lines.map((l) => ({ ...l, quantity: Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0 }))

export interface NewOrderStateOptions {
  /** Something the operator should know that is not an error (a fork). */
  onNotice?: (message: string) => void
}

export function useNewOrderState({ onNotice }: NewOrderStateOptions = {}) {
  const [fields, setFields] = useState<OrderFields>(EMPTY)
  const [draft, setDraft] = useState<DraftRef>(NO_DRAFT)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const { mutateAsync: saveDraft } = useSaveOrderDraft()
  const { mutateAsync: deleteDraft } = useDeleteOrderDraft()

  // Refs mirror what an async save must read at the moment it runs.
  const latest = useRef({ fields, draft, dirty })
  latest.current = { fields, draft, dirty }
  const editSeq = useRef(0)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  /** Save the order on screen now, if it needs it. Resolves when it is done. */
  const saveNow = useCallback(async (): Promise<void> => {
    clearTimer()
    while (inFlight.current) await inFlight.current
    const { fields: f, draft: d, dirty: isDirty } = latest.current
    if (!isDirty || (!isDraftWorthSaving(f) && d.id === null)) return

    const gen = generation.current
    const seq = editSeq.current
    const attempt = (target: DraftRef) =>
      saveDraft({
        id: target.id,
        expectedUpdatedAt: target.updatedAt,
        hoReCaId: f.hoReCaId,
        lines: toPayloadLines(f.lines),
        deliveryDate: f.deliveryDate === '' ? null : f.deliveryDate,
        notes: f.notes.trim() === '' ? null : f.notes,
      })

    const run = (async () => {
      setSaveStatus('saving')
      try {
        let saved
        try {
          saved = await attempt(d)
        } catch (error: unknown) {
          if (!(error instanceof DraftSaveError) || !FORK_CODES.has(error.code ?? '') || d.id === null) throw error
          saved = await attempt(NO_DRAFT)
          if (generation.current === gen) {
            noticeRef.current?.(
              error.code === 'CONFLICT'
                ? 'Someone else changed that draft, so your version was saved as a new draft.'
                : 'That draft was placed or deleted elsewhere, so this order was saved as a new draft.',
            )
          }
        }
        if (generation.current !== gen) {
          // The order this save belonged to is no longer on screen. A draft it
          // created would be an orphan holding work that was placed or cleared.
          if (saved.id !== d.id) await deleteDraft(saved.id).catch(() => undefined)
          return
        }
        const nextDraft = { id: saved.id, updatedAt: saved.updatedAt }
        setDraft(nextDraft)
        setSaveError(null)
        const unchanged = editSeq.current === seq
        latest.current = { ...latest.current, draft: nextDraft, dirty: unchanged ? false : latest.current.dirty }
        if (unchanged) {
          setDirty(false)
          setSaveStatus('saved')
        } else {
          setSaveStatus('pending')
        }
      } catch (error: unknown) {
        if (generation.current !== gen) return
        setSaveStatus('error')
        setSaveError(error instanceof Error ? error.message : 'The draft could not be saved')
      }
    })()
    inFlight.current = run
    try {
      await run
    } finally {
      if (inFlight.current === run) inFlight.current = null
    }
  }, [saveDraft, deleteDraft])

  const edit = useCallback((update: (f: OrderFields) => OrderFields) => {
    editSeq.current += 1
    setFields(update)
    setDirty(true)
  }, [])

  const setCustomer = useCallback((hoReCaId: number | null) => edit((f) => ({ ...f, hoReCaId })), [edit])
  const setDeliveryDate = useCallback((deliveryDate: string) => edit((f) => ({ ...f, deliveryDate })), [edit])
  const setNotes = useCallback((notes: string) => edit((f) => ({ ...f, notes })), [edit])
  const addLines = useCallback((incoming: DraftLine[]) => edit((f) => ({ ...f, lines: mergeLines(f.lines, incoming) })), [edit])
  const removeLine = useCallback((index: number) => edit((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) })), [edit])

  const setQuantity = useCallback(
    (index: number, quantity: number) =>
      edit((f) => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, quantity } : l)) })),
    [edit],
  )

  // Switching a line to a unit the product already has a line in folds the two together.
  const setUnit = useCallback(
    (index: number, uomId: number | null) =>
      edit((f) => {
        const changed = { ...f.lines[index], uomId }
        const others = f.lines.filter((_, i) => i !== index)
        const twin = others.findIndex((l) => sameLine(l, changed))
        if (twin === -1) return { ...f, lines: f.lines.map((l, i) => (i === index ? changed : l)) }
        return { ...f, lines: others.map((l, i) => (i === twin ? { ...l, quantity: l.quantity + changed.quantity } : l)) }
      }),
    [edit],
  )

  const putOnScreen = useCallback((next: OrderFields, nextDraft: DraftRef, status: SaveStatus) => {
    generation.current += 1
    clearTimer()
    setFields(next)
    setDraft(nextDraft)
    setDirty(false)
    latest.current = { fields: next, draft: nextDraft, dirty: false }
    setSaveStatus(status)
    setSaveError(null)
  }, [])

  const loadDraft = useCallback(
    (d: OrderDraft) =>
      putOnScreen(
        { hoReCaId: d.hoReCaId, lines: d.lines.map((l) => ({ ...l })), deliveryDate: d.deliveryDate ?? '', notes: d.notes ?? '' },
        { id: d.id, updatedAt: d.updatedAt },
        'saved',
      ),
    [putOnScreen],
  )

  const reset = useCallback(() => putOnScreen(EMPTY, NO_DRAFT, 'idle'), [putOnScreen])

  /** Save any pending edit now. `saved` is false when an edit is still unsaved
   *  (the save failed), which is the caller's cue to ask before discarding it. */
  const flush = useCallback(async (): Promise<{ draftId: string | null; saved: boolean }> => {
    await saveNow()
    const { draft: d, dirty: stillDirty, fields: f } = latest.current
    return { draftId: d.id, saved: !stillDirty || (!isDraftWorthSaving(f) && d.id === null) }
  }, [saveNow])

  // The debounce.
  useEffect(() => {
    if (!dirty) return undefined
    if (!isDraftWorthSaving(fields) && latest.current.draft.id === null) return undefined
    setSaveStatus((s) => (s === 'saving' ? s : 'pending'))
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      void saveNow()
    }, AUTOSAVE_DELAY_MS)
    return clearTimer
  }, [dirty, fields, saveNow])

  // Leaving the screen saves what is pending rather than dropping it.
  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow
  useEffect(
    () => () => {
      clearTimer()
      void saveNowRef.current()
    },
    [],
  )

  return {
    ...fields,
    draftId: draft.id,
    dirty,
    saveStatus,
    saveError,
    setCustomer,
    setDeliveryDate,
    setNotes,
    addLines,
    removeLine,
    setQuantity,
    setUnit,
    loadDraft,
    reset,
    flush,
  }
}
