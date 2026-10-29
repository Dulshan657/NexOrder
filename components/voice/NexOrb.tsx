import { useEffect, useRef, useState } from 'react'
import { MODE_FRAMES, resolvePreset } from 'thinking-orbs/engine'
import type { OrbFrame, OrbSize } from 'thinking-orbs/engine'
import type { LevelSource } from '@/lib/voice/voiceSession'
import { MAX_STEP_SEC, approach, burstVelocity, easeInOut, stateTempo } from './orbMotion'
import type { OrbVisual } from './orbState'
import type { StatusTone } from './voiceStatus'
import { useReducedMotion } from './useReducedMotion'

// Nex's orb: the dotted 3D sphere from thinking-orbs' pure engine, painted here so
// it can be any size, take the status pill's colour and follow real loudness.
//
//   animate="live"  - the sheet's hero orb. Runs while the session is doing
//                     something; a listening orb swells with the rep's mic and a
//                     speaking one with Nex's voice (getLevel, read per frame).
//   animate="burst" - the launcher and header icons. A still frame that plays for
//                     BURST_MS each time playToken changes (or once on mount).
//
// FLUID BY CONSTRUCTION (orbMotion.ts): nothing the orb shows is set, it is eased
// toward. Speed, size and loudness approach their targets by elapsed time; the
// animation's clock is never reset, so stopping holds the frame it reached rather
// than snapping back; a burst rises from rest and settles to rest; and a state
// change cross-fades on an eased curve at an evened-out tempo.
//
// Decorative: aria-hidden, because the status pill's role="status" already says
// what is happening. Reduced motion gets one still frame; a hidden tab stops the
// loop. Depth is carried by dot alpha, as the library carries it by ink weight.

export const BURST_MS = 900
const FADE_MS = 450
const MAX_DPR = 2
/** The engine's time at which every mode shows a representative still frame. */
const STILL_T = 0.6
/** At full loudness the orb is this much bigger, and turns this much faster. */
const LEVEL_SCALE = 0.08
const LEVEL_SPEED = 0.5
/** Seconds to close ~63% of the gap: the orb's size, and its speed. */
const LEVEL_TAU = 0.12
const SPEED_TAU = 0.4
/** Up to this CSS size the 20 px preset (fewer, larger dots) reads better than the 64. */
const SMALL_PRESET_MAX = 40

const TONE_INK: Readonly<Record<StatusTone, readonly [cssVar: string, fallback: string]>> = {
  emerald: ['--color-emerald-500', '#00bc7d'],
  amber: ['--color-amber-500', '#fe9a00'],
  blue: ['--color-nexgen-blue', '#2988de'],
  stone: ['--color-stone-500', '#79716b'],
  rose: ['--color-rose-500', '#ff2056'],
}

const inkCache = new Map<StatusTone, string>()

/** The tone's colour from the built Tailwind tokens, so the orb matches the pill's dot. */
function toneInk(tone: StatusTone): string {
  const cached = inkCache.get(tone)
  if (cached) return cached
  const [cssVar, fallback] = TONE_INK[tone]
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || fallback
  inkCache.set(tone, value)
  return value
}

export interface NexOrbProps {
  visual: OrbVisual
  /** CSS pixels, square. */
  size: number
  animate: 'live' | 'burst'
  /** Loudness 0..1 of the stream visual.audio names. Live orbs only. */
  getLevel?: (source: LevelSource) => number
  /** Burst orbs play each time this changes. */
  playToken?: number
  /** Burst orbs: play once when mounted (the sheet opening). */
  playOnMount?: boolean
  /** A fixed colour instead of the tone, e.g. white on the blue launcher. */
  ink?: string
  className?: string
}

interface Look {
  readonly state: OrbVisual['state']
  readonly tone: StatusTone
}

/** What carries over when the drawing loop restarts, so a restart never jumps. */
interface Motion {
  phase: number
  velocity: number
  level: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
/** Near dots (low `white`) opaque, far ones faint. */
const depthAlpha = (white: number): number => 0.25 + 0.75 * (1 - clamp01(white))

/** True for BURST_MS after each new token (and after mount when asked). */
function useBurst(enabled: boolean, token: number | undefined, onMount: boolean): boolean {
  const [playing, setPlaying] = useState(false)
  const seen = useRef<number | undefined | null>(onMount ? null : token)
  useEffect(() => {
    if (!enabled || seen.current === token) return
    seen.current = token
    setPlaying(true)
    const timer = setTimeout(() => setPlaying(false), BURST_MS)
    return () => clearTimeout(timer)
  }, [enabled, token])
  return enabled && playing
}

function drawFrame(ctx: CanvasRenderingContext2D, frame: OrbFrame, alpha: number): void {
  for (const line of frame.lines) {
    ctx.globalAlpha = alpha * (line.a ?? 1) * depthAlpha(line.white)
    ctx.lineWidth = line.w
    ctx.beginPath()
    ctx.moveTo(line.x1, line.y1)
    ctx.lineTo(line.x2, line.y2)
    ctx.stroke()
  }
  for (const dot of frame.dots) {
    ctx.globalAlpha = alpha * (dot.a ?? 1) * depthAlpha(dot.white)
    ctx.beginPath()
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

interface Painter {
  /** `now` (ms) enables the cross-fade between looks; a still draw passes none. */
  draw(look: Look, phase: number, level: number, now?: number): void
}

function createPainter(ctx: CanvasRenderingContext2D, size: number, dpr: number, ink: string | undefined): Painter {
  const preset: OrbSize = size <= SMALL_PRESET_MAX ? 20 : 64
  // A bigger orb covers more pixels per turn; slow it so it reads as calm, not busy.
  const sizeTempo = Math.min(1, Math.sqrt(preset / size))
  let shown: Look | null = null
  let previous: Look | null = null
  let changedAt = 0

  const drawLook = (look: Look, phase: number, level: number, alpha: number) => {
    if (alpha <= 0) return
    const { mode, speed, opts } = resolvePreset(look.state, preset)
    const t = phase * speed * stateTempo(speed) * sizeTempo
    const frame = MODE_FRAMES[mode](preset, t, opts)
    const scale = (size / preset) * (1 + LEVEL_SCALE * level)
    const offset = size / 2 - (preset / 2) * scale
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offset, dpr * offset)
    const colour = ink ?? toneInk(look.tone)
    ctx.fillStyle = colour
    ctx.strokeStyle = colour
    drawFrame(ctx, frame, alpha)
  }

  return {
    draw(look, phase, level, now) {
      if (!shown || shown.state !== look.state || shown.tone !== look.tone) {
        previous = now === undefined ? null : shown
        shown = look
        changedAt = now ?? 0
      }
      const fade = previous && now !== undefined ? easeInOut((now - changedAt) / FADE_MS) : 1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, size * dpr, size * dpr)
      if (previous && fade < 1) drawLook(previous, phase, level, 1 - fade)
      else previous = null
      drawLook(shown, phase, level, fade)
    },
  }
}

function setUpCanvas(canvas: HTMLCanvasElement, size: number): { ctx: CanvasRenderingContext2D; dpr: number } | null {
  const dpr = Math.min(MAX_DPR, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  const ctx = canvas.getContext('2d')
  return ctx ? { ctx, dpr } : null
}

/** Run `frame` every animation frame while the tab is visible; returns the stop. */
function runLoop(frame: (now: number, dtSec: number) => void): () => void {
  if (typeof requestAnimationFrame !== 'function') return () => undefined
  let raf = 0
  let last = performance.now()
  const tick = (now: number) => {
    frame(now, Math.max(0, (now - last) / 1000))
    last = now
    raf = requestAnimationFrame(tick)
  }
  const start = () => {
    cancelAnimationFrame(raf)
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
  const onVisibility = () => (document.visibilityState === 'hidden' ? cancelAnimationFrame(raf) : start())
  document.addEventListener('visibilitychange', onVisibility)
  start()
  return () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

export function NexOrb({ visual, size, animate, getLevel, playToken, playOnMount = false, ink, className }: NexOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reduced = useReducedMotion()
  const bursting = useBurst(animate === 'burst' && !reduced, playToken, playOnMount)
  const playing = animate === 'live' ? !reduced && !visual.frozen : bursting

  // The loop reads the latest visual and level source without restarting.
  const latest = useRef({ visual, getLevel })
  useEffect(() => {
    latest.current = { visual, getLevel }
  })
  // Survives loop restarts: a stop holds the frame reached, a start eases up from rest.
  const motion = useRef<Motion>({ phase: STILL_T, velocity: 0, level: 0 })

  const stillKey = playing ? '' : `${visual.state}:${visual.tone}`
  useEffect(() => {
    const canvas = canvasRef.current
    const surface = canvas ? setUpCanvas(canvas, size) : null
    if (!surface) return
    const painter = createPainter(surface.ctx, size, surface.dpr, ink)
    const look = (v: OrbVisual): Look => ({ state: v.state, tone: v.tone })
    const m = motion.current
    // Paint now, so the orb is never blank while waiting for the first frame.
    painter.draw(look(latest.current.visual), m.phase, m.level)
    if (!playing) {
      m.velocity = 0
      return
    }
    const burstStart = performance.now()
    return runLoop((now, dtSec) => {
      const { visual: v, getLevel: read } = latest.current
      const heard = v.audio && read ? clamp01(read(v.audio)) : 0
      m.level = approach(m.level, heard, dtSec, LEVEL_TAU)
      m.velocity =
        animate === 'burst'
          ? burstVelocity((now - burstStart) / BURST_MS)
          : approach(m.velocity, 1 + LEVEL_SPEED * m.level, dtSec, SPEED_TAU)
      m.phase += Math.min(dtSec, MAX_STEP_SEC) * m.velocity
      painter.draw(look(v), m.phase, m.level, now)
    })
  }, [size, ink, playing, stillKey, animate])

  return (
    <span
      aria-hidden="true"
      data-orb-state={visual.state}
      data-orb-animate={animate}
      data-orb-playing={playing ? 'true' : 'false'}
      className={`inline-block shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ width: size, height: size, display: 'block' }} />
    </span>
  )
}
