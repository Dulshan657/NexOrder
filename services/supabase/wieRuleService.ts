import { supabase } from '@/lib/supabase'
import { toWieRule, toCategoryCompatibility } from '@/lib/adapters'
import type { CategoryCompatibility, CompatibilityLevel, WieRule, WieRuleDefinition, WieRuleType, WieEnforcement } from '@/types'

export async function getWieRules(): Promise<WieRule[]> {
  const { data, error } = await supabase
    .from('wie_rules')
    .select('*')
    .order('priority', { ascending: false })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toWieRule)
}

export interface UpsertRuleInput {
  id?: number
  name: string
  warehouse_id?: number | null
  rule_type: WieRuleType
  enforcement: WieEnforcement
  priority?: number
  definition: WieRuleDefinition
  is_active?: boolean
}

export async function upsertWieRule(input: UpsertRuleInput): Promise<WieRule> {
  const { id, ...data } = input
  const { data: res, error } = await supabase.functions.invoke<{ ok: true; rule: unknown }>('mutate-wie-rule', {
    body: { action: 'upsert_rule', id, data },
  })
  if (error) throw error
  return toWieRule((res as any).rule)
}

export async function deleteWieRule(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-wie-rule', { body: { action: 'delete_rule', id } })
  if (error) throw error
}

export async function getCompatibility(): Promise<CategoryCompatibility[]> {
  const { data, error } = await supabase.from('category_compatibility').select('*')
  if (error) throw error
  return (data ?? []).map(toCategoryCompatibility)
}

export async function setCompatibility(
  categoryA: string,
  categoryB: string,
  level: CompatibilityLevel,
  note?: string,
): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-wie-rule', {
    body: { action: 'set_compatibility', data: { category_a: categoryA, category_b: categoryB, level, note } },
  })
  if (error) throw error
}

export async function deleteCompatibility(categoryA: string, categoryB: string): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-wie-rule', {
    body: { action: 'delete_compatibility', category_a: categoryA, category_b: categoryB },
  })
  if (error) throw error
}
