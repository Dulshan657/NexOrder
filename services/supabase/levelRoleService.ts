import { supabase } from '@/lib/supabase'
import { toLevelRole } from '@/lib/adapters'
import type { LevelRoleRecord } from '@/lib/levelRoles'

/** Counts of everything that still references a role key — the four places a
 *  role can be used, two of which no FK can protect (an array element and a
 *  JSONB field). Returned by mutate-level-role and rendered in the admin UI. */
export interface LevelRoleUsage {
  locations: number
  skuRules: number
  formLevels: number
  homeBins: number
}

/** Every level role, active and inactive, in operator-defined order.
 *  Inactive roles are included deliberately: a level may still carry a role that
 *  has since been deactivated, and it must keep rendering with its own name and
 *  colour rather than falling back to a bare key. */
export async function getLevelRoles(): Promise<LevelRoleRecord[]> {
  const { data, error } = await supabase
    .from('level_roles')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toLevelRole)
}

export interface LevelRoleInput {
  key?: string
  displayName?: string
  description?: string | null
  colorFill?: string
  colorStroke?: string
  colorText?: string | null
  sortOrder?: number
  huTypes?: string[]
  isPickZone?: boolean
  replenSourceRank?: number | null
  isActive?: boolean
  /** Required by the server when isPickZone / replenSourceRank / huTypes change
   *  — those three silently alter order allocation and the putaway gate
   *  company-wide. A rename needs no reason. */
  reason?: string
}

function toPayload(input: LevelRoleInput): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (input.key !== undefined) data.key = input.key
  if (input.displayName !== undefined) data.display_name = input.displayName
  if (input.description !== undefined) data.description = input.description
  if (input.colorFill !== undefined) data.color_fill = input.colorFill
  if (input.colorStroke !== undefined) data.color_stroke = input.colorStroke
  if (input.colorText !== undefined) data.color_text = input.colorText
  if (input.sortOrder !== undefined) data.sort_order = input.sortOrder
  if (input.huTypes !== undefined) data.hu_types = input.huTypes
  if (input.isPickZone !== undefined) data.is_pick_zone = input.isPickZone
  if (input.replenSourceRank !== undefined) data.replen_source_rank = input.replenSourceRank
  if (input.isActive !== undefined) data.is_active = input.isActive
  return data
}

async function invoke(body: Record<string, unknown>): Promise<LevelRoleRecord> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; level_role: unknown }>(
    'mutate-level-role',
    { body },
  )
  if (error) throw error
  return toLevelRole((data as any).level_role)
}

export async function createLevelRole(input: LevelRoleInput): Promise<LevelRoleRecord> {
  return invoke({ action: 'create', data: toPayload(input), reason: input.reason })
}

export async function updateLevelRole(
  key: string,
  patch: LevelRoleInput,
): Promise<LevelRoleRecord> {
  return invoke({ action: 'update', key, data: toPayload(patch), reason: patch.reason })
}

export async function deleteLevelRole(key: string): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-level-role', {
    body: { action: 'delete', key },
  })
  if (error) throw error
}

/** What still points at this role. Used to explain a refused delete before the
 *  operator attempts one. */
export async function getLevelRoleUsage(key: string): Promise<LevelRoleUsage> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; usage: any }>(
    'mutate-level-role',
    { body: { action: 'usage', key } },
  )
  if (error) throw error
  const u = (data as any).usage ?? {}
  return {
    locations: Number(u.locations ?? 0),
    skuRules: Number(u.sku_rules ?? 0),
    formLevels: Number(u.form_levels ?? 0),
    homeBins: Number(u.home_bins ?? 0),
  }
}
