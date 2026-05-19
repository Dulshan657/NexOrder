// Frontend client for the per-HoReCa shipping-address book.
//
// All mutations route through the mutate-horeca-address Edge Function
// (RLS revokes direct INSERT/UPDATE/DELETE for the authenticated role).
// SELECT is allowed for staff via the table's RLS policies.

import { supabase } from '@/lib/supabase'

export interface HorecaAddressRow {
  id: string
  horeca_id: number
  label: string | null
  street: string
  city: string | null
  postcode: string | null
  country: string | null
  recipient_name: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface HorecaAddressInput {
  label?: string | null
  street: string
  city?: string | null
  postcode?: string | null
  country?: string | null
  recipient_name?: string | null
}

interface ListResponse {
  ok: true
  addresses: HorecaAddressRow[]
}

interface MutationResponse {
  ok: true
  address?: HorecaAddressRow
}

function throwIfError(data: unknown, label: string): void {
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const err = (data as { error: { code?: string; message?: string } }).error
    throw new Error(`${label}: ${err.message ?? err.code ?? 'unknown error'}`)
  }
}

export async function listHorecaAddresses(horecaId: number): Promise<HorecaAddressRow[]> {
  const { data, error } = await supabase.functions.invoke('mutate-horeca-address', {
    body: { action: 'list', horeca_id: horecaId },
  })
  if (error) throw new Error(`listHorecaAddresses: ${error.message}`)
  throwIfError(data, 'mutate-horeca-address[list]')
  return (data as ListResponse).addresses
}

export async function createHorecaAddress(
  horecaId: number,
  input: HorecaAddressInput,
  options: { isDefault?: boolean } = {},
): Promise<HorecaAddressRow> {
  const { data, error } = await supabase.functions.invoke('mutate-horeca-address', {
    body: {
      action: 'create',
      horeca_id: horecaId,
      data: input,
      is_default: options.isDefault === true,
    },
  })
  if (error) throw new Error(`createHorecaAddress: ${error.message}`)
  throwIfError(data, 'mutate-horeca-address[create]')
  return (data as MutationResponse).address!
}

export async function updateHorecaAddress(
  addressId: string,
  patch: Partial<HorecaAddressInput>,
): Promise<HorecaAddressRow> {
  const { data, error } = await supabase.functions.invoke('mutate-horeca-address', {
    body: { action: 'update', id: addressId, data: patch },
  })
  if (error) throw new Error(`updateHorecaAddress: ${error.message}`)
  throwIfError(data, 'mutate-horeca-address[update]')
  return (data as MutationResponse).address!
}

export async function deleteHorecaAddress(addressId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('mutate-horeca-address', {
    body: { action: 'delete', id: addressId },
  })
  if (error) throw new Error(`deleteHorecaAddress: ${error.message}`)
  throwIfError(data, 'mutate-horeca-address[delete]')
}

export async function setDefaultHorecaAddress(addressId: string): Promise<HorecaAddressRow> {
  const { data, error } = await supabase.functions.invoke('mutate-horeca-address', {
    body: { action: 'set_default', id: addressId },
  })
  if (error) throw new Error(`setDefaultHorecaAddress: ${error.message}`)
  throwIfError(data, 'mutate-horeca-address[set_default]')
  return (data as MutationResponse).address!
}
