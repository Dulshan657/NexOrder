// Live-update bridge between Supabase postgres_changes and TanStack Query.
//
// One channel covers four tables. Every event invalidates the matching
// query key, so any view that already calls `useOrders()`, `useProducts()`,
// `useNotifications()`, etc. will automatically refetch and re-render.
//
// RLS is respected on the wire: a customer subscriber only ever sees events
// for rows their SELECT policy permits, so we don't need extra client-side
// filtering.
//
// Mounted at App.tsx once the user is authenticated. Cleans up on userId
// change or unmount.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useRealtimeSubscriptions(userId: string | null | undefined): void {
  const qc = useQueryClient()

  useEffect(() => {
    if (!userId) return

    const invalidateOrders = () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    }
    const invalidateNotifications = () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
    const invalidateProducts = () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    }

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
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, qc])
}
