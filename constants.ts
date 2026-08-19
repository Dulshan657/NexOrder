// Nex Order — application-wide lookup tables.
//
// Demo seed data (users, products, venues, orders, routes, ...) lives in
// supabase/seedData/ and is imported only by supabase/seed.ts. Keep it that
// way: anything added here reaches every browser.
//
// The demo USERS roster used to live here and did exactly that — App.tsx
// imports this file, so six seeded accounts including a live Admin were bundled
// into every browser regardless of VITE_SHOW_DEMO_LOGINS. It now lives in
// supabase/seedData/users.ts. Do not bring it back.
import type { Category, AppSettings, OrderStatus, DeliveryTimeSlot } from './types';

/**
 * Built-in category suggestions. Since mig 00069 categories are open-ended
 * (operators create them from the product form), so this is a seed list, not an
 * allow-list — every dropdown/filter merges it with the categories actually in
 * use via `lib/productTaxonomy.ts`.
 */
export const CATEGORIES: readonly Category[] = [
  'Plant-Based', 'Coconut', 'Meal Pastes', 'Asian Sauces', 'Soy Sauces', 'Chilli Sauces',
  'Condiments', 'Noodles', 'Fish', 'Satay Sauces', 'Desserts',
  'Ready Meal Sauces', 'Other'
];

/**
 * Canonical unit-of-measure names offered by the product form's UOM pickers
 * (mig 00067). Same deal as CATEGORIES: a suggestion list, merged with the codes
 * already in the catalog, with an "Other…" escape hatch for anything unusual.
 * Ordered smallest-to-largest so the dropdown reads like a pack hierarchy.
 */
export const UOM_CODES: readonly string[] = [
  'each', 'unit', 'bottle', 'can', 'jar', 'packet', 'pack', 'bag', 'tray',
  'box', 'carton', 'case', 'pallet', 'drum', 'kg', 'g', 'L', 'mL'
];

export const DEFAULT_SETTINGS: AppSettings = {
    companyName: 'Nex Order',
    companyAddress: '100 Harris St, Pyrmont NSW 2009',
    companyPhone: '+61 2 8000 1234',
    companyEmail: 'orders@nexorder.com.au',
    orderIdPrefix: 'ORD',
    minimumOrderValue: 0,
    defaultCreditLimit: 5000,
    cartonDiscountPercent: 5,
    lowStockThreshold: 10,
    currency: 'AUD',
    showStockToHoReCa: false,
    poAutoApproveEnabled: true,
    poAutoApproveBlockOnShortStock: true,
    poAutoApproveBlockOnSenderMismatch: true,
    poAutoApproveBlockOnCustomerMismatch: true,
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    processing: 'Processing',
    processed: 'Processed',
    picked: 'Picked',
    packed: 'Packed',
    dispatched: 'Dispatched',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, { bg: string; text: string; border: string }> = {
    processing: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    processed: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    picked: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    packed: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    dispatched: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    delivered: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    // Stone, not red. A cancelled order is closed, not an error, and every
    // other badge on the row is already carrying colour that means something.
    cancelled: { bg: 'bg-stone-100', text: 'text-stone-600', border: 'border-stone-300' },
};

// The fulfilment LADDER, and deliberately still six: 'cancelled' is a terminal
// side-state with no position on it. Anything walking this array to find
// "the next status" must never offer cancellation as a step forward.
export const ORDER_STATUS_SEQUENCE: OrderStatus[] = ['processing', 'processed', 'picked', 'packed', 'dispatched', 'delivered'];

export const DELIVERY_TIME_SLOTS: DeliveryTimeSlot[] = [
    'Morning (8am-12pm)',
    'Afternoon (12pm-4pm)',
    'Evening (4pm-8pm)',
];

export const DELIVERY_LEAD_DAYS = 1;
