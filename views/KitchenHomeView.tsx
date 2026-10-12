import React, { useCallback, useMemo, useState } from 'react'
import { ClipboardList, History, Package, Pencil, RotateCcw, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui'
import StatusBadge from '@/components/StatusBadge'
import PromotionsBanner from '@/components/PromotionsBanner'
import PendingQrRequests from '@/components/qr/PendingQrRequests'
import KitchenSameAgainModal from '@/components/qr/KitchenSameAgainModal'
import { buildReorderPlan, pickKitchenOrders, type ReorderPlan } from '@/lib/kitchen/reorderPlan'
import { formatMoney, itemCountLabel } from '@/lib/qr/qrFormat'
import { isQrStaffRole } from '@/lib/venueUser'
import type { SubmitResult } from '@/context/OrderContext'
import type { AppSettings, HoReCa, Order, OrderItem, Product, Promotion, ToastType, User } from '@/types'

// The landing screen of a venue login: what a kitchen needs at 5am with one hand
// free. A QR Staff login always starts here; a Customer login does when it arrived
// through the venue's QR.
//
//   - anything of theirs still waiting for approval, with Cancel on their own;
//   - the last order, with "Order same again" (a confirm step, then one tap) and
//     "Edit before ordering" (loads the cart, opens the Shop);
//   - the last three orders, each reorderable the same way;
//   - shortcuts to the Shop, the pantry list and order history; live promotions.
//
// Every price here is an ESTIMATE and says so: the server reprices when the order
// is approved or placed. It takes its data as props rather than reading contexts,
// so the screen is the same whoever mounts it and tests need no providers.

export interface KitchenHomeViewProps {
  currentUser: User
  products: Product[]
  /** The signed-in login's own venue; undefined while the customer list loads. */
  hoReCa: HoReCa | undefined
  /** Orders to draw from; the venue's own are picked out here. */
  orders: Order[]
  promotions: Promotion[]
  cartonDiscountPercent: AppSettings['cartonDiscountPercent']
  /** How many products are on the pantry list, for its shortcut. */
  pantryCount: number
  /** `useOrderContext().orderItemsNow`: files a request (QR Staff) or places the order (Customer). */
  onOrderNow: (items: OrderItem[], options?: { notes?: string }) => Promise<SubmitResult>
  /** Load these lines into the cart and open it in the Shop. */
  onEditItems: (items: OrderItem[]) => void
  onOpenShop: () => void
  onOpenPantry: () => void
  onOpenHistory: () => void
  onViewOrder: (orderId: string) => void
  addToast: (message: string, type: ToastType) => void
}

const orderDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

const SHORTCUT_CLASS =
  'touch-target-y flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-2 py-3 text-sm font-semibold text-stone-800 shadow-card transition-colors btn-press hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2'

const KitchenHomeView: React.FC<KitchenHomeViewProps> = ({
  currentUser,
  products,
  hoReCa,
  orders,
  promotions,
  cartonDiscountPercent,
  pantryCount,
  onOrderNow,
  onEditItems,
  onOpenShop,
  onOpenPantry,
  onOpenHistory,
  onViewOrder,
  addToast,
}) => {
  const isQrStaff = isQrStaffRole(currentUser.role)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { hero, recent } = useMemo(() => pickKitchenOrders(orders, hoReCa?.id), [orders, hoReCa?.id])

  const planFor = useCallback(
    (order: Order): ReorderPlan =>
      buildReorderPlan({
        order,
        products,
        hoReCa: hoReCa ?? null,
        promotions,
        currentUser,
        cartonDiscountPercent,
      }),
    [products, hoReCa, promotions, currentUser, cartonDiscountPercent],
  )

  const heroPlan = useMemo(() => (hero ? planFor(hero) : null), [hero, planFor])

  const openConfirm = () => {
    setError(null)
    setConfirmOpen(true)
  }

  const confirm = async (notes: string) => {
    if (!heroPlan || heroPlan.items.length === 0) return
    setBusy(true)
    setError(null)
    const result = await onOrderNow(heroPlan.items, { notes })
    setBusy(false)
    if (result.ok === false) {
      setError(result.error)
      return
    }
    setConfirmOpen(false)
  }

  // "Edit": the same lines, in the cart. A line that cannot be ordered today is
  // left out and the person is told, rather than carried into a cart that fails.
  const edit = (plan: ReorderPlan) => {
    if (plan.items.length === 0) {
      addToast('None of the items from that order can be ordered right now.', 'error')
      return
    }
    if (plan.excluded.length > 0) {
      addToast(`Left out: ${plan.excluded.map((l) => l.source.name).join(', ')}`, 'info')
    }
    setConfirmOpen(false)
    onEditItems(plan.items)
  }

  if (!hoReCa) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p role="status" className="text-sm text-stone-600">
          Loading your kitchen…
        </p>
      </div>
    )
  }

  const firstName = currentUser.name.trim().split(/\s+/)[0] ?? ''

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-stone-900">{hoReCa.name}</h1>
        {isQrStaff && firstName && <p className="mt-0.5 text-sm text-stone-600">Hi {firstName}</p>}
      </header>

      <PendingQrRequests horecaId={hoReCa.id} mode={isQrStaff ? 'requester' : 'approver'} compact />

      {hero && heroPlan ? (
        <section aria-labelledby="kitchen-last-order" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="kitchen-last-order" className="text-xs font-semibold uppercase tracking-wider text-stone-600">
                Your last order
              </h2>
              <p className="mt-1 font-display text-lg font-semibold text-stone-900">{orderDay(hero.orderDate)}</p>
              <p className="text-sm text-stone-600">
                {itemCountLabel(hero.items.length)} · {formatMoney(hero.total)}
              </p>
            </div>
            <StatusBadge status={hero.status} />
          </div>

          <p className="mt-3 text-sm text-stone-700">
            {hero.items
              .slice(0, 3)
              .map((i) => i.name)
              .join(', ')}
            {hero.items.length > 3 ? ` and ${hero.items.length - 3} more` : ''}
          </p>

          <p className="mt-3 text-sm text-stone-600">
            Same again today:{' '}
            <span className="font-semibold text-stone-900">{formatMoney(heroPlan.estimatedTotal)}</span> (estimate)
            {heroPlan.excluded.length > 0 && <> · {heroPlan.excluded.length} unavailable</>}
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button onClick={openConfirm} icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />} className="w-full">
              Order same again
            </Button>
            <Button
              variant="secondary"
              onClick={() => edit(heroPlan)}
              icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
              className="w-full"
            >
              Edit before ordering
            </Button>
          </div>
        </section>
      ) : (
        <section
          aria-labelledby="kitchen-no-orders"
          className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center"
        >
          <Package className="mx-auto h-10 w-10 text-stone-400" aria-hidden="true" />
          <h2 id="kitchen-no-orders" className="mt-2 font-display text-lg font-semibold text-stone-900">
            No orders yet
          </h2>
          <p className="mt-1 text-sm text-stone-600">Once you have ordered, you can repeat it here in one tap.</p>
          <div className="mt-4">
            <Button onClick={onOpenShop} icon={<ShoppingCart className="h-4 w-4" aria-hidden="true" />}>
              Browse shop
            </Button>
          </div>
        </section>
      )}

      <nav aria-label="Kitchen shortcuts" className="grid grid-cols-3 gap-3">
        <button type="button" onClick={onOpenShop} className={SHORTCUT_CLASS}>
          <ShoppingCart className="h-5 w-5 text-nexgen-blue-dark" aria-hidden="true" />
          Shop
        </button>
        <button type="button" onClick={onOpenPantry} className={SHORTCUT_CLASS}>
          <ClipboardList className="h-5 w-5 text-nexgen-blue-dark" aria-hidden="true" />
          {pantryCount > 0 ? `Pantry list (${pantryCount})` : 'Pantry list'}
        </button>
        <button type="button" onClick={onOpenHistory} className={SHORTCUT_CLASS}>
          <History className="h-5 w-5 text-nexgen-blue-dark" aria-hidden="true" />
          Order history
        </button>
      </nav>

      {promotions.length > 0 && (
        <PromotionsBanner promotions={promotions} customer={hoReCa} currentUser={currentUser} products={products} />
      )}

      {recent.length > 0 && (
        <section aria-labelledby="kitchen-recent">
          <h2 id="kitchen-recent" className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-600">
            Recent orders
          </h2>
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card">
            {recent.map((order) => (
              <li key={order.id} className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => onViewOrder(order.id)}
                  className="touch-target-y min-w-0 flex-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
                  aria-label={`View order from ${orderDay(order.orderDate)}`}
                >
                  <span className="block text-sm font-semibold text-stone-900">{orderDay(order.orderDate)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
                    {itemCountLabel(order.items.length)} · {formatMoney(order.total)}
                    <StatusBadge status={order.status} />
                  </span>
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => edit(planFor(order))}
                  icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                  aria-label={`Reorder the order from ${orderDay(order.orderDate)}`}
                >
                  Reorder
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirmOpen && hero && heroPlan && (
        <KitchenSameAgainModal
          open
          onClose={() => {
            if (!busy) setConfirmOpen(false)
          }}
          fromLabel={orderDay(hero.orderDate)}
          plan={heroPlan}
          heldForApproval={isQrStaff}
          busy={busy}
          error={error}
          onConfirm={(notes) => void confirm(notes)}
          onEdit={() => edit(heroPlan)}
        />
      )}
    </div>
  )
}

export default KitchenHomeView
