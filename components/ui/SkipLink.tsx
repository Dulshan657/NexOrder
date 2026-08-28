/**
 * "Skip to main content" — the first thing keyboard focus reaches.
 *
 * Without it, a keyboard or screen-reader user tabs through the entire sidebar
 * on every screen before reaching the thing they came for. In this app that is
 * up to 44 navigation buttons, repeated on every view change, and it is WCAG 2.2
 * SC 2.4.1 (Bypass Blocks).
 *
 * VISIBLE ONLY ON FOCUS, and that is the whole design: `sr-only` takes it out of
 * the layout for everyone else, and `focus:not-sr-only` brings it back the
 * instant it is focused. A skip link that is always visible is a design change
 * nobody asked for; one that never becomes visible is a trap, because a sighted
 * keyboard user cannot see where their focus has gone.
 *
 * `position: fixed` rather than `absolute`: the shell root is
 * `h-svh overflow-hidden`, so an absolutely-positioned element would be clipped
 * by the first ancestor that establishes a containing block, and the link would
 * be focusable and invisible — the worst of both.
 */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className={
        'sr-only focus:not-sr-only ' +
        'focus:fixed focus:left-4 focus:top-4 focus:z-[2000] ' +
        'focus:rounded-lg focus:bg-nexgen-blue-dark focus:px-4 focus:py-2.5 ' +
        'focus:text-sm focus:font-semibold focus:text-white focus:shadow-elevated ' +
        'focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-nexgen-blue-dark'
      }
    >
      Skip to main content
    </a>
  )
}
