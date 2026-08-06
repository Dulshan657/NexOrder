// Client-side entry point for friendly location names.
//
// The composition and numbering rules live in the pure shared module so the Edge
// Function and the browser run the very same code — the designer's "this rack
// will be called Chiller · Rack 7" is not a second implementation of the server's
// decision, it IS the server's decision, evaluated early.
//
// Mirrors lib/binCount.ts ↔ _shared/binCount.ts and lib/replenPolicy.ts ↔
// _shared/wie/replenPolicy.ts. Import from here in components; never reach into
// supabase/functions directly from a view.

export {
  NAME_SEP,
  RACK_WORD,
  MAX_AREA_NAME,
  areaNameOf,
  buildAreaIndex,
  areaNameAt,
  areaNameAtIndexed,
  areaForRect,
  composeName,
  sanitizeAreaName,
  sanitizeAreaNameInput,
  areaNameIssue,
  isUninformativeName,
  assignAutoNames,
  nextSeqForArea,
  highWaterFromRows,
  describeSeqRanges,
} from '@/supabase/functions/_shared/wie/locationNaming'

export type {
  AreaCellSource,
  AreaIndex,
  NamedRect,
  NamingUnit,
  NamingOptions,
  NamedUnit,
  NamingResult,
} from '@/supabase/functions/_shared/wie/locationNaming'
