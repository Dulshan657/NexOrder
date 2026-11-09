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
//     flight and for a tab that has not reloaded. Since NX-0032 the reason is
//     asked only once the home rule has passed: a bin that is not the product's
//     home while the home has room is refused first (wie_home_block, asked by
//     complete-putaway before this runs), and no reason lifts that. So the
//     reason covers only a bin the home rule allows, e.g. a home that is full;
//   * a short count may be FLAGGED, and then the remainder becomes a 'short'
//     task at the dock for a manager, instead of an open task for the floor;
//   * "make this the home bin" only fills a gap. The floor cannot move an
//     existing home; Admin/Manager do that in the home-bin editor, where min/max
//     is visible. Since NX-0033 only Admin and Manager may ask for it at all:
//     a Warehouse user is refused FORBIDDEN, whether or not the product has a
//     home, so a hand-made request cannot give a product a home from the floor;
//   * several loose tasks of one product complete together, oldest first. Tasks
//     carry no batch (inv_transfer_stock draws loose dock stock earliest-expiry
//     first), so loose tasks of one product are interchangeable. A plated task
//     is a specific pallet and is never pooled.
//
// Pure: no Deno, no IO. Imported by complete-putaway and decide-putaway, and
// by the browser to explain a refusal before it is sent.

// A plain string, not auth.ts's UserRole: this module is imported by the
// browser, and auth.ts reads Deno.env, which the frontend type-check cannot see.
export type UserRole = string

export const OVERRIDE_REASONS = ['blocked', 'damaged', 'full', 'closer', 'other'] as const
export type OverrideReason = typeof OVERRIDE_REASONS[number]

export type RefusalCode = 'CONFLICT' | 'INVALID_INPUT' | 'FORBIDDEN'
export interface Refusal { ok: false; code: RefusalCode; message: string }

const DESK_ROLES: ReadonlyArray<UserRole> = ['Admin', 'Manager']
const EPS = 1e-9

const refuse = (code: RefusalCode, message: string): Refusal => ({ ok: false, code, message })

/** NX-0033: giving a product a home from the walk is a Manager's or Admin's call. */
export const MAKE_HOME_FORBIDDEN = 'Only a Manager or Admin can give a product a home bin.'

/** NX-0033 I1: a quarantined (held) line is going to a hold bin, never a home. */
export const MAKE_HOME_HELD = "A held line can't make a home bin."

/**
 * May a home be made from these lines? Not when any of them is held: its stock
 * may only go to a hold bin, and a hold bin is never a home, so `make_home` from
 * it could only put held stock in a pick face. `anyHeld` is the caller's reading
 * of the lines' own bins (assigned, else suggested) against the hold zones.
 */
export function heldLineHomeRefusal(args: { makeHome: boolean; anyHeld: boolean }): Refusal | null {
  return args.makeHome && args.anyHeld ? refuse('CONFLICT', MAKE_HOME_HELD) : null
}

/** May this role give a product a home bin? Admin and Manager only. */
export function canSetHome(role: UserRole): boolean {
  return DESK_ROLES.includes(role)
}

/**
 * May the floor place this line now (accept or override it) without the desk
 * assigning it first? A suggested line, or one the SYSTEM assigned
 * (`assigned_by` NULL, NX-0033) and nobody has touched since. A line a person
 * assigned is that person's decision and is not re-decided here.
 */
export function canPlaceNow(task: { status: string; assignedBy: string | null }): boolean {
  return task.status === 'suggested' || (task.status === 'assigned' && task.assignedBy === null)
}

/** The decisions decide-putaway resolves on the task row itself. The two desk
 *  actions (redirect, resolve_short) are answered earlier by decideDeskAction,
 *  which has its own status rules, so they are not asked here. */
export type PutawayDecision = 'accept' | 'override' | 'unassign' | 'confirm_overflow'

/**
 * Does `decision` act on a task in this state? decide-putaway asks this before
 * it touches anything (the transactions ask again under their row lock):
 *
 *   * unassign                      an assigned task;
 *   * accept / override, one step   {@link canPlaceNow}: a suggested task, or one
 *                                   the system assigned (NX-0033), so the receive
 *                                   card and the opening-stock import can still
 *                                   place what no longer waits in the queue;
 *   * accept / override assign_only a suggested task, as a desk assign always
 *                                   was: a system-assigned line is already
 *                                   assigned, and a person's is theirs;
 *   * confirm_overflow              always yes. wie_confirm_overflow_tx owns the
 *                                   whole check under its row lock (status, still
 *                                   awaiting confirmation, which bin) and answers
 *                                   in the words the walk shows. Refusing here
 *                                   would hide those words behind a generic one.
 */
export function decisionActsOnStatus(args: {
  decision: PutawayDecision
  assignOnly?: boolean
  status: string
  assignedBy: string | null
}): boolean {
  const { decision, assignOnly, status, assignedBy } = args
  if (decision === 'confirm_overflow') return true
  if (decision === 'unassign') return status === 'assigned'
  if (!assignOnly) return canPlaceNow({ status, assignedBy })
  return status === 'suggested'
}

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
    // The role comes first (NX-0033): a Warehouse user is refused whatever the
    // product's home looks like, so the answer does not reveal whether it has one.
    if (!canSetHome(role)) return refuse('FORBIDDEN', MAKE_HOME_FORBIDDEN)
    if (input.existingHomeLocationId !== null) {
      return refuse('INVALID_INPUT', 'this product already has a home bin; change it in the home bin editor')
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
