// The recode panel's class vocabulary.
//
// Same idiom as `inputClass` in components/ui/Field: one place that decides what a
// chip or a section label looks like, so four step files cannot drift apart. That is
// not hypothetical here — before this the panel mixed `text-[11px]` and `text-xs`
// for the same job across the four steps, `p-2` and `p-3` for the same kind of card,
// and two different focus rings.
//
// THE DENSITY RULE, stated once so it can be applied consistently:
//
//   `text-[11px]` survives only for uppercase section labels, step-rail labels and
//   mono micro-chips. Every SENTENCE is text-xs. Every DECISION or COUNT is text-sm.
//   A hero number is text-2xl font-display tabular-nums.
//
// The panel is 24rem wide, which at text-xs inside px-4 is about 52 characters. At
// the previous 22rem it was 46, which is what "cramped" actually was.

/** An uppercase section eyebrow. */
export const SECTION_LABEL =
  'text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400'

/** A pill: quick-select shortcuts, inline actions inside a card. */
export const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'

/** A resting surface inside the body — never nested inside another card. */
export const CARD = 'rounded-lg border border-stone-200 bg-stone-50/70 p-3'

/** A secondary action, the size the dense panel wants. */
export const MINI_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'

/** Explanatory prose. A sentence, so text-xs by the rule above. */
export const HINT = 'text-xs leading-relaxed text-stone-500'

/** One segment of a segmented control.
 *
 *  `tone` exists for Erase, which is tinted ROSE rather than blue when armed: while
 *  painting, "what will my drag do" has to be readable in peripheral vision, and two
 *  identically-blue pills do not answer that. */
export function segment(active: boolean, tone: 'accent' | 'danger' = 'accent'): string {
  const base =
    'flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-xs font-medium btn-press transition-colors'
  if (!active) return `${base} text-stone-500 hover:text-stone-700`
  return tone === 'danger'
    ? `${base} bg-white text-rose-600 shadow-card`
    : `${base} bg-white text-nexgen-blue shadow-card`
}

/** The track a `segment` row sits in. */
export const SEGMENT_GROUP =
  'flex gap-0.5 rounded-lg border border-stone-200 bg-stone-100/80 p-0.5'
