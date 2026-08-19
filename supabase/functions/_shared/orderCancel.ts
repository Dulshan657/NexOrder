// Whether an order may be cancelled — the one definition, for both runtimes.
//
// WHY THIS MODULE EXISTS. The Cancel button has to be disabled, with a reason,
// for every order that cannot be cancelled — and the reason it shows must be
// the reason the server would give. Writing that twice produces the failure this
// codebase keeps designing against: a UI that offers an action the server then
// refuses, or worse, greys out an action the server would have allowed. So the
// dialog's live verdict is not a prediction of the server's decision, it IS the
// server's decision, evaluated early.
//
// THE WINDOW IS "BEFORE ANYTHING PHYSICAL HAPPENED", not a status range.
// `processing` and `processed` are the two statuses that mean stock is reserved
// and nothing has moved, so releasing the reservation restores the world
// exactly. That is what `inv_release_reservation` can do and all it can do:
// it nets (ordered − picked) and deallocates the remainder, so it CANNOT undo a
// pick, and picked units have already left on_hand.
//
// But status alone is not sufficient, which is the subtle part. An order's
// status is the ROLLUP of its per-warehouse fulfilments (rollupOrderStatus takes
// the lowest rung), so an order sitting at `processed` may have one warehouse
// that has already picked its share. Cancelling it would release the unpicked
// remainder and silently leave the picked units off the shelf, allocated to an
// order that no longer exists — precisely the stranded-stock failure
// _shared/fulfillment.ts exists to prevent. Hence PICKING_STARTED: the check is
// on `pick_progress`, the physical record, not on the status that summarises it.
//
// PURITY: no Deno globals, no I/O, no imports. `lib/orderCancel.ts` re-exports
// it for the browser (same shape as _shared/binCount.ts ↔ lib/binCount.ts).

/** Every value `orders.status` may hold after mig 00111. */
export type CancellableOrderStatus =
  | 'processing'
  | 'processed'
  | 'picked'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'

/** Every value `invoices.status` may hold after mig 00111. */
export type CancelInvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled'

/**
 * The statuses from which an order may still be cancelled.
 *
 * Deliberately NOT derived by indexing into the status ladder. `cancelled` has
 * no rung on that ladder — it is a terminal side-state, not a seventh step —
 * and every attempt to express it as a position is how `update-order-status`
 * would come to believe a cancelled order can be advanced to `delivered`
 * (`STATUS_ORDER.indexOf('cancelled')` is -1, which compares as "before
 * everything"). An explicit list cannot develop that bug.
 */
export const CANCELLABLE_STATUSES: ReadonlyArray<CancellableOrderStatus> = [
  'processing',
  'processed',
]

/**
 * Who may cancel.
 *
 * Admin only, matching `orders_delete_admin` (00001:676) — the policy mig 00112
 * drops and this function replaces. Managers drive order status through
 * update-order-status, but voiding an invoiced order is a different act from
 * advancing one, and it is the act that was Admin-gated before.
 */
export const CANCEL_ROLES: ReadonlyArray<string> = ['Admin']

export const CANCEL_REASON_MIN = 5
export const CANCEL_REASON_MAX = 500

export type CancelRefusalCode =
  /** The caller is not an Admin. */
  | 'FORBIDDEN'
  /** Already cancelled. Distinct from NOT_CANCELLABLE so a double-submit reads
   *  as "already done" rather than "you may not do this", and so the server can
   *  answer it without releasing a reservation a second time. */
  | 'ALREADY_CANCELLED'
  /** Past the window: picked, packed, dispatched or delivered. */
  | 'NOT_CANCELLABLE'
  /** Within the window by status, but a warehouse has already picked units. */
  | 'PICKING_STARTED'
  /** The invoice has been paid. */
  | 'INVOICE_PAID'
  /** No reason, or one too short/long to be a reason. */
  | 'REASON_REQUIRED'

export interface CancelRefusal {
  ok: false
  code: CancelRefusalCode
  /** Operator-facing. Names what is true and what to do instead — never the
   *  error code, and never a bare "not allowed". */
  message: string
}

export type CancelDecision = { ok: true } | CancelRefusal

/** Everything the decision turns on. Assembled from the order row, its invoice
 *  (if any) and a count over `pick_progress`; nothing here is derived from
 *  anything else, so the browser and the Edge Function can each gather it in
 *  whatever way suits them. */
export interface CancelSubject {
  status: CancellableOrderStatus
  /** null when the order has no invoice at all. `place-order` creates one
   *  best-effort and logs rather than rolling back if it fails, so this is a
   *  real case and not a defensive nicety. */
  invoiceStatus: CancelInvoiceStatus | null
  /** Sum of `pick_progress.picked_qty` across the order. Zero for an order
   *  nobody has picked against. */
  pickedUnits: number
  actorRole: string
}

/**
 * The blockers that do not depend on what the operator typed.
 *
 * This is what the Cancel button reads: it decides whether the action is
 * available at all. Returns null when the order can be cancelled, so the caller
 * can treat null as "go ahead".
 *
 * Order matters. Each check is asked only once the previous one has passed, so
 * the message the operator sees names the FIRST thing standing in the way
 * rather than an arbitrary one — a delivered order whose invoice is also paid
 * should say it has been delivered, because that is the fact that decides it.
 */
export function cancelBlocker(subject: CancelSubject): CancelRefusal | null {
  if (!CANCEL_ROLES.includes(subject.actorRole)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Only an Admin can cancel an order.',
    }
  }

  if (subject.status === 'cancelled') {
    return {
      ok: false,
      code: 'ALREADY_CANCELLED',
      message: 'This order has already been cancelled.',
    }
  }

  if (!CANCELLABLE_STATUSES.includes(subject.status)) {
    return {
      ok: false,
      code: 'NOT_CANCELLABLE',
      message:
        `This order is ${describeStatus(subject.status)}, so cancelling it would ` +
        'leave stock off the shelf with nothing to put it back. Return it through ' +
        'the warehouse — receive the goods back in and adjust the order — rather ' +
        'than cancelling.',
    }
  }

  if (subject.pickedUnits > 0) {
    return {
      ok: false,
      code: 'PICKING_STARTED',
      message:
        `Picking has already started — ${subject.pickedUnits} unit` +
        `${subject.pickedUnits === 1 ? ' has' : 's have'} been picked against this ` +
        'order at one or more warehouses. Cancelling would release only the ' +
        'unpicked remainder and strand what is already off the shelf. Finish or ' +
        'reverse the pick first.',
    }
  }

  if (subject.invoiceStatus === 'paid') {
    return {
      ok: false,
      code: 'INVOICE_PAID',
      message:
        'This order has been paid for. Refund or credit the invoice first — ' +
        'cancelling would void a paid invoice with nothing recording the money.',
    }
  }

  return null
}

/**
 * The full decision, including the reason the operator typed.
 *
 * The reason is mandatory and is checked here as well as by
 * `orders_cancelled_fields_check` in the database, because "why was this order
 * cancelled" is the field an auditor asks for and it cannot be reconstructed
 * afterwards. The length floor mirrors `mutate-invoice-status`, where a Manager
 * changing payment status must supply `z.string().min(5)`.
 */
export function evaluateCancel(
  subject: CancelSubject & { reason?: string | null },
): CancelDecision {
  const blocker = cancelBlocker(subject)
  if (blocker) return blocker

  const reason = (subject.reason ?? '').trim()
  if (reason.length < CANCEL_REASON_MIN) {
    return {
      ok: false,
      code: 'REASON_REQUIRED',
      message:
        `Give a reason for cancelling — at least ${CANCEL_REASON_MIN} characters. ` +
        'It is stored on the order and in the audit log.',
    }
  }
  if (reason.length > CANCEL_REASON_MAX) {
    return {
      ok: false,
      code: 'REASON_REQUIRED',
      message: `Keep the reason under ${CANCEL_REASON_MAX} characters.`,
    }
  }

  return { ok: true }
}

/** Past-tense prose for a status, for use inside a sentence. Kept here rather
 *  than reaching for ORDER_STATUS_LABELS because this module is imported by Deno,
 *  and because a refusal wants "has been dispatched", not "Dispatched". */
function describeStatus(status: CancellableOrderStatus): string {
  switch (status) {
    case 'picked':
      return 'already picked'
    case 'packed':
      return 'already packed'
    case 'dispatched':
      return 'already dispatched'
    case 'delivered':
      return 'already delivered'
    default:
      return `at status "${status}"`
  }
}
