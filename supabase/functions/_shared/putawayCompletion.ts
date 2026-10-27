// Completion rules for single-stage putaway (NX-0006).
//
// Until NX-0006 a task had to be ASSIGNED at a desk before anyone could carry
// it to a bin. Now the product's home bin is the suggestion, so the operator
// completes a SUGGESTED task directly: scan the item, scan the bin, confirm the
// quantity. The rules that come with that live here, in one place:
//
//   * a SUGGESTED task scanned into a different bin needs a reason, picked from
//     a short fixed list. An ASSIGNED task does not: that is the pre-NX-0006
//     walk, which never sent one, and it must keep working for rows already in
//     flight and for a tab that has not reloaded;
//   * a short count may be FLAGGED, and then the remainder becomes a 'short'
//     task at the dock for a manager, instead of an open task for the floor;
//   * "make this the home bin" only fills a gap. The floor cannot move an
//     existing home; Admin/Manager do that in the home-bin editor, where min/max
//     is visible;
//   * several loose tasks of one product complete together, oldest first. Tasks
//     carry no batch (inv_transfer_stock draws loose dock stock earliest-expiry
//     first), so loose tasks of one product are interchangeable. A plated task
//     is a specific pallet and is never pooled.
//
// Pure: no Deno, no IO. Imported by complete-putaway and decide-putaway, and
// by the browser to explain a refusal before it is sent.

import type { UserRole } from './auth.ts'

export const OVERRIDE_REASONS = ['blocked', 'damaged', 'full', 'closer', 'other'] as const
export type OverrideReason = typeof OVERRIDE_REASONS[number]

export type RefusalCode = 'CONFLICT' | 'INVALID_INPUT' | 'FORBIDDEN'
export interface Refusal { ok: false; code: RefusalCode; message: string }

const DESK_ROLES: ReadonlyArray<UserRole> = ['Admin', 'Manager']
const EPS = 1e-9

const refuse = (code: RefusalCode, message: string): Refusal => ({ ok: false, code, message })

export function isOverrideReason(v: unknown): v is OverrideReason {
  return typeof v === 'string' && (OVERRIDE_REASONS as readonly string[]).includes(v)
}

export interface CompletionTask {
  status: string
  quantity: number
  /** recommended_location_id — the engine's (or the desk's redirected) bin. */
  suggestedLocationId: number | null
  /** assigned_location_id — set only on the pre-NX-0006 two-stage path. */
  assignedLocationId: number | null
}

export interface CompletionInput {
  task: CompletionTask
  /** The bin the operator scanned — authoritative. */
  actualLocationId: number
  /** Omitted = the whole task. */
  quantity?: number
  short?: boolean
  overrideReason?: string | null
  makeHome?: boolean
  /** The product's current home bin in this warehouse, if any. */
  existingHomeLocationId: number | null
  role: UserRole
}

export interface CompletionDecision {
  ok: true
  status: 'accepted' | 'overridden'
  placedQty: number
  remainderQty: number
  /** What the remainder becomes: still on the floor's list, or a manager's shortage. */
  remainderStatus: 'open' | 'short' | null
  overrideReason: OverrideReason | null
  setHome: boolean
}

export function decidePutawayCompletion(input: CompletionInput): CompletionDecision | Refusal {
  const { task, actualLocationId, role } = input

  if (task.status !== 'suggested' && task.status !== 'assigned') {
    return refuse('CONFLICT', `this putaway is already ${task.status}`)
  }

  const placedQty = input.quantity ?? task.quantity
  if (!(placedQty > 0)) return refuse('INVALID_INPUT', 'the quantity put away must be more than 0')
  if (placedQty > task.quantity + EPS) {
    return refuse('INVALID_INPUT', `${placedQty} is more than the ${task.quantity} on this task`)
  }

  const target = task.status === 'assigned' ? task.assignedLocationId : task.suggestedLocationId
  const elsewhere = target === null || actualLocationId !== target
  let overrideReason: OverrideReason | null = null
  if (elsewhere && task.status === 'suggested') {
    if (!isOverrideReason(input.overrideReason)) {
      return refuse('INVALID_INPUT', 'say why it went to a different bin: blocked, damaged, full, closer or other')
    }
    overrideReason = input.overrideReason
  } else if (elsewhere && isOverrideReason(input.overrideReason)) {
    overrideReason = input.overrideReason
  }

  let setHome = false
  if (input.makeHome) {
    if (input.existingHomeLocationId !== null) {
      return DESK_ROLES.includes(role)
        ? refuse('INVALID_INPUT', 'this product already has a home bin; change it in the home bin editor')
        : refuse('FORBIDDEN', 'this product already has a home bin; ask a manager to change it')
    }
    setHome = true
  }

  const remainderQty = Math.max(0, task.quantity - placedQty)
  return {
    ok: true,
    status: elsewhere ? 'overridden' : 'accepted',
    placedQty,
    remainderQty,
    remainderStatus: remainderQty <= EPS ? null : input.short ? 'short' : 'open',
    overrideReason,
    setHome,
  }
}

export interface PoolableTask {
  id: number
  productId: number
  huId: number | null
  quantity: number
  createdAt: string
}

export interface TaskAllocation { id: number; quantity: number }

/** Spread one counted quantity over several loose tasks of one product, oldest first. */
export function allocateAcrossTasks(
  tasks: ReadonlyArray<PoolableTask>,
  quantity: number,
): { ok: true; allocations: TaskAllocation[] } | Refusal {
  if (tasks.length === 0) return refuse('INVALID_INPUT', 'no tasks to complete')
  if (!(quantity > 0)) return refuse('INVALID_INPUT', 'the quantity put away must be more than 0')
  if (tasks.length > 1) {
    if (new Set(tasks.map((t) => t.productId)).size > 1) {
      return refuse('INVALID_INPUT', 'tasks for different products cannot be completed together')
    }
    if (tasks.some((t) => t.huId !== null)) {
      return refuse('INVALID_INPUT', 'a pallet is put away on its own, not pooled with other tasks')
    }
  }
  const total = tasks.reduce((sum, t) => sum + t.quantity, 0)
  if (quantity > total + EPS) {
    return refuse('INVALID_INPUT', `${quantity} is more than the ${total} on these tasks`)
  }

  const oldestFirst = [...tasks].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id)
  const allocations: TaskAllocation[] = []
  let left = quantity
  for (const t of oldestFirst) {
    if (left <= EPS) break
    const take = Math.min(t.quantity, left)
    allocations.push({ id: t.id, quantity: take })
    left -= take
  }
  return { ok: true, allocations }
}

export type DeskActionInput =
  | { action: 'redirect'; role: UserRole; taskStatus: string }
  | { action: 'resolve_short'; role: UserRole; taskStatus: string; resolution: 'found' | 'write_off'; reason?: string | null }

/** Desk-side changes to a task before or after the floor touches it. */
export function decideDeskAction(input: DeskActionInput): { ok: true } | Refusal {
  if (!DESK_ROLES.includes(input.role)) {
    return refuse('FORBIDDEN', 'only an Admin or Manager can do this')
  }
  if (input.action === 'redirect') {
    return input.taskStatus === 'suggested'
      ? { ok: true }
      : refuse('CONFLICT', `only a putaway nobody has started can be sent to another bin (this one is ${input.taskStatus})`)
  }
  if (input.taskStatus !== 'short') {
    return refuse('CONFLICT', `this putaway is ${input.taskStatus}, not short`)
  }
  if (input.resolution === 'write_off' && !(input.reason ?? '').trim()) {
    return refuse('INVALID_INPUT', 'a write-off needs a reason')
  }
  return { ok: true }
}
