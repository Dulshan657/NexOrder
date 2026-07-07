import { supabase } from '@/lib/supabase'
import { toWieProductVelocity, toWieLocationTraffic } from '@/lib/adapters'
import type { WieProductVelocity, WieLocationTraffic } from '@/types'

// Read-only WIE analytics: per-product ABC velocity and per-node pick traffic.
// Both tables are TRUNCATE-and-rebuilt by nightly refresh RPCs (wie_refresh_velocity /
// wie_refresh_location_traffic); the viewer only ever SELECTs them (RLS allows ops).

/** ABC velocity per product for one warehouse (feeds the velocity-heat overlay). */
export async function getProductVelocity(warehouseId: number): Promise<WieProductVelocity[]> {
  const { data, error } = await supabase
    .from('wie_product_velocity')
    .select('*')
    .eq('warehouse_id', warehouseId)
  if (error) throw error
  return (data ?? []).map(toWieProductVelocity)
}

/** Per-graph-node 30-day pick visits for a layout (feeds the congestion-heat overlay). */
export async function getLocationTraffic(layoutId: number): Promise<WieLocationTraffic[]> {
  const { data, error } = await supabase
    .from('wie_location_traffic')
    .select('*')
    .eq('layout_id', layoutId)
  if (error) throw error
  return (data ?? []).map(toWieLocationTraffic)
}
