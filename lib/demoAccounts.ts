// Demo personas: single-account bespoke UIs for PO-Inbox client demos, without a
// generalised per-tenant config layer. Each persona is an Admin login whose sidebar
// leads with PO Inbox → Order Import, wears the client's logo, and optionally hides
// the Shop. Keyed on email so the special-casing stays out of AppShell's render tree
// and is unit-testable in isolation.
//
// Adding a persona = one entry in DEMO_PERSONAS + a seed account (see the
// *-demo-seed.mjs fixtures) + the brand logo under public/assets/.

export type AdminLandingView = 'PO Inbox'

export interface DemoPersona {
  /** Login email that activates this persona (compared lowercased/trimmed). */
  email: string
  /** Brand key for the pre-auth login screen, selected via `?brand=<key>`. */
  brandKey: string
  /** Display name used in alt text / labels. */
  displayName: string
  /** Logo shown in the sidebar (and on the login screen when `?brand` matches). */
  logoSrc: string
  /** Lead the admin sidebar with PO Inbox → Order Import before the normal nav. */
  leadWithPoInbox: boolean
  /** Hide the Shop nav entirely (Tridon) or keep it (V2food needs the cart demo). */
  hideShop: boolean
  /** Admin tab the persona lands on at sign-in. */
  landingView: AdminLandingView
  /** Order Import relabels "HoReCa" → these client-facing words. */
  customerLabelSingular: string
  customerLabelPlural: string
  /**
   * Orders with an `orderDate` on/before this instant are treated as pre-seeded demo
   * clutter and hidden from the Order Import screen; POs approved live during the demo
   * carry a later `orderDate` (approve-po stamps `order_date = now`) and still appear.
   * Set to the deploy instant — every order existing at that point predates it. Reload-
   * safe because it's a constant, not captured at mount. Bump + redeploy if the demo DB
   * is re-seeded after this date.
   */
  orderImportCutoffIso: string
}

const TRIDON: DemoPersona = {
  email: 'tridon@nexorder.demo',
  brandKey: 'tridon',
  displayName: 'Tridon',
  logoSrc: '/assets/tridon-logo.png',
  leadWithPoInbox: true,
  hideShop: true,
  landingView: 'PO Inbox',
  customerLabelSingular: 'Customer',
  customerLabelPlural: 'Customers',
  orderImportCutoffIso: '2026-06-16T23:04:59.364Z',
}

const V2FOOD: DemoPersona = {
  email: 'v2food@nexorder.demo',
  brandKey: 'v2food',
  displayName: 'V2food',
  logoSrc: '/assets/v2food-logo.png',
  leadWithPoInbox: true,
  // Unlike Tridon, V2food keeps the Shop so we can demo adding the pinned V2food
  // products to a cart.
  hideShop: false,
  landingView: 'PO Inbox',
  customerLabelSingular: 'Customer',
  customerLabelPlural: 'Customers',
  orderImportCutoffIso: '2026-06-17T00:00:00.000Z',
}

/** All demo personas, keyed by `brandKey`. */
export const DEMO_PERSONAS: Record<string, DemoPersona> = {
  [TRIDON.brandKey]: TRIDON,
  [V2FOOD.brandKey]: V2FOOD,
}

const PERSONA_BY_EMAIL: Record<string, DemoPersona> = Object.fromEntries(
  Object.values(DEMO_PERSONAS).map(persona => [persona.email, persona]),
)

/** The demo persona for the signed-in user, or `null` for a normal account. */
export function getDemoPersona(
  user: { email?: string | null } | null | undefined,
): DemoPersona | null {
  const email = user?.email?.trim().toLowerCase()
  if (!email) return null
  return PERSONA_BY_EMAIL[email] ?? null
}

/**
 * Brand (logo + name) for the pre-auth login screen, chosen by the `?brand=<key>`
 * query param. Login renders before auth, so the brand can't key on the user —
 * the operator opens e.g. `/?brand=v2food` for the V2food demo. Returns `null`
 * (→ neutral Nex Order brand) when the param is absent or unknown.
 */
export function getBrandByKey(
  key: string | null | undefined,
): { logoSrc: string; displayName: string } | null {
  const persona = key ? DEMO_PERSONAS[key.trim().toLowerCase()] : undefined
  if (!persona) return null
  return { logoSrc: persona.logoSrc, displayName: persona.displayName }
}
