// Client-side entry point for live area painting.
//
// Packing, fingerprinting and the name cascade live in the pure shared module so
// the Edge Function and the browser run the very same code. Two things depend on
// that being literally true rather than merely equivalent: the CONFLICT
// fingerprint (a byte of drift and every save 409s on a picture nobody changed),
// and the summary panel's "24 racks would be renamed", which must BE the server's
// decision evaluated early rather than a second copy of it.
//
// Mirrors lib/locationNaming.ts ↔ _shared/wie/locationNaming.ts. Import from here
// in components; never reach into supabase/functions directly from a view.

export {
  packAreaRuns,
  expandAreaRuns,
  areaZoneProfileOf,
  areaSpecsFromObjects,
  areaObjectsFromSpecs,
  areaCellsFingerprint,
  diffAreas,
  planAreaCascade,
} from '@/supabase/functions/_shared/wie/areaPaint'

export type {
  AreaPaintCell,
  AreaPaintRun,
  AreaPaintSpec,
  AreaGeometryDelta,
  AreaCascadeOptions,
  AreaCascadePlan,
} from '@/supabase/functions/_shared/wie/areaPaint'
