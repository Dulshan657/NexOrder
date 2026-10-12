import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { Database } from '@/lib/database.types'

type HoReCaRow = Database['public']['Tables']['horecas']['Row']
type HoReCaInsert = Database['public']['Tables']['horecas']['Insert']
type HoReCaUpdate = Database['public']['Tables']['horecas']['Update']
type HoReCaPricingRow = Database['public']['Tables']['horeca_pricing']['Row']
type PaymentMethodRow = Database['public']['Tables']['horeca_payment_methods']['Row']

// Embedded child rows can't be inferred from the generated types (empty
// Relationships[]) so PostgREST types them as SelectQueryError. Re-assert the
// real runtime shape that the `toHoReCa` adapter expects.
type HoReCaRowWithJoins = HoReCaRow & {
  horeca_pricing: HoReCaPricingRow[] | null
  horeca_payment_methods: PaymentMethodRow[] | null
}

export async function getHoReCas() {
  // Paged past the API row cap (lib/fetchAllRows); `id` makes the order unique.
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from('horecas')
      .select('*, horeca_pricing(*), horeca_payment_methods(*)')
      .order('name')
      .order('id')
      .range(from, to),
  )
  return rows as unknown as HoReCaRowWithJoins[]
}

export async function getHoReCaById(id: number) {
  const { data, error } = await supabase
    .from('horecas')
    .select('*, horeca_pricing(*), horeca_payment_methods(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as unknown as HoReCaRowWithJoins
}

export async function createHoReCa(horeca: HoReCaInsert, reason?: string): Promise<HoReCaRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; horeca: HoReCaRow }>(
    'mutate-horeca',
    { body: { action: 'create', data: horeca, reason } },
  )
  if (error) throw error
  return data!.horeca
}

export async function updateHoReCa(id: number, updates: HoReCaUpdate, reason?: string): Promise<HoReCaRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; horeca: HoReCaRow }>(
    'mutate-horeca',
    { body: { action: 'update', id, data: updates, reason } },
  )
  if (error) throw error
  return data!.horeca
}

export async function deleteHoReCa(id: number, reason?: string): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-horeca',
    { body: { action: 'delete', id, reason } },
  )
  if (error) throw error
}

// horecas is write-locked to mutate-horeca (migration 00013), so the review
// goes through it; the function stamps reviewed_by from the caller's session.
export async function markHoReCaReviewed(id: number): Promise<HoReCaRow> {
  return updateHoReCa(id, { reviewed_at: new Date().toISOString(), is_temporary: false })
}

// ── Assigned reps (mig 00129) ─────────────────────────────────────────────────
// `horeca_reps` says which Field/Office Sales Reps look after a venue. It decides
// who may approve that venue's kitchen QR orders and manage its PINs. SELECT is
// granted to staff only; writes go through mutate-horeca `set_reps` (Admin,
// Manager), which takes the COMPLETE set -- an empty array unassigns everyone.

/** The profile ids (UUIDs) of the reps assigned to a venue. */
export async function listHorecaReps(horecaId: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('horeca_reps')
    .select('rep_id')
    .eq('horeca_id', horecaId)
  if (error) throw error
  return ((data ?? []) as unknown as Array<{ rep_id: string }>).map((r) => r.rep_id)
}

/**
 * Replace the venue's assigned reps with exactly `repIds`. The server refuses any
 * id that is not a Field or Office Sales Rep rather than dropping it, so a stale
 * picker cannot half-apply. Returns the set that is now stored.
 */
export async function setHorecaReps(horecaId: number, repIds: string[], reason?: string): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; horecaId: number; repIds: string[] }>(
    'mutate-horeca',
    { body: { action: 'set_reps', horecaId, repIds, reason } },
  )
  // The generic "non-2xx status code" hides the one thing the person needs ("only
  // Field and Office Sales Reps can be assigned"); the envelope in the body has it.
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'Please try again.'))
  return data?.repIds ?? repIds
}
