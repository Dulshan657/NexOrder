/**
 * Seed script for the AYAM Order System Supabase database.
 *
 * Usage:
 *   npx tsx supabase/seed.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables
 * (service role key, NOT the anon key — needed for admin operations).
 *
 * This script imports data from constants.ts and inserts it into Supabase tables.
 */

import { createClient } from '@supabase/supabase-js'
import { USERS, DEFAULT_SETTINGS } from '../constants'
import {
  SUPPLIERS,
  PRODUCTS,
  HORECAS,
  ALL_ORDERS,
  ALL_PURCHASE_ORDERS,
  INITIAL_PANTRY_LISTS,
  INITIAL_INVOICES,
  INITIAL_SALES_TARGETS,
  INITIAL_PROMOTIONS,
  INITIAL_ROUTES,
  INITIAL_VISITS,
} from './seedData'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Deterministic UUID mapping for mock user IDs
const USER_UUID_MAP: Record<number, string> = {
  1: '00000000-0000-0000-0000-000000000001',
  2: '00000000-0000-0000-0000-000000000002',
  3: '00000000-0000-0000-0000-000000000003',
  4: '00000000-0000-0000-0000-000000000004',
  5: '00000000-0000-0000-0000-000000000005',
  6: '00000000-0000-0000-0000-000000000006',
}

function mapUserId(numericId: number): string {
  return USER_UUID_MAP[numericId] ?? `00000000-0000-0000-0000-${String(numericId).padStart(12, '0')}`
}

async function seedSuppliers() {
  console.log('Seeding suppliers...')
  const rows = SUPPLIERS.map(s => ({
    id: s.id,
    name: s.name,
    contact_person: s.contactPerson,
    email: s.email,
    phone: s.phone,
  }))
  const { error } = await supabase.from('suppliers').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`Suppliers: ${error.message}`)
  console.log(`  ✓ ${rows.length} suppliers`)
}

async function seedProducts() {
  console.log('Seeding products...')
  const rows = PRODUCTS.map(p => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    price: p.price,
    category: p.category,
    inventory: p.inventory,
    image_url: p.imageUrl ?? null,
    unit: p.unit,
    carton_size: p.cartonSize,
    dietary_labels: p.dietaryLabels ?? [],
    featured: p.featured ?? false,
    supplier_id: p.supplierId,
    cubic_meters_unit: p.cubicMetersUnit ?? null,
    cubic_meters_carton: p.cubicMetersCarton ?? null,
    length_cm: p.lengthCm ?? null,
    width_cm: p.widthCm ?? null,
    height_cm: p.heightCm ?? null,
  }))
  // Insert in batches of 50 to avoid payload size limits
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    const { error } = await supabase.from('products').upsert(batch, { onConflict: 'id' })
    if (error) throw new Error(`Products batch ${i}: ${error.message}`)
  }
  console.log(`  ✓ ${rows.length} products`)
}

async function seedHoReCas() {
  console.log('Seeding horecas...')
  const rows = HORECAS.map(h => ({
    id: h.id,
    name: h.name,
    address: h.address,
    discount_percent: h.discountPercent ?? 0,
    credit_limit: h.creditLimit ?? 5000,
    show_stock_tab: h.showStockTab ?? null,
    tier: h.tier ?? null,
    lat: h.lat ?? null,
    lng: h.lng ?? null,
  }))
  const { error } = await supabase.from('horecas').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`HoReCas: ${error.message}`)
  console.log(`  ✓ ${rows.length} horecas`)

  // Seed horeca_pricing
  const pricingRows: Array<{ horeca_id: number; product_id: number; custom_price: number }> = []
  for (const h of HORECAS) {
    if (h.pricing) {
      for (const [productId, price] of Object.entries(h.pricing)) {
        pricingRows.push({
          horeca_id: h.id,
          product_id: Number(productId),
          custom_price: price,
        })
      }
    }
  }
  if (pricingRows.length > 0) {
    const { error: pErr } = await supabase.from('horeca_pricing').upsert(pricingRows, { onConflict: 'horeca_id,product_id' })
    if (pErr) throw new Error(`HoReCa pricing: ${pErr.message}`)
    console.log(`  ✓ ${pricingRows.length} pricing overrides`)
  }

  // Seed horeca_payment_methods
  const paymentRows: Array<{ horeca_id: number; type: string; details: string; is_default: boolean }> = []
  for (const h of HORECAS) {
    if (h.paymentMethods) {
      for (const pm of h.paymentMethods) {
        paymentRows.push({
          horeca_id: h.id,
          type: pm.type,
          details: pm.details,
          is_default: pm.isDefault,
        })
      }
    }
  }
  if (paymentRows.length > 0) {
    const { error: pmErr } = await supabase.from('horeca_payment_methods').insert(paymentRows)
    if (pmErr) throw new Error(`Payment methods: ${pmErr.message}`)
    console.log(`  ✓ ${paymentRows.length} payment methods`)
  }
}

async function seedUsers() {
  console.log('Seeding users (auth + profiles)...')
  for (const user of USERS) {
    const uuid = mapUserId(user.id)
    // Create auth user
    const { error: authErr } = await supabase.auth.admin.createUser({
      email: user.email,
      password: process.env.SEED_USER_PASSWORD || 'Password123!',
      email_confirm: true,
      user_metadata: { name: user.name, role: user.role },
    })
    // Ignore "user already exists" errors
    if (authErr && !authErr.message.includes('already')) {
      console.warn(`  ⚠ Auth user ${user.email}: ${authErr.message}`)
    }
  }

  // The trigger should create profiles, but let's upsert to be safe
  // First get the actual auth user IDs
  const { data: authUsers } = await supabase.auth.admin.listUsers()
  const emailToUuid: Record<string, string> = {}
  if (authUsers?.users) {
    for (const au of authUsers.users) {
      if (au.email) emailToUuid[au.email] = au.id
    }
  }

  const profileRows = USERS.map(u => ({
    id: emailToUuid[u.email] ?? mapUserId(u.id),
    name: u.name,
    email: u.email,
    role: u.role,
    avatar_url: u.avatarUrl ?? null,
    horeca_id: u.hoReCaId ?? null,
  }))

  const { error } = await supabase.from('profiles').upsert(profileRows, { onConflict: 'id' })
  if (error) throw new Error(`Profiles: ${error.message}`)

  // Update the UUID map with actual UUIDs from auth
  for (const u of USERS) {
    if (emailToUuid[u.email]) {
      USER_UUID_MAP[u.id] = emailToUuid[u.email]
    }
  }

  console.log(`  ✓ ${USERS.length} users`)
}

async function seedOrders() {
  console.log('Seeding orders...')
  const orderRows = ALL_ORDERS.map(o => ({
    id: o.id,
    horeca_id: o.hoReCa.id,
    submitted_by: mapUserId(o.submittedBy.id),
    total: o.total,
    order_date: o.orderDate,
    notes: o.notes ?? null,
    status: o.status,
    status_history: o.statusHistory,
    delivery_date: o.deliveryDate ?? null,
    delivery_time_slot: o.deliveryTimeSlot ?? null,
    verification: o.verification ?? null,
    applied_promotions: o.appliedPromotions ?? null,
  }))

  const { error } = await supabase.from('orders').upsert(orderRows, { onConflict: 'id' })
  if (error) throw new Error(`Orders: ${error.message}`)
  console.log(`  ✓ ${orderRows.length} orders`)

  // Seed order_items
  console.log('Seeding order items...')
  const itemRows: Array<{
    order_id: string
    product_id: number
    quantity: number
    pack_size: number | null
    unit_price: number
    product_name: string
    product_sku: string
  }> = []

  for (const order of ALL_ORDERS) {
    for (const item of order.items) {
      itemRows.push({
        order_id: order.id,
        product_id: item.id,
        quantity: item.quantity,
        pack_size: item.packSize ?? null,
        unit_price: item.price,
        product_name: item.name,
        product_sku: item.sku,
      })
    }
  }

  // Insert in batches
  for (let i = 0; i < itemRows.length; i += 50) {
    const batch = itemRows.slice(i, i + 50)
    const { error: itemErr } = await supabase.from('order_items').insert(batch)
    if (itemErr) throw new Error(`Order items batch ${i}: ${itemErr.message}`)
  }
  console.log(`  ✓ ${itemRows.length} order items`)
}

async function seedInvoices() {
  console.log('Seeding invoices...')
  const rows = INITIAL_INVOICES.map(inv => ({
    id: inv.id,
    order_id: inv.orderId,
    horeca_id: inv.hoReCaId,
    horeca_name: inv.hoReCaName,
    amount: inv.amount,
    due_date: inv.dueDate,
    status: inv.status,
    paid_date: inv.paidDate ?? null,
    created_date: inv.createdDate,
  }))
  const { error } = await supabase.from('invoices').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`Invoices: ${error.message}`)
  console.log(`  ✓ ${rows.length} invoices`)
}

async function seedPurchaseOrders() {
  console.log('Seeding purchase orders...')
  const poRows = ALL_PURCHASE_ORDERS.map(po => ({
    id: po.id,
    supplier_id: po.supplier.id,
    total: po.total,
    order_date: po.orderDate,
    status: po.status,
    submitted_by: mapUserId(po.submittedBy.id),
  }))
  const { error } = await supabase.from('purchase_orders').upsert(poRows, { onConflict: 'id' })
  if (error) throw new Error(`Purchase orders: ${error.message}`)
  console.log(`  ✓ ${poRows.length} purchase orders`)

  // Seed PO items
  const itemRows: Array<{
    purchase_order_id: string
    product_id: number
    product_name: string
    quantity: number
    cost: number
  }> = []
  for (const po of ALL_PURCHASE_ORDERS) {
    for (const item of po.items) {
      itemRows.push({
        purchase_order_id: po.id,
        product_id: item.productId,
        product_name: item.productName,
        quantity: item.quantity,
        cost: item.cost,
      })
    }
  }
  const { error: itemErr } = await supabase.from('purchase_order_items').insert(itemRows)
  if (itemErr) throw new Error(`PO items: ${itemErr.message}`)
  console.log(`  ✓ ${itemRows.length} purchase order items`)
}

async function seedPromotions() {
  console.log('Seeding promotions...')
  const rows = INITIAL_PROMOTIONS.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    type: p.type,
    percent_off: p.percentOff ?? null,
    fixed_price: p.fixedPrice ?? null,
    bogo_config: p.bogoConfig ?? null,
    bundle_config: p.bundleConfig ?? null,
    clearance_percent: p.clearancePercent ?? null,
    scope: p.scope,
    targeting: p.targeting,
    min_order_value: p.minOrderValue ?? null,
    stack_with_horeca_pricing: p.stackWithHoReCaPricing,
    start_date: p.startDate ?? null,
    end_date: p.endDate ?? null,
    is_active: p.isActive,
    created_at: p.createdAt,
    created_by: mapUserId(p.createdBy),
    priority: p.priority,
  }))
  const { error } = await supabase.from('promotions').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`Promotions: ${error.message}`)
  console.log(`  ✓ ${rows.length} promotions`)
}

async function seedPantryItems() {
  console.log('Seeding pantry items...')
  const rows: Array<{
    horeca_id: number
    product_id: number
    preferred_pack_size: number | null
    default_quantity: number
  }> = []

  for (const [horecaId, items] of Object.entries(INITIAL_PANTRY_LISTS)) {
    for (const item of items) {
      rows.push({
        horeca_id: Number(horecaId),
        product_id: item.productId,
        preferred_pack_size: item.preferredPackSize ?? null,
        default_quantity: item.defaultQuantity,
      })
    }
  }
  const { error } = await supabase.from('pantry_items').upsert(rows, { onConflict: 'horeca_id,product_id' })
  if (error) throw new Error(`Pantry items: ${error.message}`)
  console.log(`  ✓ ${rows.length} pantry items`)
}

async function seedSalesTargets() {
  console.log('Seeding sales targets...')
  const rows = INITIAL_SALES_TARGETS.map(t => ({
    id: t.id,
    user_id: mapUserId(t.userId),
    type: t.type,
    target_value: t.targetValue,
    start_date: t.startDate,
    end_date: t.endDate,
    created_at: t.createdAt,
  }))
  const { error } = await supabase.from('sales_targets').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`Sales targets: ${error.message}`)
  console.log(`  ✓ ${rows.length} sales targets`)
}

async function seedRoutes() {
  console.log('Seeding routes...')
  const rows = INITIAL_ROUTES.map(r => ({
    id: r.id,
    name: r.name,
    date: r.date || null,
    stops: r.stops,
    status: r.status,
    created_by: mapUserId(r.createdBy),
    created_at: r.createdAt,
    completed_at: r.completedAt ?? null,
    assigned_to: r.assignedTo ? mapUserId(r.assignedTo) : null,
    assigned_by: r.assignedBy ? mapUserId(r.assignedBy) : null,
    assigned_at: r.assignedAt ?? null,
    is_template: r.isTemplate ?? false,
    template_id: r.templateId ?? null,
    recurrence: r.recurrence ?? null,
    change_requests: r.changeRequests ?? [],
  }))
  const { error } = await supabase.from('scheduled_visits').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`Scheduled Visits: ${error.message}`)
  console.log(`  ✓ ${rows.length} scheduled visits`)
}

async function seedVisits() {
  console.log('Seeding visits...')
  const rows = INITIAL_VISITS.map(v => ({
    id: v.id,
    horeca_id: v.hoReCaId,
    user_id: mapUserId(v.userId),
    scheduled_visit_id: v.scheduledVisitId ?? null,
    arrival_time: v.arrivalTime,
    departure_time: v.departureTime ?? null,
    outcome: v.outcome ?? null,
    notes: v.notes ?? null,
    competitor_notes: v.competitorNotes ?? null,
    stock_check_notes: v.stockCheckNotes ?? null,
    next_visit_recommendation: v.nextVisitRecommendation ?? null,
    photos: v.photos ?? [],
    created_at: v.createdAt,
  }))
  const { error } = await supabase.from('visits').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`Visits: ${error.message}`)
  console.log(`  ✓ ${rows.length} visits`)
}

async function seedSettings() {
  console.log('Seeding app settings...')
  const row = {
    id: 1,
    company_name: DEFAULT_SETTINGS.companyName,
    company_address: DEFAULT_SETTINGS.companyAddress,
    company_phone: DEFAULT_SETTINGS.companyPhone,
    company_email: DEFAULT_SETTINGS.companyEmail,
    order_id_prefix: DEFAULT_SETTINGS.orderIdPrefix,
    minimum_order_value: DEFAULT_SETTINGS.minimumOrderValue,
    default_credit_limit: DEFAULT_SETTINGS.defaultCreditLimit,
    carton_discount_percent: DEFAULT_SETTINGS.cartonDiscountPercent,
    low_stock_threshold: DEFAULT_SETTINGS.lowStockThreshold,
    currency: DEFAULT_SETTINGS.currency,
    show_stock_to_horeca: DEFAULT_SETTINGS.showStockToHoReCa,
  }
  const { error } = await supabase.from('app_settings').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`Settings: ${error.message}`)
  console.log('  ✓ app settings')
}

async function main() {
  console.log('=== AYAM Order System — Database Seed ===\n')

  try {
    // Order matters — FK dependencies
    await seedSuppliers()
    await seedProducts()
    await seedHoReCas()
    await seedUsers()
    await seedOrders()
    await seedInvoices()
    await seedPurchaseOrders()
    await seedPromotions()
    await seedPantryItems()
    await seedSalesTargets()
    await seedRoutes()
    await seedVisits()
    await seedSettings()

    console.log('\n=== Seed complete! ===')
  } catch (err) {
    console.error('\n✗ Seed failed:', err)
    process.exit(1)
  }
}

main()
