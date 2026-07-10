import { supabase } from '@/lib/supabase'
import type { SaveObjectInput, SavePlacementInput } from '@/services/supabase/layoutService'

export type FloorplanMime = 'image/png' | 'image/jpeg' | 'image/webp'

interface UploadTarget {
  importId: string
  path: string
  token: string
  bucket: string
}

/** Create an import job + a signed upload URL for the floor-plan image. */
export async function requestUploadUrl(warehouseId: number, mimeType: FloorplanMime): Promise<UploadTarget> {
  const { data, error } = await supabase.functions.invoke<UploadTarget>('create-floorplan-upload-url', {
    body: { warehouseId, mimeType },
  })
  if (error) throw error
  return data as UploadTarget
}

/** PUT the (compressed) image bytes to the signed upload URL. */
export async function uploadFloorplan(target: UploadTarget, file: Blob): Promise<void> {
  const { error } = await supabase.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file)
  if (error) throw error
}

/** A pallet-storage floor block returned by the server, with pre-generated
 *  1×1 bins per free cell. NOT part of `draft.placements` — the import modal
 *  decides per area (storable vs visual-only) before appending anything. */
export interface FloorplanPalletAreaDraft {
  code: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  placements: SavePlacementInput[]
}

export interface FloorplanDraft {
  gridWidth: number
  gridHeight: number
  floors: number
  placements: SavePlacementInput[]
  objects: SaveObjectInput[]
  /** Optional: absent on an older deployed function. */
  palletAreas?: FloorplanPalletAreaDraft[]
}

export type FloorplanFidelity = 'standard' | 'high'

export interface FloorplanExtractResult {
  importId: string
  draft: FloorplanDraft
  counts: {
    racks: number
    objects: number
    zones: number
    /** Optional: absent on an older deployed function. */
    palletAreas?: number
    /** Walkway cells the server auto-added so every rack reaches a dock. Optional: absent on an older deployed function. */
    addedWalkways?: number
    /** Wall cells carved out where a dock overlapped a wall. Optional: absent on an older deployed function. */
    removedWallCells?: number
    /** Racks still unreachable after auto-connect (needs a manual walkway/lift). Optional: absent on an older deployed function. */
    unreachable?: number
  }
  confidence: number
  needsReview: boolean
  notes: string
  /** Optional: absent on an older deployed function (which was always standard). */
  fidelity?: FloorplanFidelity
}

/** Run OpenAI vision over the uploaded image and get a normalized draft back.
 *  `fidelity` defaults to 'standard' (single pass) server-side when omitted;
 *  'high' runs a two-pass extraction (~3–4x the cost/latency) for finer rack
 *  row / pallet area detail. */
export async function extractFloorplan(importId: string, fidelity?: FloorplanFidelity): Promise<FloorplanExtractResult> {
  const { data, error } = await supabase.functions.invoke<FloorplanExtractResult>('extract-floorplan', {
    body: { importId, ...(fidelity ? { fidelity } : {}) },
  })
  if (error) throw error
  return data as FloorplanExtractResult
}

/** Short-lived signed read URL for previewing the uploaded image. */
export async function getFloorplanPreviewUrl(importId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ signedUrl: string }>('create-floorplan-upload-url', {
    body: { importId, kind: 'preview' },
  })
  if (error) throw error
  return (data as any).signedUrl as string
}
