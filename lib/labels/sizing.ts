// Client-side entry point for the label size wizard.
//
// The sizing rules live in the pure shared module so the Edge Function and the
// browser run the very same code — the wizard's verdict ("0.31mm bars, readable
// up close but not from a metre") is not a second implementation of the
// server's decision, it IS the server's decision, evaluated early. Any drift
// between two copies would show up as the wizard promising a sheet the server
// then refused, or staying quiet about one it accepted.
//
// Mirrors lib/binCount.ts and lib/replenPolicy.ts, which do the same job for the
// count sheet and the replenishment grid.

export {
  MIN_X_DIMENSION_MM,
  MIN_X_FOR_DISTANCE,
  SCAN_DISTANCE_LABELS,
  fitCode,
  fitRun,
  recommendPresets,
  refuseRun,
} from '@/supabase/functions/_shared/labels/sizing'

export type {
  CodeFit,
  RunFit,
  ScanDistance,
  Verdict,
} from '@/supabase/functions/_shared/labels/sizing'

export {
  MM,
  SHEET_PRESETS,
  SHEET_PRESET_INFO,
  fitBarcode,
  labelArtwork,
  labelsPerPage,
  layoutLabels,
  sheetSpec,
} from '@/supabase/functions/_shared/labelSheet'

export type {
  BarcodeFit,
  LabelArtwork,
  LabelCell,
  SheetPresetName,
} from '@/supabase/functions/_shared/labelSheet'

export { darkRuns, encodeCode128 } from '@/supabase/functions/_shared/labels/code128'
export type { Code128Symbol, Code128Run } from '@/supabase/functions/_shared/labels/code128'
