import React, { useCallback, useMemo, useState } from 'react'
import ShortStockConfirm from '@/components/qr/ShortStockConfirm'
import { mayBeShort, toShortLines, type MayBeShortProduct } from '@/lib/qr/mayBeShort'
import type { OrderItem } from '@/types'

// The soft "this may be short" check in front of a kitchen's submit.
//
//   const { guard, dialog } = useShortStockGuard({ enabled: isQrStaff, products })
//   <button onClick={() => guard(items, submit)} />   // instead of submit()
//   {dialog}                                          // once, anywhere in the tree
//
// `guard` runs `proceed` at once unless the order may be short, in which case it
// holds `proceed` behind a ConfirmDialog: "Send anyway" runs it (once), anything
// else drops it. Never blocking -- `available` is a cache and the approver has the
// last word -- and never numeric: see `lib/qr/mayBeShort.ts`.
//
// It lives beside the submit button rather than inside `OrderContext` because
// the question belongs to the screen asking it: the cart and the Kitchen's "Order
// same again" both ask, they confirm in different places, and the context has no
// UI. `enabled` is false for every role but QR Staff, so Customer, rep and admin
// submits pass straight through, untouched.

export interface UseShortStockGuardArgs {
  /** True only for a kitchen (QR Staff) login. Otherwise `guard` just calls `proceed`. */
  enabled: boolean
  /** The catalogue, with `available` and `uoms`. */
  products: readonly MayBeShortProduct[]
}

export interface ShortStockGuard {
  guard: (items: readonly OrderItem[], proceed: () => void) => void
  /** The warning, or null when none is showing. Render it once. */
  dialog: React.ReactNode
}

interface Pending {
  names: readonly string[]
  proceed: () => void
}

export function useShortStockGuard({ enabled, products }: UseShortStockGuardArgs): ShortStockGuard {
  const [pending, setPending] = useState<Pending | null>(null)

  const guard = useCallback(
    (items: readonly OrderItem[], proceed: () => void) => {
      const names = enabled ? mayBeShort(toShortLines(items), products) : []
      if (names.length === 0) {
        proceed()
        return
      }
      setPending({ names, proceed })
    },
    [enabled, products],
  )

  const dialog = useMemo(() => {
    if (!pending) return null
    return (
      <ShortStockConfirm
        names={pending.names}
        onSendAnyway={() => {
          setPending(null)
          pending.proceed()
        }}
        onChangeOrder={() => setPending(null)}
      />
    )
  }, [pending])

  return { guard, dialog }
}
