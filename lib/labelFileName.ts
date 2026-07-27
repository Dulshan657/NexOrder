// What a downloaded label sheet is called on disk.
//
// PURE — the date is a parameter, so this is unit-testable and cannot drift with
// the clock. A label job is several PDFs that land in the same Downloads folder
// seconds apart, so the name has to say which stock it is ("bin-level-stickers"
// vs "zone-aisle-signs") and which warehouse it came from; otherwise the
// operator is opening three identically-named files to find the one they need.

import type { SheetGroup } from '@/supabase/functions/_shared/labels/layoutLabelPlan'
import type { LabelKind } from '@/services/supabase/labelService'

/**
 * Display name per sheet group. Lives here rather than in the modal so the
 * filename and the on-screen row cannot disagree about what a sheet is.
 */
export const GROUP_LABEL: Record<SheetGroup, string> = {
  wayfinding: 'Zone & aisle signs',
  slots: 'Bin & level stickers',
  staging: 'Staging & dock',
}

const KIND_LABEL: Record<LabelKind, string> = {
  location: 'Locations',
  product: 'Products',
  handling_unit: 'Pallets & cartons',
}

/** Lowercase, hyphen-joined, safe on every filesystem we care about. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** YYYY-MM-DD in local time — the day the operator printed it, not UTC's. */
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface LabelFileNameOptions {
  /** Layout run: which sheet of stock this is. */
  group?: SheetGroup | null
  /** Ad-hoc run: what was labelled. Ignored when `group` is given. */
  kind?: LabelKind | null
  /** Warehouse or layout name, prefixed when known. */
  layoutName?: string | null
  date?: Date
}

/**
 * e.g. `main-bin-level-stickers-2026-07-27.pdf`, `products-2026-07-27.pdf`.
 *
 * Every part is optional because the callers know different amounts: a layout
 * job knows its layout and its group, a "Recent runs" re-download may know
 * neither. A nameless sheet still gets a dated, valid filename.
 */
export function labelSheetFileName(opts: LabelFileNameOptions = {}): string {
  const what = opts.group
    ? GROUP_LABEL[opts.group]
    : opts.kind
      ? KIND_LABEL[opts.kind]
      : 'labels'

  const parts = [opts.layoutName ?? '', what, isoDay(opts.date ?? new Date())]
    .map(slug)
    .filter(Boolean)

  return `${parts.join('-')}.pdf`
}
