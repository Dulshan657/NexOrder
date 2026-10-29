import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { shimmerSchedule } from './markCadence'
import { NEX_MARK, NEX_MARK_COLOURS } from './nexMarkGeometry'
import { useReducedMotion } from './useReducedMotion'

// The Nex mark: the logo's two Ns and arrow, as an inline SVG drawn from
// nexMarkGeometry. Two variants:
//
//   disc - the launcher: a navy disc, the mark in blue-to-cyan ink, a glint layer
//   bare - the sheet header: the mark alone, in the brand blues
//
// Motion is CSS (index.css, `nex-mark-*`) keyed off the phase this component
// holds: it DRAWS on when mounted, SHIMMERS on markCadence's schedule and each
// time playToken changes, and RESTS otherwise. A shimmer due while the tab is
// hidden is skipped, and one asked for while it is still drawing on is ignored
// (it would cut the draw short). The idle schedule counts from the first mark
// the page showed, so a remount only plays what is left of it. Reduced motion
// gets the finished mark and no timers at all.
//
// Decorative: aria-hidden, because the button it sits in carries the label.

export const DRAW_ON_MS = 1500
export const SHIMMER_MS = 1500

type Phase = 'draw' | 'shimmer' | 'rest'

export interface NexMarkProps {
  variant: 'disc' | 'bare'
  /** CSS pixels, square. */
  size: number
  /** The shimmer replays each time this changes (a hover or a tap). */
  playToken?: number
  className?: string
}

const { stroke: W, paths, bounds, centre, discFill } = NEX_MARK
const MARK_WIDTH = bounds.maxX - bounds.minX
const DISC_SCALE = (100 * discFill) / MARK_WIDTH
const DISC_TRANSFORM = `translate(${50 - centre[0] * DISC_SCALE} ${50 - centre[1] * DISC_SCALE}) scale(${DISC_SCALE})`
const BARE_SIDE = Math.max(MARK_WIDTH, bounds.maxY - bounds.minY) + W / 2
const BARE_VIEWBOX = `${centre[0] - BARE_SIDE / 2} ${centre[1] - BARE_SIDE / 2} ${BARE_SIDE} ${BARE_SIDE}`

/** When this page first showed a mark; the idle schedule counts from here. */
let firstShownAt: number | null = null

/** Tests only: forget when the page first showed a mark. */
export function __resetNexMarkClock(): void {
  firstShownAt = null
}

function usePhase(reduced: boolean, playToken: number | undefined) {
  const [phase, setPhase] = useState<Phase>(reduced ? 'rest' : 'draw')
  const [shimmers, setShimmers] = useState(0)
  const restTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Set and cleared by the draw-on's own timer, not read back from state, so it is
  // right even before React has rendered the update.
  const drawing = useRef(!reduced)

  const shimmer = useCallback(() => {
    if (drawing.current) return
    setShimmers((n: number) => n + 1)
    setPhase('shimmer')
    clearTimeout(restTimer.current)
    restTimer.current = setTimeout(() => setPhase('rest'), SHIMMER_MS)
  }, [])

  // Draw on, then the idle shimmers.
  useEffect(() => {
    if (reduced) {
      drawing.current = false
      setPhase('rest')
      return
    }
    const now = Date.now()
    if (firstShownAt === null) firstShownAt = now
    const timers = [
      setTimeout(() => {
        drawing.current = false
        setPhase((p: Phase) => (p === 'draw' ? 'rest' : p))
      }, DRAW_ON_MS),
      ...shimmerSchedule(false, now - firstShownAt).map((at) =>
        setTimeout(() => {
          if (document.visibilityState !== 'hidden') shimmer()
        }, at),
      ),
    ]
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(restTimer.current)
    }
  }, [reduced, shimmer])

  // A hover or a tap.
  const seenToken = useRef(playToken)
  useEffect(() => {
    if (seenToken.current === playToken) return
    seenToken.current = playToken
    if (!reduced) shimmer()
  }, [playToken, reduced, shimmer])

  return { phase, shimmers }
}

function Strokes({ ink }: { ink: string }) {
  return (
    <>
      <g fill="none" stroke={ink} strokeWidth={W} strokeLinecap={NEX_MARK.linecap} strokeLinejoin={NEX_MARK.linejoin}>
        <path className="nex-mark-stroke nex-mark-back" pathLength={1} d={paths.back} />
        <path className="nex-mark-stroke nex-mark-front" pathLength={1} d={paths.front} />
      </g>
      <path className="nex-mark-inner" d={paths.inner} fill={ink} />
      <path className="nex-mark-join" d={paths.joins} fill={ink} />
      <path
        className="nex-mark-head"
        d={paths.head}
        fill={ink}
        stroke={ink}
        strokeWidth={2 * NEX_MARK.arrow.round}
        strokeLinejoin="round"
      />
    </>
  )
}

/** Ink along the arrow's direction, from the mark's bottom-left to its top-right. */
function InkGradient({ id, stops }: { id: string; stops: readonly string[] }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={bounds.minX} y1={bounds.maxY} x2={bounds.maxX} y2={bounds.minY}>
      <stop offset="0" stopColor={stops[0]} />
      <stop offset="1" stopColor={stops[1]} />
    </linearGradient>
  )
}

/** Everything sits under the shimmer key, defs included, so a re-trigger restarts the sweep and the glow too. */
function Disc({ uid, shimmerKey }: { uid: string; shimmerKey: number }) {
  const c = NEX_MARK_COLOURS
  return (
    <g key={shimmerKey}>
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={c.disc[0]} />
          <stop offset="0.55" stopColor={c.disc[1]} />
          <stop offset="1" stopColor={c.disc[2]} />
        </linearGradient>
        <radialGradient id={`${uid}hi`} cx="0.3" cy="0.22" r="0.75">
          <stop offset="0" stopColor="#7fd2ff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#7fd2ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfeaff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#bfeaff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#bfeaff" stopOpacity="0.16" />
        </linearGradient>
        <InkGradient id={`${uid}ink`} stops={c.ink} />
        <linearGradient id={`${uid}band`} x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${uid}mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="800">
          <g transform="rotate(20 411 384)">
            <rect className="nex-mark-band" x="100" y="-100" width="190" height="1000" fill={`url(#${uid}band)`} />
          </g>
        </mask>
        <filter id={`${uid}blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <radialGradient id={`${uid}glow`}>
          <stop offset="0.62" stopColor="#38bdf8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="nex-mark-glow" cx="50" cy="50" r="62" fill={`url(#${uid}glow)`} />
      <circle cx="50" cy="50" r="50" fill={`url(#${uid}bg)`} />
      <circle cx="50" cy="50" r="50" fill={`url(#${uid}hi)`} />
      <circle cx="50" cy="50" r="49.4" fill="none" stroke={`url(#${uid}rim)`} strokeWidth="1.2" />
      <g transform={DISC_TRANSFORM}>
        <Strokes ink={`url(#${uid}ink)`} />
        <g mask={`url(#${uid}mask)`}>
          <g filter={`url(#${uid}blur)`} opacity="0.9">
            <Strokes ink="#e9fbff" />
          </g>
          <Strokes ink={c.glint} />
        </g>
      </g>
    </g>
  )
}

export function NexMark({ variant, size, playToken, className }: NexMarkProps) {
  const reduced = useReducedMotion()
  const { phase, shimmers } = usePhase(reduced, playToken)
  // useId's colons are legal in an id but not inside url(#...).
  const uid = `nexmark${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-nex-mark={variant}
      data-nex-mark-phase={phase}
      data-nex-mark-playing={phase === 'rest' ? 'false' : 'true'}
      data-nex-mark-shimmers={String(shimmers)}
      viewBox={variant === 'disc' ? '0 0 100 100' : BARE_VIEWBOX}
      width={size}
      height={size}
      className={`nex-mark nex-mark--${variant} nex-mark--${phase} shrink-0 overflow-visible ${className ?? ''}`}
    >
      {variant === 'disc' ? (
        <Disc uid={uid} shimmerKey={shimmers} />
      ) : (
        <g key={shimmers}>
          <defs>
            <InkGradient id={`${uid}ink`} stops={NEX_MARK_COLOURS.bareLight} />
          </defs>
          <Strokes ink={`url(#${uid}ink)`} />
        </g>
      )}
    </svg>
  )
}
