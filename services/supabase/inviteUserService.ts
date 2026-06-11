import { supabase } from '@/lib/supabase'

export type InviteRole =
  | 'Admin'
  | 'Manager'
  | 'Field Sales Rep'
  | 'Office Sales Rep'
  | 'Restaurant/Hotel Customer'
  | 'Warehouse'

export interface InviteUserInput {
  email: string
  name: string
  role: InviteRole
  hoReCaId?: number | null
  avatarUrl?: string | null
  homeWarehouseId?: number | null
}

export interface InviteUserResult {
  userId: string
  email: string
}

export interface UpdateProfileInput {
  email: string
  name?: string
  avatarUrl?: string | null
  role?: InviteRole
  hoReCaId?: number | null
  homeWarehouseId?: number | null
}

/** Admin-only update of an existing user's profile, keyed by email. */
export async function updateUserProfile(input: UpdateProfileInput): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-profile', { body: input })
  if (error) {
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    throw new Error(ctx?.error?.message ?? error.message ?? 'Update failed')
  }
}

export async function inviteUser(input: InviteUserInput): Promise<InviteUserResult> {
  const { data, error } = await supabase.functions.invoke<InviteUserResult>('invite-user', {
    body: input,
  })
  if (error) {
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    const msg = ctx?.error?.message ?? error.message ?? 'Invite failed'
    throw new Error(msg)
  }
  if (!data) throw new Error('Invite returned no data')
  return data
}
