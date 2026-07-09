// Upload a photo/scan of a warehouse floor plan → OpenAI vision extracts a grid
// → we create an editable DRAFT layout the operator reviews before publishing.
// Nothing auto-publishes; the draft opens in the designer on success.

import { useEffect, useRef, useState } from 'react'
import { X, UploadCloud, Loader2, CheckCircle2, Circle, AlertTriangle, Sparkles } from 'lucide-react'
import type { Warehouse } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import { createLayout, saveGeometry } from '@/services/supabase/layoutService'
import { layoutKeys } from '@/hooks/queries/useLayouts'
import { useFloorplanImport, type ImportPhase } from '@/hooks/queries/useFloorplanImport'

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
// carries an ETA hint to reassure the operator the process isn't stuck.
const STEPS: ReadonlyArray<{ key: ImportPhase; label: string; hint?: string }> = [
  { key: 'compressing', label: 'Preparing image' },
  { key: 'uploading', label: 'Uploading' },
  { key: 'extracting', label: 'Reading the plan with AI', hint: 'This can take up to a minute.' },
]
const PHASE_ORDER: ImportPhase[] = ['idle', 'compressing', 'uploading', 'extracting', 'done', 'error']

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

export function FloorPlanImportModal({ warehouse, onClose, onDraftCreated }: FloorPlanImportModalProps) {
  const qc = useQueryClient()
  const { phase, result, error, run, reset } = useFloorplanImport(warehouse.id)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
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

  const pickFile = (f: File | null) => {
    if (!f || !f.type.startsWith('image/')) return
    reset()
    setCreateError(null)
    setFile(f)
  }

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
      const placements = result.draft.placements.map((p) =>
        p.new_bin
          ? { ...p, new_bin: { ...p.new_bin, code: `${p.new_bin.code}-L${layout.id}` } }
          : p,
      )
      await saveGeometry(layout.id, placements, result.draft.objects)
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
            {STEPS.map((step) => {
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
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Racks', value: result.counts.racks },
                { label: 'Zones', value: result.counts.zones },
                { label: 'Structure', value: result.counts.objects },
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
            {result.notes && <p className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-stone-500">{result.notes}</p>}
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
              onClick={() => file && run(file)}
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
