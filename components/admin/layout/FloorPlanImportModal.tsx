// Upload a photo/scan of a warehouse floor plan → OpenAI vision extracts a grid
// → we create an editable DRAFT layout the operator reviews before publishing.
// Nothing auto-publishes; the draft opens in the designer on success.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, UploadCloud, Loader2, CheckCircle2, Circle, AlertTriangle, Sparkles } from 'lucide-react'
import type { LayoutObjectType, Warehouse } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import { createLayout, saveGeometry, type SaveObjectInput } from '@/services/supabase/layoutService'
import { layoutKeys } from '@/hooks/queries/useLayouts'
import { useFloorplanImport, type ImportPhase } from '@/hooks/queries/useFloorplanImport'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import type { FloorplanFidelity } from '@/services/supabase/floorplanService'
import { applyDefaultStorageForm, applyPalletAreaChoices, pruneStaleWalkways, type PalletAreaDecision } from '@/lib/floorplanImportDefaults'
import { capacityModeOf, deriveCapacitySlots } from '@/lib/storageFormCapacity'
// Same pure module + adapter pattern LayoutDesignerView.handleAutoConnect uses:
// the extraction ran its own auto-connect pass server-side, but appending the
// pallet-area bins/objects and the staging wiring below happens after that, so
// routing needs one more repair before saving.
import { autoConnectLayout, type ConnectObject } from '@/supabase/functions/_shared/wie/autoConnect'

interface FloorPlanImportModalProps {
  warehouse: Warehouse
  onClose: () => void
  onDraftCreated: (layoutId: number) => void
}

const PHASE_LABEL: Record<ImportPhase, string> = {
  idle: '',
  compressing: 'Preparing image…',
  uploading: 'Uploading…',
  extracting: 'Reading the floor plan…',
  done: 'Extraction complete',
  error: 'Something went wrong',
}

// The visible progress steps, in order. The AI read is the long pole, so it
// carries an ETA hint to reassure the operator the process isn't stuck — high
// fidelity runs two sequential vision passes, so its hint sets a longer bar.
function stepsFor(fidelity: FloorplanFidelity): ReadonlyArray<{ key: ImportPhase; label: string; hint?: string }> {
  return [
    { key: 'compressing', label: 'Preparing image' },
    { key: 'uploading', label: 'Uploading' },
    {
      key: 'extracting',
      label: 'Reading the plan with AI',
      hint: fidelity === 'high' ? 'High fidelity can take up to ~2 minutes.' : 'This can take up to a minute.',
    },
  ]
}
const PHASE_ORDER: ImportPhase[] = ['idle', 'compressing', 'uploading', 'extracting', 'done', 'error']

const FIDELITY_OPTIONS: ReadonlyArray<{ value: FloorplanFidelity; label: string; hint: string }> = [
  { value: 'standard', label: 'Standard', hint: 'Single AI pass' },
  { value: 'high', label: 'High fidelity', hint: 'Multi-pass, more detail, ~3–4× cost & time' },
]

// mutate-layout's zod schema caps a single save_geometry call at 5,000
// placements. A few large pallet areas marked Storable can blow past that —
// block creation with actionable guidance rather than a raw 400 from the server.
const PLACEMENT_CAP = 5000

/** One operator choice per pallet area, keyed by the area's `code`. */
interface PalletAreaChoiceState {
  storable: boolean
  storageTypeId: number | null
}

/** ConnectObject plus the one save-time-only field (`new_staging`) that has no
 *  spatial meaning and so isn't part of the auto-connect contract — carried
 *  through by structural typing (autoConnectLayout passes non-wall objects by
 *  reference) rather than by the module itself knowing about it. */
type StagingConnectObject = ConnectObject & { new_staging?: SaveObjectInput['new_staging'] }

function toConnectObject(o: SaveObjectInput): StagingConnectObject {
  return {
    objectType: o.object_type,
    floor: o.floor,
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    meta: o.meta,
    stagingLocationId: o.staging_location_id,
    new_staging: o.new_staging,
  }
}

function fromConnectObject(o: StagingConnectObject): SaveObjectInput {
  return {
    object_type: o.objectType as LayoutObjectType,
    floor: o.floor,
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    meta: o.meta,
    staging_location_id: o.stagingLocationId,
    new_staging: o.new_staging,
  }
}

// supabase.functions.invoke flattens a non-2xx into a FunctionsHttpError whose
// .message is generic ("… non-2xx status code"). The real message lives in the
// response body ({ error: { code, message } }) hanging off .context — dig it out
// so the operator sees e.g. the CONFLICT reason instead of a bare status.
async function edgeErrorMessage(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: unknown })?.context
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json()
      const message = body?.error?.message
      if (typeof message === 'string' && message.trim()) return message
    } catch { /* body wasn't JSON — fall through */ }
  }
  return err instanceof Error && err.message ? err.message : fallback
}

/** Short capacity hint for a storage-form <option> label, e.g. "24 slots" / "uncapped". */
function formCapacityHint(form: { levels?: number; positionsPerLevel?: number; defaultCapacitySlots?: number }): string {
  const slots = deriveCapacitySlots({
    mode: capacityModeOf(form),
    levels: form.levels,
    positionsPerLevel: form.positionsPerLevel,
    flatSlots: form.defaultCapacitySlots,
  })
  return slots != null ? `${slots} slots` : 'uncapped'
}

export function FloorPlanImportModal({ warehouse, onClose, onDraftCreated }: FloorPlanImportModalProps) {
  const qc = useQueryClient()
  const { phase, result, error, run, reset } = useFloorplanImport(warehouse.id)
  const { data: storageForms } = useStorageTypes()
  const forms = storageForms ?? []
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null)
  const [fidelity, setFidelity] = useState<FloorplanFidelity>('standard')
  const [palletAreaChoices, setPalletAreaChoices] = useState<Record<string, PalletAreaChoiceState>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  // Hard guard against a double-fired create: the imported rack codes are
  // deterministic, so two concurrent create-draft calls race on the same
  // location codes and the loser 23505s ("… already exists"). `creating` state
  // disables the button, but a fast second click can land before React re-renders.
  const creatingRef = useRef(false)

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Default the storage-form selector to the first drawable active form (a
  // sensible generic default), falling back to the first active form, or no
  // default at all if none exist. Only runs once the forms have loaded and the
  // operator hasn't already picked one.
  useEffect(() => {
    if (selectedFormId !== null || forms.length === 0) return
    const drawable = forms.find((f) => f.isDrawable)
    setSelectedFormId(drawable?.id ?? forms[0]?.id ?? null)
  }, [forms, selectedFormId])

  // Seed one Storable/Visual choice per pallet area once both the extraction
  // result and the storage-form catalogue are in. Default: Storable, with the
  // first form whose name/code reads as a floor-pallet form, else whatever the
  // operator's default-form selector already resolved to. Never overwrites a
  // choice the operator already made (e.g. re-running this effect after forms
  // finish loading a beat after `result`).
  useEffect(() => {
    const areas = result?.draft.palletAreas ?? []
    if (areas.length === 0) return
    setPalletAreaChoices((prev) => {
      let changed = false
      const next = { ...prev }
      for (const area of areas) {
        if (next[area.code]) continue
        const fuzzyMatch = forms.find((f) => /floor|pallet/i.test(f.name) || /floor|pallet/i.test(f.code))
        next[area.code] = { storable: true, storageTypeId: fuzzyMatch?.id ?? selectedFormId ?? null }
        changed = true
      }
      return changed ? next : prev
    })
  }, [result, forms, selectedFormId])

  const matchStats = useMemo(() => {
    const placements = result?.draft.placements ?? []
    const total = placements.length
    const matched = placements.filter((p) => p.new_bin?.storage_type_id != null).length
    return { total, matched, unmatched: total - matched }
  }, [result])

  const pickFile = (f: File | null) => {
    if (!f || !f.type.startsWith('image/')) return
    reset()
    setCreateError(null)
    setPalletAreaChoices({})
    setFile(f)
  }

  const setPalletAreaChoice = (code: string, choice: PalletAreaChoiceState) =>
    setPalletAreaChoices((prev) => ({ ...prev, [code]: choice }))

  const busy = phase === 'compressing' || phase === 'uploading' || phase === 'extracting'

  const createDraft = async () => {
    if (!result || creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setCreateError(null)
    try {
      const layout = await createLayout({
        warehouse_id: warehouse.id,
        name: `Imported ${new Date().toISOString().slice(0, 10)}`,
        grid_width: result.draft.gridWidth,
        grid_height: result.draft.gridHeight,
        floor_count: result.draft.floors,
      })
      // Scope every imported rack code to THIS layout so re-creating from the same
      // extraction (or a racing attempt) never collides with a prior draft's
      // locations — layout ids are globally unique, `locations.code` is UNIQUE.
      const suffixed = result.draft.placements.map((p) =>
        p.new_bin
          ? { ...p, new_bin: { ...p.new_bin, code: `${p.new_bin.code}-L${layout.id}` } }
          : p,
      )
      // Backfill the operator-picked default storage form onto any rack the AI
      // couldn't match (matched racks keep their matched form).
      const basePlacements = applyDefaultStorageForm(suffixed, selectedFormId)

      // Turn the operator's per-pallet-area Storable/Visual choices into extra
      // placements (storable) and obstacle objects (visual-only).
      const palletAreas = result.draft.palletAreas ?? []
      const decisions: Record<string, PalletAreaDecision> = {}
      for (const area of palletAreas) {
        const choice = palletAreaChoices[area.code]
        decisions[area.code] = !choice
          ? { storable: true, storageTypeId: selectedFormId }
          : choice.storable
            ? { storable: true, storageTypeId: choice.storageTypeId }
            : { storable: false }
      }
      const { placements: areaPlacements, visualObjects } = applyPalletAreaChoices(palletAreas, decisions, layout.id)
      const allPlacements = [...basePlacements, ...areaPlacements]

      // mutate-layout's zod schema caps a single save at PLACEMENT_CAP placements.
      if (allPlacements.length > PLACEMENT_CAP) {
        setCreateError(
          `This draft would create ${allPlacements.length.toLocaleString()} bins, over the ` +
          `${PLACEMENT_CAP.toLocaleString()}-bin limit. Switch the largest pallet area(s) to ` +
          `"Visual only" and try again.`,
        )
        return
      }

      // Visual-only pallet areas become plain obstacle objects (structurally a
      // SaveObjectInput without staging/new_staging — a clean subset).
      const areaObjects: SaveObjectInput[] = visualObjects
      const combinedObjects: SaveObjectInput[] = [...result.draft.objects, ...areaObjects]

      // Staging wiring: attach new_staging to the FIRST staging object only
      // (single-S&R assumption — the server backfills every dock lacking one).
      let stagingAttached = false
      const objectsWithStaging: SaveObjectInput[] = combinedObjects.map((o) => {
        if (o.object_type !== 'staging' || stagingAttached) return o
        stagingAttached = true
        return {
          ...o,
          new_staging: {
            code: `${warehouse.code}-STG-L${layout.id}`,
            name: (o.meta?.name as string | undefined) ?? 'Shipping & Receiving',
          },
        }
      })

      // The server's first auto-connect pass ran before the pallet-area
      // decisions above, so it may have threaded 1×1 walkway cells across
      // cells that just became storable pallet bins. Prune those before
      // re-running auto-connect — it only ever adds cells, never removes a
      // now-covered one.
      const prunedObjects = pruneStaleWalkways(objectsWithStaging, allPlacements)

      // Re-run auto-connect client-side over the FINAL assembled geometry: the
      // server's own pass ran before the pallet-area/staging additions above,
      // so routing may need one more repair before saving. Can take a few
      // seconds at 120×80 with many placements — the `creating` busy state
      // (already true) covers it.
      const autoResult = autoConnectLayout({
        objects: prunedObjects.map(toConnectObject),
        placements: allPlacements.map((p) => ({ id: p.client_ref, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
        gridWidth: result.draft.gridWidth,
        gridHeight: result.draft.gridHeight,
        floors: result.draft.floors,
      })
      const finalObjects = autoResult.objects.map((o) => fromConnectObject(o as StagingConnectObject))

      await saveGeometry(layout.id, allPlacements, finalObjects)
      qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouse.id) })
      onDraftCreated(layout.id)
    } catch (e) {
      setCreateError(await edgeErrorMessage(e, 'Failed to create the draft layout'))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const confidencePct = result ? Math.round(result.confidence * 100) : 0

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-700">
            <Sparkles className="h-4 w-4 text-emerald-600" /> Import a floor plan
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 btn-press" aria-label="Close">
            <X className="h-4 w-4 text-stone-500" />
          </button>
        </div>

        <p className="text-xs text-stone-500">
          Upload a photo or scan of {warehouse.name}'s floor plan. We'll read it into an editable draft layout —
          you review and correct it before publishing. Nothing goes live automatically.
        </p>

        {/* Fidelity choice — only meaningful before the AI read starts */}
        {!result && (
          <div className="grid grid-cols-2 gap-2">
            {FIDELITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                  fidelity === opt.value ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 hover:bg-stone-50'
                } ${busy ? 'pointer-events-none opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name="floorplan-fidelity"
                  value={opt.value}
                  checked={fidelity === opt.value}
                  onChange={() => setFidelity(opt.value)}
                  disabled={busy}
                  className="sr-only"
                />
                <p className="text-xs font-semibold text-stone-700">{opt.label}</p>
                <p className="text-[11px] text-stone-500">{opt.hint}</p>
              </label>
            ))}
          </div>
        )}

        {/* Dropzone / preview */}
        {!result && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0] ?? null) }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 hover:bg-stone-50'
            }`}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="Floor plan preview" className="mx-auto max-h-56 rounded-lg object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-stone-400">
                <UploadCloud className="h-8 w-8" />
                <p className="text-xs">Drop an image here, or click to choose (PNG / JPG / WebP)</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        {/* Progress stepper — makes a long AI read read as progress, not a hang */}
        {busy && (
          <ol className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            {stepsFor(fidelity).map((step) => {
              const stepIdx = PHASE_ORDER.indexOf(step.key)
              const currentIdx = PHASE_ORDER.indexOf(phase)
              const state = stepIdx < currentIdx ? 'done' : stepIdx === currentIdx ? 'active' : 'pending'
              return (
                <li key={step.key} className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    {state === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : state === 'active' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-stone-300" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium ${
                      state === 'pending' ? 'text-stone-400' : 'text-stone-700'
                    }`}>
                      {step.label}
                    </p>
                    {state === 'active' && step.hint && (
                      <p className="text-[11px] text-stone-400">{step.hint}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {PHASE_LABEL.done}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Racks', value: result.counts.racks },
                { label: 'Zones', value: result.counts.zones },
                { label: 'Structure', value: result.counts.objects },
                { label: 'Pallet areas', value: result.counts.palletAreas ?? 0 },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-center">
                  <p className="font-mono text-sm font-semibold text-stone-900">{c.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400">{c.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                confidencePct >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {confidencePct}% confidence
              </span>
              {result.needsReview && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" /> Needs a careful review
                </span>
              )}
            </div>
            {!!result.counts.addedWalkways && (
              <div className="flex items-center gap-2 text-[11px] text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Auto-connected {result.counts.addedWalkways} walkway cell{result.counts.addedWalkways === 1 ? '' : 's'} so every rack is reachable.
              </div>
            )}
            {!!result.counts.unreachable && (
              <div className="flex items-center gap-2 text-[11px] text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {result.counts.unreachable} rack{result.counts.unreachable === 1 ? '' : 's'} still need{result.counts.unreachable === 1 ? 's' : ''} a walkway or lift — fix in the designer.
              </div>
            )}
            {result.notes && <p className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-stone-500">{result.notes}</p>}
            {matchStats.unmatched > 0 && (
              <div className="space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-xs text-stone-600">
                  {matchStats.matched} of {matchStats.total} racks matched a storage form. Unmatched racks will use:
                </p>
                <select
                  className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700"
                  value={selectedFormId ?? ''}
                  onChange={(e) => setSelectedFormId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No default (uncapped)</option>
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({formCapacityHint(f)})</option>
                  ))}
                </select>
              </div>
            )}
            {!!result.draft.palletAreas?.length && (
              <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-xs text-stone-600">
                  {result.draft.palletAreas.length} floor-pallet area{result.draft.palletAreas.length === 1 ? '' : 's'} found — choose storable vs visual per area.
                </p>
                {result.draft.palletAreas.map((area) => {
                  const choice = palletAreaChoices[area.code] ?? { storable: true, storageTypeId: selectedFormId }
                  return (
                    <div key={area.code} className="space-y-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-medium text-stone-700">{area.code}</span>
                        <span className="text-stone-400">{area.w}×{area.h} · {area.placements.length} cell{area.placements.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-stone-600">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`pallet-area-${area.code}`}
                            checked={choice.storable}
                            onChange={() => setPalletAreaChoice(area.code, { storable: true, storageTypeId: choice.storageTypeId })}
                          />
                          Storable — floor pallets
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`pallet-area-${area.code}`}
                            checked={!choice.storable}
                            onChange={() => setPalletAreaChoice(area.code, { storable: false, storageTypeId: null })}
                          />
                          Visual only
                        </label>
                      </div>
                      {choice.storable && (
                        <select
                          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700"
                          value={choice.storageTypeId ?? ''}
                          onChange={(e) => setPalletAreaChoice(area.code, {
                            storable: true,
                            storageTypeId: e.target.value ? Number(e.target.value) : null,
                          })}
                        >
                          <option value="">No default (uncapped)</option>
                          {forms.map((f) => (
                            <option key={f.id} value={f.id}>{f.name} ({formCapacityHint(f)})</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {creating && (
              <div className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> Building draft layout…
              </div>
            )}
            {createError && <p className="text-xs text-red-600">{createError}</p>}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button className="text-sm px-3 py-1.5 border border-stone-200 rounded-lg btn-press" onClick={onClose}>Cancel</button>
          {!result ? (
            <button
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-50"
              onClick={() => file && run(file, fidelity)}
              disabled={!file || busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyze floor plan
            </button>
          ) : (
            <button
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-50"
              onClick={createDraft}
              disabled={creating}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Create draft
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
