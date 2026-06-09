// Server-side pricing logic. KEEP IN SYNC with /pricing.ts and
// /services/promotionService.ts in the project root. The client uses those
// for display; this is the authoritative copy that runs at order placement.

export type Category =
  | 'Coconut' | 'Meal Pastes' | 'Asian Sauces' | 'Soy Sauces' | 'Chilli Sauces'
  | 'Condiments' | 'Noodles' | 'Fish' | 'Satay Sauces' | 'Desserts'
  | 'Ready Meal Sauces' | 'Other'

export type HoReCaTier = 'Gold' | 'Silver' | 'Bronze'

export interface Product {
  id: number
  price: number
  category: Category
  inventory: number
  cartonSize?: number
}

export interface HoReCa {
  id: number
  discountPercent?: number
  tier?: HoReCaTier | null
  pricing?: Record<number, number> | null
}

export interface UserContext {
  id: number
  role: string
}

export type PromotionType = 'percentage' | 'fixed_price' | 'bogo' | 'bundle' | 'clearance'

export type PromotionScope =
  | { kind: 'storewide' }
  | { kind: 'products'; productIds: number[] }
  | { kind: 'categories'; categories: Category[] }

export type PromotionTargeting =
  | { kind: 'all' }
  | { kind: 'horecas'; hoReCaIds: number[] }
  | { kind: 'tier'; tiers: HoReCaTier[] }
  | { kind: 'rep'; repUserId: number }

export interface BogoConfig {
  buyProductId: number
  buyQuantity: number
  getProductId: number
  getQuantity: number
}

export interface BundleConfig {
  productIds: number[]
  bundlePrice: number
}

export interface Promotion {
  id: string
  name: string
  type: PromotionType
  percentOff?: number
  fixedPrice?: number
  bogoConfig?: BogoConfig | null
  bundleConfig?: BundleConfig | null
  clearancePercent?: number
  scope: PromotionScope
  targeting: PromotionTargeting
  stackWithHoReCaPricing: boolean
  startDate?: string | null
  endDate?: string | null
  isActive: boolean
  priority: number
  appliesTo?: 'unit' | 'carton'
}

export interface CartItemInput {
  productId: number
  quantity: number
  packSize?: number | null
}

export interface ResolvedItem {
  productId: number
  quantity: number
  packSize: number | null
  productName: string
  productSku: string
  unitPrice: number
  appliedPromotionId: string | null
}

export interface BogoFreeLine {
  productId: number
  productName: string
  freeQuantity: number
  promoId: string
  promoName: string
  triggerProductId: number
  triggerQuantityRequired: number
  unit: 'unit' | 'carton'
}

export interface BundleDiscountLine {
  promoId: string
  promoName: string
  discount: number
  productIds: number[]
}

export function resolveHoReCaPrice(product: Product, customer?: HoReCa | null): number {
  if (!customer) return product.price
  const perProductPrice = customer?.pricing?.[product.id]
  const blanketPrice = customer.discountPercent != null && customer.discountPercent > 0
    ? product.price * (1 - customer.discountPercent / 100)
    : undefined

  if (perProductPrice != null && blanketPrice != null) return Math.min(perProductPrice, blanketPrice)
  if (perProductPrice != null) return perProductPrice
  if (blanketPrice != null) return blanketPrice
  return product.price
}

export function isPromotionActive(promo: Promotion, now: Date = new Date()): boolean {
  if (!promo.isActive) return false
  const nowStr = now.toISOString().split('T')[0]
  if (promo.startDate && nowStr < promo.startDate) return false
  if (promo.endDate && nowStr > promo.endDate) return false
  return true
}

export function isPromotionApplicable(
  promo: Promotion,
  product: Product,
  customer: HoReCa | null,
  user: UserContext | null,
): boolean {
  const { scope } = promo
  if (scope.kind === 'products' && !scope.productIds.includes(product.id)) return false
  if (scope.kind === 'categories' && !scope.categories.includes(product.category)) return false

  const { targeting } = promo
  if (targeting.kind === 'horecas' && (!customer || !targeting.hoReCaIds.includes(customer.id))) return false
  if (targeting.kind === 'tier' && (!customer?.tier || !targeting.tiers.includes(customer.tier))) return false
  if (targeting.kind === 'rep' && (!user || user.id !== targeting.repUserId)) return false

  return true
}

function calcPromoPrice(promo: Promotion, basePrice: number): number | null {
  switch (promo.type) {
    case 'percentage':
      return promo.percentOff != null ? basePrice * (1 - promo.percentOff / 100) : null
    case 'fixed_price':
      return promo.fixedPrice ?? null
    case 'clearance':
      return promo.clearancePercent != null ? basePrice * (1 - promo.clearancePercent / 100) : null
    default:
      return null
  }
}

export function resolveUnitPrice(
  product: Product,
  customer: HoReCa | null,
  user: UserContext | null,
  promotions: Promotion[],
  now: Date = new Date(),
): { unitPrice: number; appliedPromotionId: string | null } {
  const customerPrice = resolveHoReCaPrice(product, customer)
  const applicable = promotions.filter(p =>
    p.type !== 'bogo' && p.type !== 'bundle' &&
    isPromotionActive(p, now) && isPromotionApplicable(p, product, customer, user)
  )

  let bestPrice = customerPrice
  let bestPromo: Promotion | null = null

  for (const promo of applicable) {
    const base = promo.stackWithHoReCaPricing ? customerPrice : product.price
    const promoPrice = calcPromoPrice(promo, base)
    if (promoPrice == null) continue
    const rounded = Math.round(promoPrice * 100) / 100
    if (rounded < bestPrice || (rounded === bestPrice && bestPromo && promo.priority < bestPromo.priority)) {
      bestPrice = rounded
      bestPromo = promo
    }
  }

  const finalPrice = Math.min(bestPrice, customerPrice)
  return {
    unitPrice: Math.round(finalPrice * 100) / 100,
    appliedPromotionId: finalPrice < customerPrice ? bestPromo?.id ?? null : null,
  }
}

/**
 * Per-LINE unit price. For carton lines (packSize > 1) this returns the price of
 * the whole carton, mirroring the client's components/ProductCard.tsx formula:
 *   cartonPrice = unitPrice × cartonSize × (1 − cartonDiscountPercent/100)
 * For single-unit lines it is identical to resolveUnitPrice. Keeping the carton
 * math here (not just per-unit) is what makes the persisted order/invoice total
 * match the figure the customer sees at checkout.
 */
export function resolveLineUnitPrice(
  product: Product,
  customer: HoReCa | null,
  user: UserContext | null,
  promotions: Promotion[],
  packSize: number | null,
  cartonDiscountPercent: number,
  now: Date = new Date(),
): { unitPrice: number; appliedPromotionId: string | null } {
  const { unitPrice: perUnit, appliedPromotionId } = resolveUnitPrice(product, customer, user, promotions, now)
  const isCarton = packSize != null && packSize > 1
  const lineUnit = isCarton
    ? Math.round(perUnit * packSize * (1 - cartonDiscountPercent / 100) * 100) / 100
    : perUnit
  return { unitPrice: lineUnit, appliedPromotionId }
}

/**
 * Physical BASE units for an order line under the canonical unit model:
 *   base = quantity × COALESCE(pack_size, 1)
 * `quantity` is in LINE units (cartons for a carton line); `pack_size` is the
 * pack factor (units per carton, NULL/1 = single units). Inventory reservation,
 * stock checks, and the ledger all operate in base units. See mig 00035.
 */
export function lineBaseUnits(quantity: number, packSize: number | null | undefined): number {
  return quantity * (packSize ?? 1)
}

export function applyCartPromotions(
  resolvedItems: ResolvedItem[],
  promotions: Promotion[],
  customer: HoReCa | null,
  user: UserContext | null,
  productMap: Map<number, Product>,
  now: Date = new Date(),
): { bogoFreeItems: BogoFreeLine[]; bundleDiscounts: BundleDiscountLine[]; cartDiscount: number } {
  const activePromos = promotions.filter(p => isPromotionActive(p, now))
  const bogoFreeItems: BogoFreeLine[] = []
  const bundleDiscounts: BundleDiscountLine[] = []

  // BOGO
  for (const promo of activePromos) {
    if (promo.type !== 'bogo' || !promo.bogoConfig) continue
    const config = promo.bogoConfig
    const buyProduct = productMap.get(config.buyProductId)
    if (!buyProduct) continue
    if (!isPromotionApplicable(promo, buyProduct, customer, user)) continue

    const buyQty = resolvedItems
      .filter(i => i.productId === config.buyProductId)
      .reduce((sum, i) => sum + i.quantity, 0)
    if (buyQty < config.buyQuantity) continue

    const triggers = Math.floor(buyQty / config.buyQuantity)
    const freeQty = triggers * config.getQuantity
    if (freeQty <= 0) continue

    const getProduct = productMap.get(config.getProductId)
    bogoFreeItems.push({
      productId: config.getProductId,
      productName: getProduct ? (getProduct as Product & { name?: string }).name ?? `Product #${config.getProductId}` : `Product #${config.getProductId}`,
      freeQuantity: freeQty,
      promoId: promo.id,
      promoName: promo.name,
      triggerProductId: config.buyProductId,
      triggerQuantityRequired: config.buyQuantity,
      unit: promo.appliesTo ?? 'unit',
    })
  }

  // Bundles
  for (const promo of activePromos) {
    if (promo.type !== 'bundle' || !promo.bundleConfig) continue
    const config = promo.bundleConfig
    const firstProduct = productMap.get(config.productIds[0])
    if (!firstProduct) continue
    if (!isPromotionApplicable(promo, firstProduct, customer, user)) continue

    const cartProductIds = new Set(resolvedItems.map(i => i.productId))
    if (!config.productIds.every(pid => cartProductIds.has(pid))) continue

    const counts = config.productIds.map(pid =>
      resolvedItems.filter(i => i.productId === pid).reduce((s, i) => s + i.quantity, 0)
    )
    const completeBundles = Math.min(...counts)
    if (completeBundles <= 0) continue

    const individualTotal = config.productIds.reduce((sum, pid) => {
      const item = resolvedItems.find(i => i.productId === pid)
      return sum + (item ? item.unitPrice : 0)
    }, 0)

    const discountPerBundle = Math.max(individualTotal - config.bundlePrice, 0)
    const totalDiscount = Math.round(discountPerBundle * completeBundles * 100) / 100

    if (totalDiscount > 0) {
      bundleDiscounts.push({
        promoId: promo.id,
        promoName: promo.name,
        discount: totalDiscount,
        productIds: config.productIds,
      })
    }
  }

  const cartDiscount = Math.round(bundleDiscounts.reduce((s, b) => s + b.discount, 0) * 100) / 100
  return { bogoFreeItems, bundleDiscounts, cartDiscount }
}
