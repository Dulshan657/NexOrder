// What a pointerdown on the live map MEANS, decided from facts alone.
//
// Not a mode. mapMode.ts's header states the rule this file obeys: the differences
// between painting, selecting and panning live at the GESTURE layer — which button,
// which modifier, how many fingers, and whether there is anything under the pointer
// for a brush to bite — not at the mode layer. MapStage supplies the facts and
// performs the verdict; giving it a mode would make it know what a mode means.
//
// The headline rule this exists for is rule 7: DRAG OVER STORAGE PAINTS, DRAG OVER
// OPEN FLOOR MOVES THE MAP. Before it, every drag in sweep mode painted and Alt was
// the only way to move around a floor plan that is mostly floor.
//
// It is a table rather than a nest of conditions in a JSX handler because the order
// of the rules is the whole design, and an ordering argument you cannot read is one
// nobody can check.

export type StrokeKind = 'paint' | 'brush' | 'band'

export type GestureDecision =
  | { kind: 'pinch' }
  | { kind: 'stroke'; stroke: StrokeKind; erase: boolean }
  | { kind: 'pan' }
  /** Ours to refuse: the browser keeps whatever it would normally do. */
  | { kind: 'none' }

export interface PointerFacts {
  pointerType: string
  /** 0 left, 2 right. Always 0 for touch. */
  button: number
  altKey: boolean
  /** Pointers down on the stage INCLUDING this one. */
  downCount: number
  /** The annotate brush is armed. */
  paintArmed: boolean
  /** A code sweep is armed. */
  selectArmed: boolean
  tool: 'paint' | 'rect' | null
  /** From the NULLING cell helper: null means outside the grid. */
  cell: { x: number; y: number } | null
  /** Whether `cell` holds anything a sweep can recode. False when cell is null. */
  cellHasUnits: boolean
}

export function decidePointerDown(f: PointerFacts): GestureDecision {
  // 1. A second finger always wins, whatever was happening. First because the second
  //    finger's own coordinates are meaningless to a brush — it lands wherever the
  //    hand happens to be, which on a dense floor is usually on a bin. A mouse is one
  //    pointer forever, so a mouse mixed with a touch is not a pinch.
  if (f.downCount >= 2 && f.pointerType !== 'mouse') return { kind: 'pinch' }

  // 2. Alt is the escape hatch and it is ONLY ever pan. Above the right-button rule
  //    deliberately: Alt must never become erase, because useMapViewport pans on
  //    button 0 alone and there is no middle-drag to fall back on. Alt+right is
  //    therefore a dead gesture, which is the honest outcome — better than a
  //    modifier that means two things depending on which button is down.
  if (f.altKey) return { kind: 'pan' }

  // 3. Right-drag erases, with either tool. Nothing armed → let the browser have its
  //    context menu. On open floor with the brush it is `none`, not `pan`: a
  //    right-drag is a statement about a selection, and answering it by moving the
  //    map would be answering a different question.
  if (f.button === 2) {
    if (!f.selectArmed) return { kind: 'none' }
    if (f.tool === 'rect') return { kind: 'stroke', stroke: 'band', erase: true }
    return f.cell && f.cellHasUnits
      ? { kind: 'stroke', stroke: 'brush', erase: true }
      : { kind: 'none' }
  }

  // 4. Middle, back and forward buttons are not ours.
  if (f.pointerType === 'mouse' && f.button !== 0) return { kind: 'none' }

  // 5. Annotate paint, with NO hit test. An area is painted ON open floor — that is
  //    what an area IS — so "open floor pans" would make the tool impossible. This
  //    asymmetry with rule 7 is deliberate, and it is also why annotate has no
  //    honest one-finger form and stays desktop-only.
  if (f.paintArmed) return { kind: 'stroke', stroke: 'paint', erase: false }

  // 6. The Box always draws a band, wherever it starts. You normally lasso a block
  //    from just outside it, so a hit test here would break the common case. Alt
  //    (rule 2) is its escape hatch.
  if (f.selectArmed && f.tool === 'rect') return { kind: 'stroke', stroke: 'band', erase: false }

  // 7. THE HEADLINE RULE. Storage under the brush → paint. Open floor, a walkway, a
  //    wall, or past the edge of the grid → move the map. Out-of-bounds arrives here
  //    as a null cell and falls out as a pan, which is better than the silent no-op
  //    it used to be.
  if (f.selectArmed && f.tool === 'paint') {
    return f.cell && f.cellHasUnits
      ? { kind: 'stroke', stroke: 'brush', erase: false }
      : { kind: 'pan' }
  }

  return { kind: 'pan' }
}
