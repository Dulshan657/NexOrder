// The Nex mark as a standalone SVG document, for campaign use: built from the same
// geometry as the in-app component (components/voice/nexMarkGeometry.ts), with its
// own <style> so it needs nothing from the app.
//
//   animated: one LOOP_S loop - draw on, rest, shimmer (glint, arrow nudge, glow),
//             rest, then fade the mark out so the loop's cut back to the start is soft
//   static:   the finished mark, no <style>
//
// Every keyframe offset is a fraction of the loop, written from the same moments the
// app's CSS uses (index.css, nex-mark-*), so the campaign loop and the launcher move alike.

import { NEX_MARK, NEX_MARK_COLOURS } from '../../components/voice/nexMarkGeometry'

export const LOOP_S = 4.5

const { stroke: W, paths, bounds, centre, discFill, arrow } = NEX_MARK
const MARK_WIDTH = bounds.maxX - bounds.minX
const DISC_SCALE = (100 * discFill) / MARK_WIDTH
const DISC_TRANSFORM = `translate(${50 - centre[0] * DISC_SCALE} ${50 - centre[1] * DISC_SCALE}) scale(${DISC_SCALE})`
const BARE_SIDE = Math.max(MARK_WIDTH, bounds.maxY - bounds.minY) + W / 2
const BARE_VIEWBOX = `${centre[0] - BARE_SIDE / 2} ${centre[1] - BARE_SIDE / 2} ${BARE_SIDE} ${BARE_SIDE}`
/** The animated bare mark also needs room for the arrow's nudge (9, -15.5) past its tip. */
const NUDGE_ROOM = 24
const BARE_ANIMATED_SIDE = BARE_SIDE + 2 * NUDGE_ROOM
const BARE_ANIMATED_VIEWBOX = `${centre[0] - BARE_ANIMATED_SIDE / 2} ${centre[1] - BARE_ANIMATED_SIDE / 2} ${BARE_ANIMATED_SIDE} ${BARE_ANIMATED_SIDE}`

/** Seconds in the loop -> keyframe percentage. */
const at = (s: number): string => `${((s / LOOP_S) * 100).toFixed(2)}%`
const EASE_DRAW = 'cubic-bezier(0.65, 0, 0.25, 1)'
const EASE_SPRING = 'cubic-bezier(0.3, 1.5, 0.5, 1)'
const EASE_SWEEP = 'cubic-bezier(0.45, 0, 0.25, 1)'
const SHIMMER = 2.0 // the shimmer starts here
const FADE = 4.2 // the mark fades out from here to the loop's end

const LOOP_CSS = `
.s { stroke-dasharray: 1 2; }
.hd { transform-box: fill-box; transform-origin: 50% 50%; }
.mk { animation: mk ${LOOP_S}s linear infinite; }
.bk { animation: bk ${LOOP_S}s linear infinite; }
.fr { animation: fr ${LOOP_S}s linear infinite; }
.in { animation: in ${LOOP_S}s linear infinite; }
.jn { animation: jn ${LOOP_S}s linear infinite; }
.hd { animation: hd ${LOOP_S}s linear infinite; }
.bd { animation: bd ${LOOP_S}s linear infinite; }
.gl { animation: gl ${LOOP_S}s linear infinite; }
@keyframes mk { 0%, ${at(FADE)} { opacity: 1; } 100% { opacity: 0; } }
@keyframes bk { 0%, ${at(0.05)} { stroke-dashoffset: 1.1; animation-timing-function: ${EASE_DRAW}; } ${at(0.75)}, 100% { stroke-dashoffset: 0; } }
@keyframes fr { 0%, ${at(0.3)} { stroke-dashoffset: 1.1; animation-timing-function: ${EASE_DRAW}; } ${at(1.15)}, 100% { stroke-dashoffset: 0; } }
@keyframes in { 0%, ${at(0.75)} { opacity: 0; } ${at(1.0)}, 100% { opacity: 1; } }
@keyframes jn {
  0%, ${at(1.1)} { opacity: 0; } ${at(1.35)} { opacity: 1; }
  ${at(SHIMMER + 0.4)} { opacity: 1; } ${at(SHIMMER + 0.51)}, ${at(SHIMMER + 1.12)} { opacity: 0; } ${at(SHIMMER + 1.3)}, 100% { opacity: 1; }
}
@keyframes hd {
  0%, ${at(1.02)} { opacity: 0; transform: translate(-22px, 38px) scale(0.5); animation-timing-function: ${EASE_SPRING}; }
  ${at(1.47)} { opacity: 1; transform: none; }
  ${at(SHIMMER + 0.4)} { transform: none; animation-timing-function: ${EASE_SPRING}; }
  ${at(SHIMMER + 0.76)} { transform: translate(9px, -15.5px); animation-timing-function: ${EASE_SPRING}; }
  ${at(SHIMMER + 1.3)}, 100% { opacity: 1; transform: none; }
}
@keyframes bd {
  0%, ${at(SHIMMER)} { transform: translateX(-300px); animation-timing-function: ${EASE_SWEEP}; }
  ${at(SHIMMER + 1.3)}, 100% { transform: translateX(650px); }
}
@keyframes gl {
  0%, ${at(SHIMMER)} { opacity: 0; animation-timing-function: ease-in-out; }
  ${at(SHIMMER + 0.68)} { opacity: 1; animation-timing-function: ease-in-out; }
  ${at(SHIMMER + 1.5)}, 100% { opacity: 0; }
}
`

function strokes(ink: string, animated: boolean): string {
  const c = (name: string) => (animated ? ` class="${name}"` : '')
  return (
    `<g fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path${c('s bk')} pathLength="1" d="${paths.back}"/>` +
    `<path${c('s fr')} pathLength="1" d="${paths.front}"/></g>` +
    `<path${c('in')} d="${paths.inner}" fill="${ink}"/>` +
    `<path${c('jn')} d="${paths.joins}" fill="${ink}"/>` +
    `<path${c('hd')} d="${paths.head}" fill="${ink}" stroke="${ink}" stroke-width="${2 * arrow.round}" stroke-linejoin="round"/>`
  )
}

function inkGradient(id: string, stops: readonly string[]): string {
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${bounds.minX}" y1="${bounds.maxY}" x2="${bounds.maxX}" y2="${bounds.minY}">` +
    `<stop offset="0" stop-color="${stops[0]}"/><stop offset="1" stop-color="${stops[1]}"/></linearGradient>`
  )
}

function svg(viewBox: string, body: string, animated: boolean): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Nex">` +
    (animated ? `<style>${LOOP_CSS}</style>` : '') +
    body +
    '</svg>\n'
  )
}

/** The disc variant: navy disc, cyan ink, glint and glow (the launcher). */
export function discSvg(animated: boolean): string {
  const c = NEX_MARK_COLOURS
  const defs =
    '<defs>' +
    `<linearGradient id="bg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${c.disc[0]}"/><stop offset="0.55" stop-color="${c.disc[1]}"/><stop offset="1" stop-color="${c.disc[2]}"/></linearGradient>` +
    '<radialGradient id="hi" cx="0.3" cy="0.22" r="0.75"><stop offset="0" stop-color="#7fd2ff" stop-opacity="0.22"/><stop offset="1" stop-color="#7fd2ff" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfeaff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#bfeaff" stop-opacity="0.06"/><stop offset="1" stop-color="#bfeaff" stop-opacity="0.16"/></linearGradient>' +
    '<radialGradient id="glow"><stop offset="0.62" stop-color="#38bdf8" stop-opacity="0.55"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>' +
    inkGradient('ink', c.ink) +
    '<linearGradient id="band" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<mask id="mask" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="800"><g transform="rotate(20 411 384)">' +
    '<rect class="bd" x="100" y="-100" width="190" height="1000" fill="url(#band)" transform="translate(-300 0)"/></g></mask>' +
    '<filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>' +
    '</defs>'
  const glow = animated ? '<circle class="gl" cx="50" cy="50" r="62" fill="url(#glow)"/>' : ''
  const glint = animated
    ? `<g mask="url(#mask)"><g filter="url(#blur)" opacity="0.9">${strokes('#e9fbff', true)}</g>${strokes(c.glint, true)}</g>`
    : ''
  const body =
    defs +
    glow +
    '<circle cx="50" cy="50" r="50" fill="url(#bg)"/><circle cx="50" cy="50" r="50" fill="url(#hi)"/>' +
    '<circle cx="50" cy="50" r="49.4" fill="none" stroke="url(#rim)" stroke-width="1.2"/>' +
    `<g${animated ? ' class="mk"' : ''} transform="${DISC_TRANSFORM}">${strokes('url(#ink)', animated)}${glint}</g>`
  return svg(animated ? '-14 -14 128 128' : '0 0 100 100', body, animated)
}

/** The bare variant: the mark alone in the brand blues (the sheet header). */
export function bareSvg(animated: boolean, stops: readonly string[] = NEX_MARK_COLOURS.bareLight): string {
  const body = `<defs>${inkGradient('ink', stops)}</defs><g${animated ? ' class="mk"' : ''}>${strokes('url(#ink)', animated)}</g>`
  return svg(animated ? BARE_ANIMATED_VIEWBOX : BARE_VIEWBOX, body, animated)
}
