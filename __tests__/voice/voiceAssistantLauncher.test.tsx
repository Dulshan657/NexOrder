// The launcher: the floating button, the sheet it opens, and the tool context it
// hands the session. useVoiceSession is mocked (its own tests cover it); what is
// asserted here is the wiring: the tap starts the session in the same handler
// that opens the sheet (iOS only lets audio play from inside a user gesture), the
// button gets out of the way, the cap warning becomes a toast, and every tool call
// sees the app's data, the user, the enabled modules and a fresh clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { useVoiceSession, runVoiceTool, addToast, reportError } = vi.hoisted(() => ({
  useVoiceSession: vi.fn(),
  runVoiceTool: vi.fn(),
  addToast: vi.fn(),
  reportError: vi.fn(),
}))
vi.mock('@/hooks/useVoiceSession', () => ({ useVoiceSession }))
vi.mock('@/lib/voice/runVoiceTool', () => ({ runVoiceTool }))
vi.mock('@/hooks/useToasts', () => ({ useToastActions: () => ({ addToast, removeToast: vi.fn() }) }))
vi.mock('@/lib/errorReporter', () => ({ reportError, installGlobalErrorHandlers: vi.fn() }))

import VoiceAssistantLauncher from '@/components/voice/VoiceAssistantLauncher'
import { enabledModules } from '@/components/voice/enabledModules'
import type { VoiceSessionApi } from '@/hooks/useVoiceSession'
import type { VoiceToolContext } from '@/lib/voice/context'
import { CAP_WARNING } from '@/lib/voice/voiceSession'
import { UserRole } from '@/types'
import type { AppSettings } from '@/types'
import { __resetModalStack } from '@/components/ui/useModalStack'
import { __resetScrollLock } from '@/components/ui/useScrollLock'
import { mkHoReCa, mkProduct, mkUser } from '../fixtures'

const USER = mkUser({ id: 4242, name: 'Rita Rep', role: UserRole.FIELD_REP })
const UUID = '0b6f5d1e-7a1c-4c2e-9d55-0f3c2a9e7b10'
const PRODUCTS = [mkProduct({ id: 1 })]
const HORECAS = [mkHoReCa({ id: 7 })]
const SETTINGS = { lowStockThreshold: 17 } as AppSettings

function fakeSession(overrides: Partial<VoiceSessionApi> = {}): VoiceSessionApi {
  return {
    phase: 'idle',
    live: 'listening',
    muted: false,
    textOnly: false,
    transcript: [],
    error: null,
    budget: null,
    maxSeconds: null,
    elapsedSec: 0,
    start: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    toggleMute: vi.fn(),
    sendText: vi.fn(),
    audioRef: { current: null },
    ...overrides,
  }
}

function renderLauncher() {
  return render(
    <VoiceAssistantLauncher
      currentUser={USER}
      currentUserUuid={UUID}
      allOrders={[]}
      products={PRODUCTS}
      hoReCas={HORECAS}
      salesTargets={[]}
      visits={[]}
      routes={[]}
      appSettings={SETTINGS}
    />,
  )
}

const button = () => screen.queryByRole('button', { name: 'Talk to Nex Assistant' })
const lastOptions = () => useVoiceSession.mock.calls[useVoiceSession.mock.calls.length - 1][0]

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
  useVoiceSession.mockReset()
  runVoiceTool.mockReset()
  addToast.mockReset()
  const main = document.createElement('div')
  main.setAttribute('data-scroll-container', '')
  document.body.appendChild(main)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('VoiceAssistantLauncher', () => {
  it('shows a floating mic button, absolute inside the content column', () => {
    useVoiceSession.mockReturnValue(fakeSession())
    renderLauncher()
    const b = button()!
    expect(b).toBeTruthy()
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).toContain('absolute')
    expect(b.className).not.toContain('fixed')
    expect(b.className).toContain('touch-target')
    expect(b.className).toContain('focus-visible:ring-2')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts the session synchronously in the tap that opens the sheet', () => {
    const session = fakeSession()
    useVoiceSession.mockReturnValue(session)
    renderLauncher()
    fireEvent.click(button()!)
    // fireEvent dispatches synchronously, so start() has been called before any
    // microtask: still inside the gesture.
    expect(session.start).toHaveBeenCalledTimes(1)
    expect(session.start).toHaveBeenCalledWith()
    expect(screen.getByRole('dialog', { name: 'Nex Assistant' })).toBeTruthy()
  })

  it('hides the launcher button while the sheet is open, and brings it back on close', () => {
    const session = fakeSession({ phase: 'live' })
    useVoiceSession.mockReturnValue(session)
    renderLauncher()
    fireEvent.click(button()!)
    expect(button()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(session.end).toHaveBeenCalledWith('user')
    expect(button()).toBeTruthy()
  })

  it('raises the cap warning as a toast', () => {
    useVoiceSession.mockReturnValue(fakeSession())
    renderLauncher()
    lastOptions().onWarning(CAP_WARNING)
    expect(addToast).toHaveBeenCalledWith(CAP_WARNING, 'info')
  })

  it('runs each tool against the app data with a fresh clock per call', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T04:00:00.000Z'))
    useVoiceSession.mockReturnValue(fakeSession())
    runVoiceTool.mockReturnValue({ ok: true, basis: 'b', asOf: 'x', data: {} })
    renderLauncher()

    const result = lastOptions().runTool('get_sales_summary', { period: 'this_week' })
    expect(result).toEqual({ ok: true, basis: 'b', asOf: 'x', data: {} })
    vi.setSystemTime(new Date('2026-10-20T04:05:00.000Z'))
    lastOptions().runTool('get_stock_status', {})

    const [name, args, first] = runVoiceTool.mock.calls[0] as [string, unknown, VoiceToolContext]
    const second = runVoiceTool.mock.calls[1][2] as VoiceToolContext
    expect(name).toBe('get_sales_summary')
    expect(args).toEqual({ period: 'this_week' })
    expect(first.now.toISOString()).toBe('2026-10-20T04:00:00.000Z')
    expect(second.now.toISOString()).toBe('2026-10-20T04:05:00.000Z')
    expect(first.user).toEqual({ numericId: 4242, uuid: UUID, role: UserRole.FIELD_REP, name: 'Rita Rep' })
    expect(first.products).toBe(PRODUCTS)
    expect(first.hoReCas).toBe(HORECAS)
    expect(first.settings).toEqual({ lowStockThreshold: 17 })
    expect(first.modules).toEqual(enabledModules())
    // The stable parts are the same objects call to call: only `now` is new.
    expect(second.user).toBe(first.user)
    expect(second.modules).toBe(first.modules)
  })

  it('reports a tool that crashed', () => {
    useVoiceSession.mockReturnValue(fakeSession())
    renderLauncher()
    lastOptions().runTool('get_sales_summary', {})
    const options = runVoiceTool.mock.calls[0][3] as { onError: (name: string, error: unknown) => void }
    options.onError('get_sales_summary', new Error('boom'))
    expect(reportError).toHaveBeenCalledTimes(1)
  })
})

describe('enabledModules', () => {
  it('lists every module slug whose folded constant is on (all of them under test)', () => {
    expect([...enabledModules()].sort()).toEqual(
      ['field_ops', 'inventory_dispatch', 'invoicing', 'po_inbox', 'promotions', 'sales_orders', 'shop', 'voice_assistant'].sort(),
    )
  })
})
