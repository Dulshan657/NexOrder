// The Nex mark: the logo's two stacked Ns and arrow, as geometry. Pure, so the
// component, the campaign render script and the tests all read one drawing.
//
// Coordinates are the logo's own pixel space, measured from
// public/assets/Nex-Order-no-bg-logo.png and checked by overlaying the result on it.
// The logo is built on 60-degree lines, and so is this:
//
//   - one stroke weight, round caps and joins
//   - the back N's peak is a soft arc; the front N's peak and valley are tight turns
//     whose INSIDE point is filled with a small concave arc (innerFillets), so the
//     outer edge stays the logo's while nothing inside is sharp
//   - the front N's foot turns on a true arc wider than half the stroke and curls
//     back inwards (the logo's fold), so the white sliver inside it ends in a curve
//   - the arrowhead is the logo's isosceles triangle, centred on the shaft's axis,
//     drawn as an inset copy stroked round so its points are soft; the two square
//     corners where the shaft meets it are filled too (joinFillets)

export type Pt = readonly [number, number]

const K = Math.sqrt(3) // tan 60
const STROKE = 36
const FRONT_APEX: Pt = [342, 327]
const BACK_APEX: Pt = [FRONT_APEX[0], 183]
const BACK_RADIUS = 49
/** Centre of the arrowhead's base, from the logo. */
const ARROW_BASE: Pt = [573.4, 264]
const HEAD_LENGTH = 99.7 // 2.8 strokes
const HEAD_HALF_WIDTH = 61 // 3.4 strokes across
const HEAD_ROUND = 7
const SHAFT_INTO_HEAD = 14
const INNER_RADIUS = 18
const JOIN_RADIUS = 9
const FOOT_RADIUS = 24
const FOOT_TURN_DEG = 165
const CURL_END: Pt = [329, 476]
const CURL_HANDLE = 55
const FOOT_HANDLE = 70

/** Up the shaft, and its normal. */
const AXIS: Pt = [0.5, -K / 2]
const NORMAL: Pt = [K / 2, 0.5]

const add = (p: Pt, v: Pt, s = 1): Pt => [p[0] + v[0] * s, p[1] + v[1] * s]
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const len = (v: Pt): number => Math.hypot(v[0], v[1])
const unit = (v: Pt): Pt => [v[0] / len(v), v[1] / len(v)]
/** On the 60-degree line through v, down-left (side -1) or down-right (side 1), at height y. */
const onLeg = (v: Pt, y: number, side: 1 | -1): Pt => [v[0] + (side * (y - v[1])) / K, y]

const round1 = (n: number): number => Math.round(n * 10) / 10
/** How a point is written into the SVG paths. */
export function pointString(p: Pt): string {
  return `${round1(p[0])} ${round1(p[1])}`
}

// ---- The skeleton ----------------------------------------------------------

// The valley is where the 60-degree shaft through ARROW_BASE meets the front N's right leg.
const valleyY = (K * (ARROW_BASE[0] - FRONT_APEX[0]) + ARROW_BASE[1] + FRONT_APEX[1]) / 2
const VALLEY: Pt = onLeg(FRONT_APEX, valleyY, 1)
const BACK_LEFT_END = onLeg(BACK_APEX, 424, -1)
const BACK_RIGHT_END = onLeg(BACK_APEX, 363, 1)
const LEG_FOOT = onLeg(FRONT_APEX, 536, -1)

const ARROW_TIP = add(ARROW_BASE, AXIS, HEAD_LENGTH)
const ARROW_CORNERS: readonly [Pt, Pt] = [add(ARROW_BASE, NORMAL, HEAD_HALF_WIDTH), add(ARROW_BASE, NORMAL, -HEAD_HALF_WIDTH)]
const SHAFT_END = add(ARROW_BASE, AXIS, SHAFT_INTO_HEAD)

// ---- Corners ---------------------------------------------------------------

/** Tangent points of a circular fillet of radius r on the centreline corner at p. */
function fillet(a: Pt, p: Pt, b: Pt, r: number): readonly [Pt, Pt] {
  const ua = unit(sub(a, p))
  const ub = unit(sub(b, p))
  const t = r / Math.tan(Math.acos(ua[0] * ub[0] + ua[1] * ub[1]) / 2)
  return [add(p, ua, t), add(p, ub, t)]
}

export interface InnerFillet {
  readonly vertex: Pt
  readonly centre: Pt
  readonly radius: number
  readonly t1: Pt
  readonly t2: Pt
  readonly path: string
}

/** Fill the sharp inside point of the stroke's turn at v with a concave arc. */
function innerFillet(v: Pt, a: Pt, b: Pt, r: number): InnerFillet {
  const ua = unit(sub(a, v))
  const ub = unit(sub(b, v))
  const bisector = unit([ua[0] + ub[0], ua[1] + ub[1]])
  const half = Math.acos(ua[0] * ub[0] + ua[1] * ub[1]) / 2
  const innerCorner = add(v, bisector, STROKE / 2 / Math.sin(half))
  const t = r / Math.tan(half)
  const t1 = add(innerCorner, ua, t)
  const t2 = add(innerCorner, ub, t)
  const centre = add(innerCorner, bisector, r / Math.sin(half))
  const cross = (t1[0] - centre[0]) * (t2[1] - centre[1]) - (t1[1] - centre[1]) * (t2[0] - centre[0])
  // Anchored on the centreline vertex, so no edge of the patch lies on the stroke's edge (no seam).
  const path = `M${pointString(v)} L${pointString(t1)} A${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${pointString(t2)} Z`
  return { vertex: v, centre, radius: r, t1, t2, path }
}

export interface JoinFillet {
  readonly corner: Pt
  readonly centre: Pt
  readonly radius: number
  readonly path: string
}

/** The square inside corner where one edge of the shaft meets the arrowhead's base. */
function joinFillet(side: 1 | -1): JoinFillet {
  const r = JOIN_RADIUS
  const corner = add(ARROW_BASE, NORMAL, (side * STROKE) / 2)
  const t1 = add(corner, NORMAL, side * r)
  const t2 = add(corner, AXIS, -r)
  const inside = add(add(corner, AXIS, 6), NORMAL, -side * 6)
  const centre = add(t1, AXIS, -r)
  const path = `M${pointString(inside)} L${pointString(t1)} A${r} ${r} 0 0 ${side > 0 ? 0 : 1} ${pointString(t2)} Z`
  return { corner, centre, radius: r, path }
}

/** The arrowhead shrunk toward its incentre by HEAD_ROUND; stroked 2 x HEAD_ROUND it is the same triangle, soft-cornered. */
function insetTriangle(t: readonly [Pt, Pt, Pt], by: number): readonly [Pt, Pt, Pt] {
  const [a, b, c] = t
  const la = len(sub(b, c))
  const lb = len(sub(a, c))
  const lc = len(sub(a, b))
  const per = la + lb + lc
  const incentre: Pt = [(la * a[0] + lb * b[0] + lc * c[0]) / per, (la * a[1] + lb * b[1] + lc * c[1]) / per]
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  const rIn = (2 * area) / per
  const k = (rIn - by) / rIn
  const shrink = (p: Pt): Pt => add(incentre, sub(p, incentre), k)
  return [shrink(a), shrink(b), shrink(c)]
}

// ---- Paths -----------------------------------------------------------------

const backArc = fillet(BACK_LEFT_END, BACK_APEX, BACK_RIGHT_END, BACK_RADIUS)
const PATH_BACK =
  `M${pointString(BACK_LEFT_END)} L${pointString(backArc[0])} ` +
  `A${BACK_RADIUS} ${BACK_RADIUS} 0 0 1 ${pointString(backArc[1])} L${pointString(BACK_RIGHT_END)}`

// The fold, drawn from the curl's end: down the curl, round the foot's arc, up the leg.
const FOOT_CENTRE = add(LEG_FOOT, NORMAL, FOOT_RADIUS)
const phiEnd = Math.atan2(LEG_FOOT[1] - FOOT_CENTRE[1], LEG_FOOT[0] - FOOT_CENTRE[0])
const phiStart = phiEnd - (FOOT_TURN_DEG * Math.PI) / 180
const FOOT_START: Pt = [FOOT_CENTRE[0] + FOOT_RADIUS * Math.cos(phiStart), FOOT_CENTRE[1] + FOOT_RADIUS * Math.sin(phiStart)]
const footHeading: Pt = [-Math.sin(phiStart), Math.cos(phiStart)]
const curlHandle = add(CURL_END, [-0.25, 0.97], CURL_HANDLE)
const footHandle = add(FOOT_START, footHeading, -FOOT_HANDLE)
const PATH_FRONT =
  `M${pointString(CURL_END)} C${pointString(curlHandle)} ${pointString(footHandle)} ${pointString(FOOT_START)} ` +
  `A${FOOT_RADIUS} ${FOOT_RADIUS} 0 0 1 ${pointString(LEG_FOOT)} ` +
  `L${pointString(FRONT_APEX)} L${pointString(VALLEY)} L${pointString(SHAFT_END)}`

const INNER_FILLETS: readonly InnerFillet[] = [
  innerFillet(FRONT_APEX, LEG_FOOT, VALLEY, INNER_RADIUS),
  innerFillet(VALLEY, FRONT_APEX, ARROW_BASE, INNER_RADIUS),
]
const JOIN_FILLETS: readonly JoinFillet[] = [joinFillet(1), joinFillet(-1)]
const HEAD_DRAWN = insetTriangle([ARROW_TIP, ARROW_CORNERS[0], ARROW_CORNERS[1]], HEAD_ROUND)
const PATH_HEAD = `M${HEAD_DRAWN.map(pointString).join(' L')} Z`
const PATH_INNER = INNER_FILLETS.map((f) => f.path).join(' ')
const PATH_JOINS = JOIN_FILLETS.map((f) => f.path).join(' ')

/** The drawn extent, strokes included. */
const BOUNDS = { minX: 194, minY: 176, maxX: 628, maxY: 593 } as const

export const NEX_MARK = {
  stroke: STROKE,
  linecap: 'round',
  linejoin: 'round',
  backApex: BACK_APEX,
  backLeftEnd: BACK_LEFT_END,
  backRightEnd: BACK_RIGHT_END,
  frontApex: FRONT_APEX,
  valley: VALLEY,
  legFoot: LEG_FOOT,
  curlEnd: CURL_END,
  footRadius: FOOT_RADIUS,
  footTurnDeg: FOOT_TURN_DEG,
  arrow: { base: ARROW_BASE, tip: ARROW_TIP, corners: ARROW_CORNERS, drawn: HEAD_DRAWN, round: HEAD_ROUND, axis: AXIS },
  innerFillets: INNER_FILLETS,
  joinFillets: JOIN_FILLETS,
  paths: { back: PATH_BACK, front: PATH_FRONT, inner: PATH_INNER, joins: PATH_JOINS, head: PATH_HEAD },
  bounds: BOUNDS,
  /** Optical centre: a touch below the box's, since the arrow carries the weight up top. */
  centre: [(BOUNDS.minX + BOUNDS.maxX) / 2, (BOUNDS.minY + BOUNDS.maxY) / 2 + 12] as Pt,
  /** Share of the disc's diameter the mark spans. */
  discFill: 0.62,
} as const

export const NEX_MARK_COLOURS = {
  /** The disc, bottom-left to top-right. */
  disc: ['#071f3a', '#0d3a66', '#15497f'],
  /** The mark's ink on the disc, along the arrow's direction. */
  ink: ['#4fb3f0', '#a5e8ff'],
  /** The bare mark on a light surface, and on a dark one. */
  bareLight: ['#1f6fbf', '#2b9fd8'],
  bareDark: ['#4fb3f0', '#a5e8ff'],
  glint: '#f4fdff',
  glow: 'rgba(56, 189, 248, 0.5)',
} as const

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
