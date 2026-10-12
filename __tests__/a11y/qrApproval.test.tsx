import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { QrAccessState, QrOrderPreview } from '@/services/supabase/qrService'
import type { QrOrderRequest } from '@/types'
import { __resetModalStack } from '@/components/ui/useModalStack'
import { __resetScrollLock } from '@/components/ui/useScrollLock'
import { __resetInertBackground } from '@/components/ui/useInertBackground'
import { expectNoA11yViolations } from '../support/axe'

// The kitchen-QR approval screens under axe: accessible names on every control
// (the quantity steppers and PIN fields are the ones that are easy to leave
// unlabelled), label association, ARIA validity. Contrast is out of reach here
// (jsdom has no layout) and is checked in a browser.

const m = vi.hoisted(() => ({
  preview: vi.fn(),
  pending: vi.fn(),
  access: vi.fn(),
}))

const idle = { mutateAsync: vi.fn(), isPending: false }

vi.mock('@/hooks/queries/useQrOrderRequests', () => ({
  useQrRequestPreview: (...a: unknown[]) => m.preview(...a),
  useApproveQrRequest: () => idle,
  useRejectQrRequest: () => idle,
  useCancelQrRequest: () => idle,
  usePendingQrRequests: (...a: unknown[]) => m.pending(...a),
}))
vi.mock('@/hooks/queries/useQrAccess', () => ({
  useQrAccess: (...a: unknown[]) => m.access(...a),
  useRegenerateQrCode: () => idle,
  useCreateQrStaff: () => idle,
  useRenameQrStaff: () => idle,
  useResetQrPin: () => idle,
  useRevokeQrStaff: () => idle,
  useUnlockQrCode: () => idle,
  useQrPoster: () => idle,
}))
vi.mock('@/hooks/queries/useHoReCas', () => ({
  useHoReCas: () => ({ data: [{ id: 7, name: 'Cafe Roma' }] }),
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))

import QrRequestReviewModal from '@/components/qr/QrRequestReviewModal'
import QrAccessPanel from '@/components/qr/QrAccessPanel'
import PendingQrRequests from '@/components/qr/PendingQrRequests'

const request: QrOrderRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  horecaId: 7,
  requestedBy: 'u1',
  qrStaffId: 's1',
  staffName: 'Sam',
  status: 'pending',
  items: [{ productId: 1, quantity: 2, packSize: null, uomId: null, productName: 'Fresh Cream 1L', productSku: 'CRM-1' }],
  notes: 'Back door',
  deliveryDate: '2026-10-14',
  deliveryTimeSlot: 'Morning (8am-12pm)',
  deliveryAddress: null,
  quotedTotal: 10,
  createdAt: new Date().toISOString(),
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  lastError: null,
  editedByApprover: false,
  approvedOrderId: null,
}

const preview: QrOrderPreview = {
  ok: false,
  problems: [{ code: 'INSUFFICIENT_STOCK', message: 'Only 1 of Fresh Cream 1L is available', productId: 1, requested: 2, available: 1 }],
  lines: [{ productId: 1, quantity: 2, packSize: null, uomId: null, productName: 'Fresh Cream 1L', productSku: 'CRM-1', unitPrice: 5, appliedPromotionId: null, lineTotal: 10, baseUnits: 2 }],
  stock: [{ productId: 1, productName: 'Fresh Cream 1L', requested: 2, available: 1, short: true }],
  subtotal: 10,
  cartDiscount: 0,
  total: 10,
  appliedPromotionIds: [],
  bogoFreeItems: [],
  creditLimit: 500,
  outstanding: 120,
  minimumOrderValue: 0,
  hoReCa: { id: 7, name: 'Cafe Roma' },
}

const access: QrAccessState = {
  horecaId: 7,
  horecaName: 'Cafe Roma',
  token: 't',
  url: 'https://app.example/?qr=t',
  staff: [{ id: 'st-1', horecaId: 7, name: 'Sam', unlockedUntil: new Date(Date.now() + 3600_000).toISOString(), lastUnlockedAt: null, createdAt: '2026-10-01T00:00:00Z', revokedAt: null }],
  locked: false,
  lockedUntil: null,
  permanent: false,
  failedAttempts: 0,
}

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
  __resetInertBackground()
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  const main = document.createElement('div')
  main.setAttribute('data-scroll-container', '')
  document.body.appendChild(main)

  m.preview.mockReturnValue({ data: { request, preview }, error: null, isLoading: false, isFetching: false, refetch: vi.fn() })
  m.pending.mockReturnValue({ data: [request] })
  m.access.mockReturnValue({ data: access, isLoading: false, isError: false, error: null, refetch: vi.fn() })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('QR approval a11y', () => {
  it('the review modal, with problems showing', async () => {
    render(<QrRequestReviewModal requestId={request.id} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Review order request' })).toBeTruthy()
    await expectNoA11yViolations(document.body)
  })

  it('the review modal, with the reject reason open', async () => {
    render(<QrRequestReviewModal requestId={request.id} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(screen.getByLabelText(/Reason/)).toBeTruthy()
    await expectNoA11yViolations(document.body)
  })

  it('the QR & PINs sheet, with a reset form open', async () => {
    render(<QrAccessPanel horecaId={7} open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN for Sam' }))
    expect(screen.getByRole('dialog', { name: 'QR & PINs' })).toBeTruthy()
    await expectNoA11yViolations(document.body)
  })

  it('the pending lists, in both modes', async () => {
    const { container } = render(
      <div>
        <PendingQrRequests mode="approver" />
        <PendingQrRequests mode="requester" horecaId={7} compact />
      </div>,
    )
    await expectNoA11yViolations(container)
  })
})
