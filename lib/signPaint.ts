// Client-side entry point for floor signs.
//
// Packing and fingerprinting live in the pure shared module so the Edge Function
// and the browser run the very same code. The CONFLICT fingerprint depends on
// that being literally true rather than merely equivalent: a byte of drift and
// every save 409s on a picture nobody changed.
//
// Mirrors lib/areaPaint.ts ↔ _shared/wie/areaPaint.ts. Import from here in
// components; never reach into supabase/functions directly from a view.

export {
  SIGN_OBJECT_TYPE,
  MAX_SIGN_NAME,
  packSignRuns,
  expandSignRuns,
  signSpecsFromObjects,
  signObjectsFromSpecs,
  signCellsFingerprint,
  diffSigns,
  sanitizeSignName,
  sanitizeSignNameInput,
  signNameIssue,
} from '@/supabase/functions/_shared/wie/signPaint'

export type { SignSpec, SignCell, SignRun } from '@/supabase/functions/_shared/wie/signPaint'
