// Class strings shared by the two surfaces that show a decided kitchen order
// (NotApprovedCard on Order home, DecidedQrRequests in Order history), so the two
// cannot drift on the parts an audit cares about.
//
// Why these and not <Button>: the shared Button's focus ring is `nexgen-blue/40`,
// which composites to ~1.6:1 against the 3:1 SC 1.4.11 asks for. `nexgen-blue-dark`
// is the ring this app uses on controls that have to pass. Likewise the primary
// fill is `nexgen-blue-dark`, not the brand `nexgen-blue`, because white text on the
// brand blue is a disclosed contrast exception this screen does not need to add to.
//
// `touch-target-y` is the 44px floor (index.css); `justify-center` + `text-center`
// keep a wrapped label tidy at 360px.

const BASE =
  'touch-target-y inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-sm font-semibold ' +
  'transition-colors btn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2'

/** "Edit and resend". */
export const RESEND_BUTTON_CLASS = `${BASE} bg-nexgen-blue-dark text-white hover:bg-nexgen-navy`

/** "Dismiss" and "Show all". */
export const QUIET_BUTTON_CLASS = `${BASE} border border-stone-300 bg-white text-stone-700 hover:bg-stone-50`

/** The badge beside a decided order's date, by tone (lib/qr/requestStatusLabel.ts). */
export const BADGE_CLASS = {
  red: 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200',
  stone: 'bg-stone-100 text-stone-700 ring-1 ring-inset ring-stone-200',
  amber: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200',
  green: 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-200',
} as const
