// The glue behind every "Edit and resend" button.
//
// Maps a request's lines to the cart (lib/qr/resendItems.ts), tells the person
// what could not be carried over, and hands the rest to the shell's
// `onEditItems` -- the same call "Edit before ordering" makes, which replaces the
// cart and opens the Shop's Reorder tab with the cart over it. A resend ALSO passes
// the order's own notes and delivery choices as a second argument, so the cart takes
// those over too (and is cleared of any an abandoned cart left behind); "Edit before
// ordering" passes none and leaves them alone.
//
// While the catalogue is still loading there are no products to match, and every line
// would read as "no longer available" -- so that case says it is loading instead.
//
// Returns whether the cart was loaded. Callers use that to decide whether to put a
// card away: a resend that went nowhere must leave the reason on screen.

import { useCallback } from 'react'
import {
  qrRequestToCartDetails,
  qrRequestToCartItems,
  unavailableItemsMessage,
  type ResendContext,
} from '@/lib/qr/resendItems'
import type { ReorderDetails } from '@/context/OrderContext'
import type { OrderItem, QrOrderRequest, ToastType } from '@/types'

/** Said instead of "no longer available" while the catalogue has not loaded. */
export const CATALOGUE_LOADING_MESSAGE = 'Still loading the catalogue — try again in a moment'

export interface UseResendQrRequestArgs extends ResendContext {
  /** Load these lines (and, for a resend, the order's notes and delivery) into the cart and open it (AppShell `handleEditKitchenItems`). */
  onEditItems: (items: OrderItem[], details?: ReorderDetails) => void
  addToast: (message: string, type: ToastType) => void
}

export function useResendQrRequest({
  products,
  hoReCa,
  promotions,
  currentUser,
  cartonDiscountPercent,
  onEditItems,
  addToast,
}: UseResendQrRequestArgs): (request: QrOrderRequest) => boolean {
  return useCallback(
    (request: QrOrderRequest): boolean => {
      // Nothing to match against yet: not the same as "every product is gone".
      if (products.length === 0) {
        addToast(CATALOGUE_LOADING_MESSAGE, 'info')
        return false
      }

      const { items, skipped } = qrRequestToCartItems(request, {
        products,
        hoReCa,
        promotions,
        currentUser,
        cartonDiscountPercent,
      })

      if (items.length === 0) {
        addToast(skipped > 0 ? unavailableItemsMessage(skipped) : 'That order has no items to resend.', 'error')
        return false
      }
      if (skipped > 0) addToast(unavailableItemsMessage(skipped), 'info')

      onEditItems(items, qrRequestToCartDetails(request))
      return true
    },
    [products, hoReCa, promotions, currentUser, cartonDiscountPercent, onEditItems, addToast],
  )
}
