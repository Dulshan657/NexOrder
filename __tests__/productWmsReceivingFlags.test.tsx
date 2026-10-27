import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// NX-0005: Receive Stock asks for a lot code or expiry only where the product
// needs one, and this is where an admin says so.

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }))

vi.mock('@/services/supabase/wmsAttributesService', () => ({
  getWmsAttributes: vi.fn().mockResolvedValue(null),
  saveWmsAttributes: saveMock,
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))
vi.mock('@/hooks/queries/useLevelRoles', async () => {
  const { FALLBACK_LEVEL_ROLES } = await import('@/lib/levelRoles')
  return { useLevelRoles: () => ({ data: FALLBACK_LEVEL_ROLES }) }
})

import ProductWmsAttributesSection from '@/components/admin/ProductWmsAttributesSection'

afterEach(cleanup)

describe('ProductWmsAttributesSection', () => {
  it('saves the receiving requirement flags', async () => {
    saveMock.mockResolvedValue({ productId: 9, custom: {} })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ProductWmsAttributesSection productId={9} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByLabelText('Lot code required at receiving'))
    fireEvent.click(screen.getByLabelText('Expiry required at receiving'))
    fireEvent.click(screen.getByRole('button', { name: 'Save attributes' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    expect(saveMock.mock.calls[0][0]).toMatchObject({
      product_id: 9,
      requires_lot: true,
      requires_expiry: true,
    })
  })
})
