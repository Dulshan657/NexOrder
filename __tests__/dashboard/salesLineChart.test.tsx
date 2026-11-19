// NX-0042 A3. The trend was an SVG scaled by its viewBox: at desktop width it
// grew to ~500px tall and its 10px labels rendered around 20px.

import React from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import SalesLineChart from '@/components/charts/SalesLineChart'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

const days = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, '0')}`,
  revenue: (i % 7) * 100,
}))

describe('SalesLineChart', () => {
  it('draws at a fixed height whatever its width', () => {
    const { container } = render(React.createElement(SalesLineChart, { data: days }))
    const frame = container.querySelector('[data-chart="sales-trend"]') as HTMLElement
    expect(frame).toBeTruthy()
    expect(frame.style.height).toBe('220px')
  })
})
