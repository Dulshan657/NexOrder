// User-facing name for the placed leaf storage unit. Internally the data model
// calls it a BIN (locations.kind='BIN', tool id 'rack'), but operators think in
// racks — these are large physical racks, not small bins. Centralised so the
// wording is consistent and a future re-label is a one-line change. This is a
// DISPLAY string only; it must never leak into codes, kinds, or DB values.
export const STORAGE_UNIT = {
  singular: 'Rack',
  plural: 'Racks',
  lower: 'rack',
  lowerPlural: 'racks',
} as const
