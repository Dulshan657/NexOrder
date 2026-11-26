// The New Order screen's state: the order being keyed, and its draft.
//
// Every edit marks the order dirty; a debounced effect then saves it through
// `mutate-order-draft`. The first save creates the draft and every later one
// updates it, so one order is one draft however long it takes to key. A save
// already in flight is never overlapped — the next one waits for it — because
// two concurrent first saves would create two drafts of the same order.

import { useCallback, useEffect, useRef, useState } from 'react'

import { useSaveOrderDraft } from '../../../hooks/queries/useOrderDrafts'
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

const EMPTY: OrderFields = { hoReCaId: null, lines: [], deliveryDate: '', notes: '' }

export function useNewOrderState() {
  const [fields, setFields] = useState<OrderFields>(EMPTY)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = useSaveOrderDraft()
  const inFlight = useRef(false)
  // Bumped on every edit, so a save that finishes after a newer edit leaves the order dirty.
  const editSeq = useRef(0)
  // Bumped when a different order is put on screen (opened, cleared, placed);
  // a save that started on the previous one must not write its id onto this one.
  const generation = useRef(0)
  // The latest values, read when the debounce fires rather than captured when it was set.
  const latest = useRef({ fields, draftId })
  latest.current = { fields, draftId }

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

  const loadDraft = useCallback((draft: OrderDraft) => {
    generation.current += 1
    setFields({
      hoReCaId: draft.hoReCaId,
      lines: draft.lines.map((l) => ({ ...l })),
      deliveryDate: draft.deliveryDate ?? '',
      notes: draft.notes ?? '',
    })
    setDraftId(draft.id)
    setDirty(false)
    setSaveStatus('saved')
    setSaveError(null)
  }, [])

  const reset = useCallback(() => {
    generation.current += 1
    setFields(EMPTY)
    setDraftId(null)
    setDirty(false)
    setSaveStatus('idle')
    setSaveError(null)
  }, [])

  const { mutateAsync } = save

  useEffect(() => {
    if (!dirty) return undefined
    if (!isDraftWorthSaving(fields) && latest.current.draftId === null) return undefined
    setSaveStatus('pending')
    const timer = setTimeout(async function run() {
      if (inFlight.current) {
        setTimeout(run, AUTOSAVE_DELAY_MS)
        return
      }
      inFlight.current = true
      setSaveStatus('saving')
      const { fields: f, draftId: id } = latest.current
      const seq = editSeq.current
      const gen = generation.current
      try {
        const saved = await mutateAsync({
          id,
          hoReCaId: f.hoReCaId,
          // A cleared quantity box is mid-edit; the draft keeps it as 0.
          lines: f.lines.map((l) => ({ ...l, quantity: Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0 })),
          deliveryDate: f.deliveryDate === '' ? null : f.deliveryDate,
          notes: f.notes.trim() === '' ? null : f.notes,
        })
        if (generation.current !== gen) return
        setDraftId((current) => current ?? saved.id)
        if (editSeq.current === seq) {
          setDirty(false)
          setSaveStatus('saved')
        }
        setSaveError(null)
      } catch (error: unknown) {
        if (generation.current !== gen) return
        setSaveStatus('error')
        setSaveError(error instanceof Error ? error.message : 'The draft could not be saved')
      } finally {
        inFlight.current = false
      }
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [dirty, fields, mutateAsync])

  return {
    ...fields,
    draftId,
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
  }
}
