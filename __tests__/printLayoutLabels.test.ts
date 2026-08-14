// A layout label job is three sequential Edge Function calls. What matters here
// is that one failing group does not discard the sheets that already rendered:
// those PDFs are in the bucket and logged against the job, so throwing them away
// would make the operator re-render a thousand QR codes to recover finished work.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}))

const { printLayoutLabels } = await import('@/services/supabase/labelService')

/** One target row per group, so a job plans all three sheets. */
const TARGETS = [
  { location_id: 1, code: 'CHILL', kind: 'ZONE', name: 'Chilled', label_printed: false },
  { location_id: 2, code: 'A3-04-1', kind: 'BIN', name: 'Bay 4', label_printed: false },
  { location_id: 3, code: 'DOCK-1', kind: 'STAGING', name: 'Dock 1', label_printed: false },
]

function okSheet(group: string) {
  return {
    data: {
      ok: true,
      storagePath: `location/layout-7-${group}-123.pdf`,
      signedUrl: `https://signed/${group}`,
      labelCount: 1,
      preset: group === 'wayfinding' ? 'a4-8' : 'a4-14',
      sheetGroup: group,
    },
    error: null,
  }
}

/** The group each invoke call was for, in call order. */
function invokedGroups(): string[] {
  return invoke.mock.calls.map((call) => (call[1] as { body: { sheetGroup: string } }).body.sheetGroup)
}

beforeEach(() => {
  invoke.mockReset()
  rpc.mockReset()
  rpc.mockResolvedValue({ data: TARGETS, error: null })
})

describe('printLayoutLabels', () => {
  it('renders one sheet per group, all under one job id', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { sheetGroup: string } }) =>
      okSheet(opts.body.sheetGroup),
    )

    const job = await printLayoutLabels({ layoutId: 7 })

    expect(job.sheets.map((s) => s.group)).toEqual(['wayfinding', 'slots', 'staging'])
    expect(job.failures).toEqual([])
    const jobIds = invoke.mock.calls.map((c) => (c[1] as { body: { jobId: string } }).body.jobId)
    expect(new Set(jobIds)).toEqual(new Set([job.jobId]))
  })

  it('keeps the sheets that rendered when one group fails', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { sheetGroup: string } }) =>
      opts.body.sheetGroup === 'slots'
        ? { data: null, error: new Error('Too many labels for one sheet') }
        : okSheet(opts.body.sheetGroup),
    )

    const job = await printLayoutLabels({ layoutId: 7 })

    // The failure must not stop the run: staging is attempted after slots.
    expect(invokedGroups()).toEqual(['wayfinding', 'slots', 'staging'])
    expect(job.sheets.map((s) => s.group)).toEqual(['wayfinding', 'staging'])
    expect(job.failures).toEqual([
      { group: 'slots', message: 'Too many labels for one sheet' },
    ])
  })

  it('gives the part-used stock offset to the first sheet that actually renders', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { sheetGroup: string } }) =>
      opts.body.sheetGroup === 'wayfinding'
        ? { data: null, error: new Error('nope') }
        : okSheet(opts.body.sheetGroup),
    )

    await printLayoutLabels({ layoutId: 7, startOffset: 5 })

    const offsets = invoke.mock.calls.map(
      (c) => (c[1] as { body: { startOffset: number } }).body.startOffset,
    )
    // wayfinding asked for 5 and failed, so slots — the first sheet to reach
    // the printer — inherits it, and staging prints on fresh stock.
    expect(offsets).toEqual([5, 5, 0])
  })

  it('throws only when nothing rendered at all', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('service unavailable') })
    await expect(printLayoutLabels({ layoutId: 7 })).rejects.toThrow('service unavailable')
  })

  it('refuses a run with nothing outstanding before calling the function', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await expect(printLayoutLabels({ layoutId: 7 })).rejects.toThrow('Nothing to print')
    expect(invoke).not.toHaveBeenCalled()
  })
})
