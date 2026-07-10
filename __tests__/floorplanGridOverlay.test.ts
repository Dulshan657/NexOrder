import { describe, it, expect } from 'vitest'
import {
  computeGridDims,
  gridLinePositions,
  thinLinePositions,
  heavyLinePositions,
  labelPositions,
  cellToPixel,
  renderCanvasSize,
  estimateLabelExtent,
  edgeLabelAnchor,
} from '@/lib/floorplanGridOverlay'

describe('computeGridDims', () => {
  it('wide image (2:1) maximizes width to 120', () => {
    expect(computeGridDims(2000, 1000)).toEqual({ gridWidth: 120, gridHeight: 60 })
  })

  it('tall image (1:2) maximizes height to 80', () => {
    expect(computeGridDims(1000, 2000)).toEqual({ gridWidth: 40, gridHeight: 80 })
  })

  it('square image splits the difference on height (ratio < 1.5)', () => {
    expect(computeGridDims(1000, 1000)).toEqual({ gridWidth: 80, gridHeight: 80 })
  })

  it('exact 1.5 ratio (the aspect-fit threshold) hits the full 120×80 box', () => {
    expect(computeGridDims(1500, 1000)).toEqual({ gridWidth: 120, gridHeight: 80 })
  })

  it('extremely wide image clamps the short axis to the 10-cell minimum', () => {
    const { gridWidth, gridHeight } = computeGridDims(100000, 100)
    expect(gridWidth).toBe(120)
    expect(gridHeight).toBe(10)
  })

  it('extremely tall image clamps the short axis to the 10-cell minimum', () => {
    const { gridWidth, gridHeight } = computeGridDims(100, 100000)
    expect(gridWidth).toBe(10)
    expect(gridHeight).toBe(80)
  })

  it('never exceeds the 120×80 max box regardless of ratio', () => {
    for (const [w, h] of [[4000, 1], [1, 4000], [3840, 2160], [1, 1]] as const) {
      const { gridWidth, gridHeight } = computeGridDims(w, h)
      expect(gridWidth).toBeGreaterThanOrEqual(10)
      expect(gridWidth).toBeLessThanOrEqual(120)
      expect(gridHeight).toBeGreaterThanOrEqual(10)
      expect(gridHeight).toBeLessThanOrEqual(80)
    }
  })
})

describe('gridLinePositions', () => {
  it('steps from 0 to cellCount inclusive', () => {
    expect(gridLinePositions(20, 5)).toEqual([0, 5, 10, 15, 20])
  })

  it('stops short of cellCount when it does not divide evenly, without overshooting', () => {
    expect(gridLinePositions(23, 10)).toEqual([0, 10, 20])
  })

  it('degenerates to [0] for a non-positive step or cellCount', () => {
    expect(gridLinePositions(20, 0)).toEqual([0])
    expect(gridLinePositions(0, 5)).toEqual([0])
  })
})

describe('thinLinePositions / heavyLinePositions / labelPositions', () => {
  it('thin lines fall every 5 cells', () => {
    expect(thinLinePositions(60)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60])
  })

  it('heavy lines fall every 10 cells', () => {
    expect(heavyLinePositions(60)).toEqual([0, 10, 20, 30, 40, 50, 60])
  })

  it('label cadence matches the heavy-line cadence', () => {
    expect(labelPositions(60)).toEqual(heavyLinePositions(60))
  })
})

describe('cellToPixel', () => {
  it('maps a cell index proportionally onto the pixel size', () => {
    expect(cellToPixel(0, 120, 2400)).toBe(0)
    expect(cellToPixel(60, 120, 2400)).toBe(1200)
    expect(cellToPixel(120, 120, 2400)).toBe(2400)
  })
})

describe('renderCanvasSize', () => {
  it('caps the long axis at 1600px and keeps the grid aspect ratio for a wide grid', () => {
    expect(renderCanvasSize(120, 60)).toEqual({ widthPx: 1600, heightPx: 800 })
  })

  it('caps the long axis at 1600px and keeps the grid aspect ratio for a tall grid', () => {
    expect(renderCanvasSize(40, 80)).toEqual({ widthPx: 800, heightPx: 1600 })
  })

  it('a square grid renders as a square canvas', () => {
    expect(renderCanvasSize(80, 80)).toEqual({ widthPx: 1600, heightPx: 1600 })
  })
})

describe('estimateLabelExtent', () => {
  it('scales with both character count and font size', () => {
    expect(estimateLabelExtent('120', 20)).toBeCloseTo(3 * 20 * 0.6)
    expect(estimateLabelExtent('0', 20)).toBeCloseTo(1 * 20 * 0.6)
    expect(estimateLabelExtent('120', 10)).toBeCloseTo(3 * 10 * 0.6)
  })
})

describe('edgeLabelAnchor', () => {
  it('anchors near-origin positions at their normal offset with a start alignment', () => {
    expect(edgeLabelAnchor(0, 1600, 20)).toEqual({ pos: 2, align: 'start' })
    expect(edgeLabelAnchor(700, 1600, 20)).toEqual({ pos: 702, align: 'start' })
  })

  it('flips to an end alignment pinned at the far edge once the label would clip past it', () => {
    // Rightmost label (cell 120 mapped to widthPx=1600) sits exactly on the
    // edge — this is the case that used to draw off-canvas.
    expect(edgeLabelAnchor(1600, 1600, 20)).toEqual({ pos: 1598, align: 'end' })
  })

  it('the flip point is exactly where pos + extent + margin would overshoot sizePx', () => {
    // pos=1578, extent=20, margin=2 → 1578+20+2=1600, not > 1600 → still 'start'.
    expect(edgeLabelAnchor(1578, 1600, 20)).toEqual({ pos: 1580, align: 'start' })
    // pos=1579 → 1579+20+2=1601 > 1600 → flips to 'end'.
    expect(edgeLabelAnchor(1579, 1600, 20)).toEqual({ pos: 1598, align: 'end' })
  })

  it('respects a custom margin', () => {
    expect(edgeLabelAnchor(0, 1600, 20, 5)).toEqual({ pos: 5, align: 'start' })
    expect(edgeLabelAnchor(1600, 1600, 20, 5)).toEqual({ pos: 1595, align: 'end' })
  })
})
