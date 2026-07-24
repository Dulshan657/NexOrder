import { supabase } from '@/lib/supabase'

// Thin client over the generate-labels Edge Function (mig 00074 bucket +
// label_print_log). All the work is server-side; this only shapes the request
// and hands back the signed URL the UI opens for printing.

export type LabelKind = 'location' | 'product' | 'handling_unit'
export type LabelPreset = 'a4-24' | 'a4-14' | 'a4-8'

export interface GenerateLabelsInput {
  kind: LabelKind
  preset?: LabelPreset
  /** Skip N cells on the first page so a part-used sticker sheet can be reused. */
  startOffset?: number
  warehouseId?: number
  locationKinds?: string[]
  ids?: number[]
}

export interface GenerateLabelsResult {
  storagePath: string
  signedUrl: string | null
  labelCount: number
}

export async function generateLabels(input: GenerateLabelsInput): Promise<GenerateLabelsResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    storagePath: string
    signedUrl: string | null
    labelCount: number
  }>('generate-labels', {
    body: {
      kind: input.kind,
      preset: input.preset ?? 'a4-24',
      startOffset: input.startOffset ?? 0,
      warehouseId: input.warehouseId,
      locationKinds: input.locationKinds,
      ids: input.ids,
    },
    // Rendering a full-warehouse sheet (MAIN is ~945 levels) embeds a QR per
    // label and can outrun the global 20s fetch ceiling in lib/supabase.ts.
    // functions-js attaches its own AbortSignal, which bypasses that ceiling
    // and enforces this bound instead (same reasoning as extractFloorplan).
    timeout: 90_000,
  })
  if (error) throw error
  if (!data) throw new Error('Label generation returned no result')
  return { storagePath: data.storagePath, signedUrl: data.signedUrl, labelCount: data.labelCount }
}

export interface LabelPrintLogRow {
  id: number
  labelKind: LabelKind
  labelCount: number
  warehouseId: number | null
  storagePath: string
  createdAt: string
}

/** Recent label runs, so a sheet can be re-downloaded rather than regenerated. */
export async function listLabelPrintLog(limit = 20): Promise<LabelPrintLogRow[]> {
  const { data, error } = await supabase
    .from('label_print_log')
    .select('id, label_kind, label_count, warehouse_id, storage_path, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    labelKind: r.label_kind as LabelKind,
    labelCount: r.label_count as number,
    warehouseId: (r.warehouse_id as number | null) ?? null,
    storagePath: r.storage_path as string,
    createdAt: r.created_at as string,
  }))
}

/** Fresh signed URL for a previously generated sheet. */
export async function signLabelSheet(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('warehouse-labels')
    .createSignedUrl(storagePath, 600)
  if (error) throw error
  return data?.signedUrl ?? null
}
