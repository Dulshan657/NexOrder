// One place where "name primary, code secondary" is defined.
//
// Before mig 00094 roughly forty surfaces each rendered a bare `{code}` in
// font-mono, and any of them could drift. Now that a location has both a
// readable name and a scannable code, the relationship between the two is a
// design decision that belongs in one component rather than forty:
//
//   Chiller · Rack 7 · L4     <- what the operator reads and repeats out loud
//   NEXG-B-9-4-L4             <- what the QR encodes and what a scan matches
//
// The code never leaves the screen. An operator matching a rack sticker, an
// admin quoting a bin in a message, and anyone searching still need it.
//
// A location with no useful name (every bin on a warehouse that predates 00094,
// where `name` is `Bin 9,4`) collapses to just the code — locationSubtitle
// returns '' in that case, so nothing renders the same string twice.

import { locationSubtitle, locationTitle, type DisplayLocation } from '@/lib/locationDisplay'

interface LocationLabelProps {
  location: DisplayLocation | null | undefined
  /** 'stacked' = name over code (rows, cards). 'inline' = name then code on one
   *  line (tight spots, table cells). */
  layout?: 'stacked' | 'inline'
  className?: string
  /** Override the headline size; the code stays deliberately small. */
  titleClassName?: string
  codeClassName?: string
  /** Rendered when there is no location at all. */
  fallback?: string
}

export function LocationLabel({
  location,
  layout = 'stacked',
  className = '',
  titleClassName = 'text-sm font-medium text-stone-700',
  codeClassName = 'font-mono text-[11px] text-stone-400',
  fallback = '—',
}: LocationLabelProps) {
  if (!location) {
    return <span className={`text-sm text-stone-400 ${className}`}>{fallback}</span>
  }

  const title = locationTitle(location)
  const code = locationSubtitle(location)
  // Both strings in `title` so the full pair survives every truncation this is
  // dropped into — the canvases make the same promise via <title>.
  const tooltip = code ? `${title} · ${code}` : title

  if (layout === 'inline') {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${className}`} title={tooltip}>
        <span className={titleClassName}>{title}</span>
        {code && <span className={codeClassName}>{code}</span>}
      </span>
    )
  }

  return (
    <span className={`inline-flex flex-col leading-tight ${className}`} title={tooltip}>
      <span className={titleClassName}>{title}</span>
      {code && <span className={codeClassName}>{code}</span>}
    </span>
  )
}

export default LocationLabel
