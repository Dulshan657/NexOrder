// Live-update bridge between Supabase postgres_changes and TanStack Query.
//
// Two channels:
//
//   1. `app-realtime-{userId}` — tables every authenticated role
//      legitimately consumes (orders, order_items, notifications,
//      products, invoices). RLS narrows the row payload per subscriber.
//
//   2. `po-inbox-realtime-{userId}` — admin-only tables (pending_pos,
//      email_accounts). Subscribed ONLY when the user is Admin or
//      Manager. Reps and Customers never receive these events. This is
//      defense-in-depth: RLS already gates the row payload, but not
//      subscribing at all narrows the surface to roles that actually
//      have a UI consuming these tables.
//
// Mounted at App.tsx once the user is authenticated. Cleans up on
// userId/role change or unmount.
//
// Every handler goes through ONE shared batcher (lib/invalidationBatcher.ts):
// events arrive per row, so an unbatched handler refetched the full orders or
// products list once per line of every order placed by anyone.

import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { UserRole } from '@/types'
import { createInvalidationBatcher } from '@/lib/invalidationBatcher'

interface UseRealtimeSubscriptionsOptions {
  userId: string | null | undefined
  role: UserRole | null | undefined
}

export function useRealtimeSubscriptions(arg: UseRealtimeSubscriptionsOptions | string | null | undefined): void {
  const qc = useQueryClient()

  // Back-compat: prior call sites passed userId directly. New call sites
  // pass { userId, role } so we know whether to mount the admin channel.
  const userId = typeof arg === 'string' ? arg : arg?.userId ?? null
  const role = typeof arg === 'string' ? null : arg?.role ?? null
  const isPoOperator = role === UserRole.ADMIN || role === UserRole.MANAGER
  const isInventoryOps =
    role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.WAREHOUSE

  const batcher = useMemo(
    () => createInvalidationBatcher((queryKey) => { void qc.invalidateQueries({ queryKey }) }),
    [qc],
  )
  useEffect(() => () => batcher.cancel(), [batcher])

  useEffect(() => {
    if (!userId) return

    // An order status change (e.g. → processed) can add/remove it from the
    // warehouse Pick Queue — keep that list in sync across clients too.
    const invalidateOrders = () => batcher.schedule([['orders'], ['pick_queue']])
    const invalidateNotifications = () => batcher.schedule([['notifications']])
    const invalidateProducts = () => batcher.schedule([['products']])
    const invalidateInvoicesAndOrders = () => batcher.schedule([['invoices'], ['orders']])

    const channel = supabase
      .channel(`app-realtime-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        invalidateOrders,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        invalidateOrders,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        invalidateNotifications,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        invalidateProducts,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices' },
        invalidateInvoicesAndOrders,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, batcher])

  // Separate admin-only channel for PO inbox tables. Reps + Customers
  // never subscribe.
  useEffect(() => {
    if (!userId || !isPoOperator) return

    const invalidatePendingPos = () => batcher.schedule([['pending_pos']])
    const invalidateEmailAccounts = () => batcher.schedule([['email_accounts']])

    const channel = supabase
      .channel(`po-inbox-realtime-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pending_pos' },
        invalidatePendingPos,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'email_accounts' },
        invalidateEmailAccounts,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, isPoOperator, batcher])

  // Inventory & Dispatch channel — balances, pick progress, generated docs.
  // Ops roles only (Admin/Manager/Warehouse); reps/customers never subscribe.
  // A balance change also refreshes products, since products.inventory is the
  // on-hand cache the shop/stock surfaces read.
  useEffect(() => {
    if (!userId || !isInventoryOps) return

    const invalidateBalances = () => batcher.schedule([['inventory_balances'], ['products']])
    // pick_progress feeds the pick queue's picked counts; no query is keyed
    // 'pick_progress'. orders.pickedUnits rides the ['orders'] prefix.
    const invalidatePickProgress = () => batcher.schedule([['pick_queue'], ['orders']])
    const invalidateOrderDocuments = () => batcher.schedule([['order_documents']])

    const channel = supabase
      .channel(`inventory-realtime-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_balances' },
        invalidateBalances,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pick_progress' },
        invalidatePickProgress,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_documents' },
        invalidateOrderDocuments,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, isInventoryOps, batcher])
}
