import { supabase } from '@/lib/supabase'
import { toZoneProfile } from '@/lib/adapters'
import type { ZoneProfile, ZoneType } from '@/types'

/** The standard (and any custom) zone profiles, highest priority first. */
export async function getZoneProfiles(): Promise<ZoneProfile[]> {
  const { data, error } = await supabase
    .from('zone_profiles')
    .select('*')
    .eq('is_active', true)
    .order('priority_weight', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toZoneProfile)
}

export interface ZoneProfileInput {
  name: string
  zoneType: ZoneType
  priorityWeight: number
  allowedCategories?: string[] | null
  maxUtilizationPct?: number | null
  /** Stock here is held — not allocatable, not an ordinary putaway target
   *  (mig 00101). */
  isHold?: boolean
}

export async function createZoneProfile(input: ZoneProfileInput): Promise<ZoneProfile> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; zone_profile: unknown }>('mutate-zone-profile', {
    body: {
      action: 'create',
      data: {
        name: input.name,
        zone_type: input.zoneType,
        priority_weight: input.priorityWeight,
        allowed_categories: input.allowedCategories ?? null,
        max_utilization_pct: input.maxUtilizationPct ?? null,
        is_hold: input.isHold ?? false,
      },
    },
  })
  if (error) throw error
  return toZoneProfile((data as any).zone_profile)
}

export async function updateZoneProfile(id: number, patch: Partial<ZoneProfileInput>): Promise<ZoneProfile> {
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.zoneType !== undefined) data.zone_type = patch.zoneType
  if (patch.priorityWeight !== undefined) data.priority_weight = patch.priorityWeight
  if (patch.allowedCategories !== undefined) data.allowed_categories = patch.allowedCategories
  if (patch.maxUtilizationPct !== undefined) data.max_utilization_pct = patch.maxUtilizationPct
  if (patch.isHold !== undefined) data.is_hold = patch.isHold
  const { data: res, error } = await supabase.functions.invoke<{ ok: true; zone_profile: unknown }>('mutate-zone-profile', {
    body: { action: 'update', id, data },
  })
  if (error) throw error
  return toZoneProfile((res as any).zone_profile)
}

export async function deactivateZoneProfile(id: number): Promise<ZoneProfile> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; zone_profile: unknown }>('mutate-zone-profile', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
  return toZoneProfile((data as any).zone_profile)
}
