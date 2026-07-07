// Orchestrates the floor-plan import: compress the chosen image, upload it to a
// signed URL, then run OpenAI extraction. Exposes granular progress so the modal
// can show a stepper. Creating the actual draft layout is a separate concern
// (the modal calls the layout service once the operator confirms).

import { useCallback, useState } from 'react'
import { compressImage } from '@/lib/imageCompression'
import {
  requestUploadUrl,
  uploadFloorplan,
  extractFloorplan,
  type FloorplanExtractResult,
} from '@/services/supabase/floorplanService'

export type ImportPhase = 'idle' | 'compressing' | 'uploading' | 'extracting' | 'done' | 'error'

interface UseFloorplanImport {
  phase: ImportPhase
  result: FloorplanExtractResult | null
  error: string | null
  run: (file: File) => Promise<void>
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

  const run = useCallback(async (file: File) => {
    setError(null)
    setResult(null)
    try {
      setPhase('compressing')
      // Floor plans carry fine detail (aisle labels, rack lines) — keep the long
      // edge generous so the model can still read them, but re-encode to a small WebP.
      const compressed = await compressImage(file, { maxWidthOrHeight: 2000, quality: 0.85 })

      setPhase('uploading')
      const target = await requestUploadUrl(warehouseId, 'image/webp')
      await uploadFloorplan(target, compressed)

      setPhase('extracting')
      const extracted = await extractFloorplan(target.importId)
      setResult(extracted)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setPhase('error')
    }
  }, [warehouseId])

  return { phase, result, error, run, reset }
}
