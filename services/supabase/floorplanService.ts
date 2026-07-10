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
  /** Raw merged `FloorplanExtraction` JSON (pre-normalize). The client never
   *  introspects this — it only echoes it back on the reconcile round trip.
   *  Optional: absent on an older deployed function or in standard fidelity. */
  extraction?: unknown
}

/** Grid dims pinned by the client (from the source image's own aspect ratio)
 *  so the model no longer freely guesses proportions. */
export interface FloorplanGrid {
  width: number
  height: number
}

/** The render-and-reconcile round trip: the client renders the pass-1/2 draft
 *  back to an image (same coordinate system as the source overlay), uploads
 *  it, and asks the server to compare it against the source + the raw
 *  extraction JSON it echoed back, correcting misplaced/missing/spurious
 *  rectangles. */
export interface FloorplanReconcile {
  /** Storage path of the uploaded draft render (`kind:'reconcile'` upload). */
  renderPath: string
  /** The raw merged `FloorplanExtraction` JSON from the pass-1/2 response,
   *  echoed back verbatim — the client never introspects its shape. */
  extraction: unknown
}

export interface FloorplanExtractOptions {
  fidelity?: FloorplanFidelity
  grid?: FloorplanGrid
  reconcile?: FloorplanReconcile
}

/** Run OpenAI vision over the uploaded image and get a normalized draft back.
 *  `fidelity` defaults to 'standard' (single pass) server-side when omitted;
 *  'high' runs a two-pass extraction (~3–4x the cost/latency) for finer rack
 *  row / pallet area detail, optionally followed by a render-and-reconcile
 *  round trip (see `FloorplanReconcile`). `grid` pins gridWidth/gridHeight to
 *  the source image's own aspect ratio instead of letting the model guess. */
export async function extractFloorplan(
  importId: string,
  opts?: FloorplanExtractOptions,
): Promise<FloorplanExtractResult> {
  const { fidelity, grid, reconcile } = opts ?? {}
  const { data, error } = await supabase.functions.invoke<FloorplanExtractResult>('extract-floorplan', {
    body: {
      importId,
      ...(fidelity ? { fidelity } : {}),
      ...(grid ? { gridWidth: grid.width, gridHeight: grid.height } : {}),
      ...(reconcile ? { reconcile } : {}),
    },
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

/** Create a signed upload URL for the render-and-reconcile pass's draft
 *  render (high fidelity only) — mirrors `requestUploadUrl`'s response shape
 *  (signed upload URL + storage path), just scoped to an already-existing
 *  import via `kind: 'reconcile'` instead of creating a new import row. The
 *  server always writes the render as webp at a deterministic path, so no
 *  mimeType is needed here (unlike the new-import branch). */
export async function requestReconcileUploadUrl(importId: string): Promise<UploadTarget> {
  const { data, error } = await supabase.functions.invoke<UploadTarget>('create-floorplan-upload-url', {
    body: { importId, kind: 'reconcile' },
  })
  if (error) throw error
  return data as UploadTarget
}
