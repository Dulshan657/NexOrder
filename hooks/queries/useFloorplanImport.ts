// Orchestrates the floor-plan import: compress the chosen image, upload it to a
// signed URL, then run OpenAI extraction. Exposes granular progress so the modal
// can show a stepper. Creating the actual draft layout is a separate concern
// (the modal calls the layout service once the operator confirms).

import { useCallback, useState } from 'react'
import { compressImage } from '@/lib/imageCompression'
import { withTimeout } from '@/lib/withTimeout'
import { computeGridDims, drawGridOverlay, renderDraftToBlob } from '@/lib/floorplanGridOverlay'
import {
  requestUploadUrl,
  requestReconcileUploadUrl,
  uploadFloorplan,
  extractFloorplan,
  type FloorplanExtractResult,
  type FloorplanFidelity,
} from '@/services/supabase/floorplanService'

export type ImportPhase =
  | 'idle'
  | 'compressing'
  | 'uploading'
  | 'extracting'
  /** High fidelity only: the client renders the pass-1/2 draft back to an
   *  image and asks the server to compare it against the source scan. */
  | 'refining'
  | 'done'
  | 'error'

// Wall-clock bounds so a stalled call surfaces an error + retry instead of an
// endless "Uploading…". These sit ABOVE supabase-js's own fetch handling — they
// also catch a stall in the pre-fetch token step, which the global 20s fetch
// ceiling (lib/supabase.ts) cannot reach. (Extraction is bounded separately, by
// the per-invoke `timeout` in floorplanService — it legitimately runs for minutes.)
const UPLOAD_URL_TIMEOUT_MS = 25_000
const UPLOAD_PUT_TIMEOUT_MS = 45_000

interface UseFloorplanImport {
  phase: ImportPhase
  result: FloorplanExtractResult | null
  error: string | null
  /** `fidelity` defaults to 'standard' server-side when omitted. */
  run: (file: File, fidelity?: FloorplanFidelity) => Promise<void>
  reset: () => void
}

export function useFloorplanImport(warehouseId: number): UseFloorplanImport {
  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [result, setResult] = useState<FloorplanExtractResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setResult(null)
    setError(null)
  }, [])

  const run = useCallback(async (file: File, fidelity?: FloorplanFidelity) => {
    setError(null)
    setResult(null)
    try {
      setPhase('compressing')
      // Floor plans carry fine detail (aisle labels, rack lines) — keep the long
      // edge generous so the model can still read them, but re-encode to a small WebP.
      const compressed = await compressImage(file, { maxWidthOrHeight: 2000, quality: 0.85 })

      // Pin the grid to the image's own aspect ratio (the model no longer
      // freely guesses proportions), then draw the labeled red coordinate
      // overlay onto the compressed image. The AI only ever sees the
      // OVERLAID copy — the modal's clean preview reads from the original
      // `File` separately (see `previewUrl` in FloorPlanImportModal).
      const bitmap = await createImageBitmap(compressed)
      const grid = computeGridDims(bitmap.width, bitmap.height)
      bitmap.close?.()
      const overlaid = await drawGridOverlay(compressed, grid.gridWidth, grid.gridHeight)

      setPhase('uploading')
      const target = await withTimeout(
        requestUploadUrl(warehouseId, 'image/webp'),
        UPLOAD_URL_TIMEOUT_MS,
        'Preparing the upload took too long — check your connection and try again.',
      )
      await withTimeout(
        uploadFloorplan(target, overlaid),
        UPLOAD_PUT_TIMEOUT_MS,
        'Uploading the image timed out — check your connection and try again.',
      )

      setPhase('extracting')
      let extracted = await extractFloorplan(target.importId, {
        fidelity,
        grid: { width: grid.gridWidth, height: grid.gridHeight },
      })

      // High fidelity only: render the draft back to an image (same
      // coordinate system as the source overlay) and ask the server to
      // reconcile it against the source scan + the raw extraction JSON. A
      // hiccup here should never sink the whole import — fall back to the
      // pass-1/2 result and just log it.
      if (fidelity === 'high' && extracted.extraction) {
        try {
          setPhase('refining')
          const renderBlob = await renderDraftToBlob({
            objects: extracted.draft.objects,
            placements: extracted.draft.placements,
            gridWidth: extracted.draft.gridWidth,
            gridHeight: extracted.draft.gridHeight,
          })
          const reconcileTarget = await withTimeout(
            requestReconcileUploadUrl(target.importId),
            UPLOAD_URL_TIMEOUT_MS,
            'Preparing the refinement upload took too long.',
          )
          await withTimeout(
            uploadFloorplan(reconcileTarget, renderBlob),
            UPLOAD_PUT_TIMEOUT_MS,
            'Uploading the refinement render timed out.',
          )
          extracted = await extractFloorplan(target.importId, {
            fidelity: 'high',
            grid: { width: grid.gridWidth, height: grid.gridHeight },
            reconcile: { renderPath: reconcileTarget.path, extraction: extracted.extraction },
          })
        } catch (refineError) {
          console.warn('Floor-plan reconcile pass failed; keeping the pre-refinement draft', refineError)
        }
      }

      setResult(extracted)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setPhase('error')
    }
  }, [warehouseId])

  return { phase, result, error, run, reset }
}
