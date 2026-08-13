// Demo seed: venues, orders, purchase orders, pantry lists and invoices.
//
// Split out of constants.ts so this never reaches the browser bundle. Only
// supabase/seed.ts imports it. See supabase/seedData/index.ts.
import type {
  HoReCa, Order, PurchaseOrder, PantryLists, Invoice, OrderStatus,
  DeliveryTimeSlot, OrderVerification,
} from '../../types';
import { USERS } from './users';
import { PRODUCTS, SUPPLIERS } from './products';

export const HORECAS: HoReCa[] = [
  {
    id: 1,
    name: 'The Grand Hotel',
    address: '123 Luxury Ave, Sydney NSW 2000',
    pricing: { 3: 4.50, 8: 4.60, 20: 3.50 },
    discountPercent: 8,
    paymentMethods: [
      { id: 1, type: 'On Account', details: 'Net 30 Days', isDefault: true },
      { id: 2, type: 'Credit Card', details: 'Amex ending in 0005', isDefault: false },
    ],
    creditLimit: 5000,
    showStockTab: true,
    tier: 'Gold',
    lat: -33.8688, lng: 151.2093,
  },
  {
    id: 2,
    name: 'Seaside Bistro',
    address: '456 Ocean View, Gold Coast QLD 4217',
    paymentMethods: [
      { id: 3, type: 'Credit Card', details: 'Visa ending in 4567', isDefault: true }
    ],
    creditLimit: 2000,
    tier: 'Silver',
    lat: -28.6474, lng: 153.6020,
  },
  {
    id: 3,
    name: 'Mountain Retreat Inn',
    address: '789 Pine Trail, Blue Mountains NSW 2780',
    paymentMethods: [
      { id: 4, type: 'Bank Transfer', details: 'Account ending in 9876', isDefault: true },
      { id: 5, type: 'On Account', details: 'Net 15 Days', isDefault: false },
    ],
    creditLimit: 10000,
    tier: 'Gold',
    lat: -33.7165, lng: 150.3119,
  },
  {
    id: 4,
    name: 'Lotus Garden Restaurant',
    address: '12 Dixon St, Chinatown NSW 2000',
    discountPercent: 5,
    paymentMethods: [
      { id: 6, type: 'On Account', details: 'Net 14 Days', isDefault: true },
    ],
    creditLimit: 3000,
    showStockTab: false,
    tier: 'Bronze',
    lat: -33.8773, lng: 151.2039,
  },
  {
    id: 5,
    name: 'The Spice Room',
    address: '88 Chapel St, Melbourne VIC 3141',
    pricing: { 14: 4.20, 23: 3.60, 98: 3.50 },
    paymentMethods: [
      { id: 7, type: 'Credit Card', details: 'Mastercard ending in 8821', isDefault: true },
      { id: 8, type: 'Bank Transfer', details: 'Account ending in 3344', isDefault: false },
    ],
    creditLimit: 7500,
    tier: 'Silver',
    lat: -37.8490, lng: 144.9930,
  },
  {
    id: 6,
    name: 'Harbour View Café',
    address: '5 Circular Quay, Sydney NSW 2000',
    paymentMethods: [
      { id: 9, type: 'On Account', details: 'Net 30 Days', isDefault: true },
    ],
    creditLimit: 4000,
    tier: 'Bronze',
    lat: -33.8596, lng: 151.2100,
  },
];

// Helper to create dates relative to "today" (2026-03-31)
const d = (daysAgo: number, hour: number = 10): string => {
  const date = new Date(2026, 2, 31); // March 31, 2026
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return date.toISOString();
};

// Minimal 1x1 white PNG as placeholder for demo signature data
const DEMO_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAAA8CAYAAADc0VAlAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAADvBhIQAAH0dVYnAAAAAElFTkSuQmCC';

const mkHistory = (status: OrderStatus, orderDate: string): import('../../types').StatusHistoryEntry[] => {
  const seq: OrderStatus[] = ['processing', 'processed', 'picked', 'packed', 'dispatched', 'delivered'];
  const idx = seq.indexOf(status);
  const base = new Date(orderDate).getTime();
  return seq.slice(0, idx + 1).map((s, i) => ({
    status: s,
    timestamp: new Date(base + i * 86400000).toISOString(),
  }));
};

export const ALL_ORDERS: Order[] = [
  // --- Recent orders (last 7 days) ---
  {
    id: 'ORD-1001', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(1, 9), status: 'processing' as OrderStatus,
    statusHistory: mkHistory('processing', d(1, 9)),
    deliveryDate: '2026-04-02', deliveryTimeSlot: 'Morning (8am-12pm)' as DeliveryTimeSlot,
    items: [
      { ...PRODUCTS[2], quantity: 5, packSize: 12, price: 4.50 * 12 * 0.95 },  // Coconut Milk 400ml cartons (custom price)
      { ...PRODUCTS[19], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },   // Thai Red Curry Paste cartons
    ],
    total: 5 * (4.50 * 12 * 0.95) + 3 * (4.00 * 6 * 0.95),
    notes: 'Urgent — event this weekend',
    verification: { method: 'signature', signatureDataUrl: DEMO_SIGNATURE, timestamp: d(1, 9) } as OrderVerification,
  },
  {
    id: 'ORD-1002', hoReCa: HORECAS[3], submittedBy: USERS[2], orderDate: d(2, 14), status: 'processed' as OrderStatus,
    statusHistory: mkHistory('processed', d(2, 14)),
    deliveryDate: '2026-04-01', deliveryTimeSlot: 'Afternoon (12pm-4pm)' as DeliveryTimeSlot,
    items: [
      { ...PRODUCTS[56], quantity: 4, price: 3.00 },  // Light Soy Sauce
      { ...PRODUCTS[63], quantity: 6, price: 3.50 },  // Sweet Chilli Sauce
      { ...PRODUCTS[19], quantity: 2, price: 4.00 },  // Thai Red Curry Paste
    ],
    total: 4 * 3.00 + 6 * 3.50 + 2 * 4.00,
    verification: { method: 'call_reference', callerName: 'Mei Lin', callDate: '2026-03-29', callTime: '14:30', referenceNumber: 'CR-20260329-001', timestamp: d(2, 14) } as OrderVerification,
  },
  {
    id: 'ORD-1003', hoReCa: HORECAS[4], submittedBy: USERS[2], orderDate: d(3, 11), status: 'packed' as OrderStatus,
    statusHistory: mkHistory('packed', d(3, 11)),
    deliveryDate: '2026-03-30', deliveryTimeSlot: 'Morning (8am-12pm)' as DeliveryTimeSlot,
    items: [
      { ...PRODUCTS[0], quantity: 10, packSize: 12, price: 2.50 * 12 * 0.95 }, // Coconut Milk 140ml cartons
      { ...PRODUCTS[20], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },  // Thai Green Curry
      { ...PRODUCTS[97], quantity: 4, price: 4.00 },                           // Satay Sauce
    ],
    total: 10 * (2.50 * 12 * 0.95) + 3 * (4.00 * 6 * 0.95) + 4 * 4.00,
    verification: { method: 'signature', signatureDataUrl: DEMO_SIGNATURE, timestamp: d(3, 11) } as OrderVerification,
  },
  {
    id: 'ORD-1004', hoReCa: HORECAS[1], submittedBy: USERS[2], orderDate: d(4, 16), status: 'dispatched' as OrderStatus,
    statusHistory: mkHistory('dispatched', d(4, 16)),
    deliveryDate: '2026-03-28', deliveryTimeSlot: 'Evening (4pm-8pm)' as DeliveryTimeSlot,
    items: [
      { ...PRODUCTS[79], quantity: 5, packSize: 12, price: 3.50 * 12 * 0.95 }, // Rice Noodles cartons
      { ...PRODUCTS[41], quantity: 3, packSize: 6, price: 3.50 * 6 * 0.95 },  // Fish Sauce cartons
    ],
    total: 5 * (3.50 * 12 * 0.95) + 3 * (3.50 * 6 * 0.95),
    notes: 'Leave with reception if kitchen closed',
    verification: { method: 'call_reference', callerName: 'David Lee', callDate: '2026-03-27', callTime: '16:15', timestamp: d(4, 16) } as OrderVerification,
  },
  // --- Mid-range orders (7-21 days ago) ---
  {
    id: 'ORD-1005', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(8, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(8, 10)),
    items: [
      { ...PRODUCTS[2], quantity: 3, packSize: 12, price: 4.50 * 12 * 0.95 },
      { ...PRODUCTS[7], quantity: 2, packSize: 12, price: 5.00 * 12 * 0.95 },  // Coconut Cream 400ml
      { ...PRODUCTS[63], quantity: 8, price: 3.50 },
    ],
    total: 3 * (4.50 * 12 * 0.95) + 2 * (5.00 * 12 * 0.95) + 8 * 3.50,
    verification: { method: 'signature', signatureDataUrl: DEMO_SIGNATURE, timestamp: d(8, 10) } as OrderVerification,
  },
  {
    id: 'ORD-1006', hoReCa: HORECAS[5], submittedBy: USERS[2], orderDate: d(10, 9), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(10, 9)),
    items: [
      { ...PRODUCTS[0], quantity: 6, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[29], quantity: 2, price: 4.50 },  // Thai Chilli Jam
      { ...PRODUCTS[56], quantity: 5, price: 3.00 },
    ],
    total: 6 * (2.50 * 12 * 0.95) + 2 * 4.50 + 5 * 3.00,
  },
  {
    id: 'ORD-1007', hoReCa: HORECAS[3], submittedBy: USERS[2], orderDate: d(12, 15), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(12, 15)),
    items: [
      { ...PRODUCTS[22], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },  // Thai Yellow Curry
      { ...PRODUCTS[41], quantity: 2, packSize: 6, price: 3.50 * 6 * 0.95 },  // Fish Sauce
      { ...PRODUCTS[108], quantity: 4, price: 3.50 },  // White Pearl Barley
    ],
    total: 3 * (4.00 * 6 * 0.95) + 2 * (3.50 * 6 * 0.95) + 4 * 3.50,
  },
  {
    id: 'ORD-1008', hoReCa: HORECAS[4], submittedBy: USERS[2], orderDate: d(14, 11), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(14, 11)),
    items: [
      { ...PRODUCTS[13], quantity: 4, packSize: 6, price: 4.90 * 6 * 0.95 },  // Organic Coconut Milk
      { ...PRODUCTS[26], quantity: 2, price: 4.00 },   // Rendang Paste
      { ...PRODUCTS[97], quantity: 6, price: 4.00 },   // Satay Sauce
    ],
    total: 4 * (4.90 * 6 * 0.95) + 2 * 4.00 + 6 * 4.00,
  },
  {
    id: 'ORD-1009', hoReCa: HORECAS[1], submittedBy: USERS[2], orderDate: d(15, 13), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(15, 13)),
    items: [
      { ...PRODUCTS[2], quantity: 4, price: 4.90 },
      { ...PRODUCTS[30], quantity: 3, price: 4.50 },   // Thai Chilli Jam
      { ...PRODUCTS[79], quantity: 2, packSize: 12, price: 3.50 * 12 * 0.95 },
    ],
    total: 4 * 4.90 + 3 * 4.50 + 2 * (3.50 * 12 * 0.95),
  },
  {
    id: 'ORD-1010', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(18, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(18, 10)),
    items: [
      { ...PRODUCTS[2], quantity: 4, packSize: 12, price: 4.50 * 12 * 0.95 },
      { ...PRODUCTS[19], quantity: 2, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[56], quantity: 6, price: 3.00 },
    ],
    total: 4 * (4.50 * 12 * 0.95) + 2 * (4.00 * 6 * 0.95) + 6 * 3.00,
  },
  // --- Older orders (21-45 days ago) ---
  {
    id: 'ORD-1011', hoReCa: HORECAS[5], submittedBy: USERS[2], orderDate: d(22, 14), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(22, 14)),
    items: [
      { ...PRODUCTS[0], quantity: 8, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[63], quantity: 4, price: 3.50 },
    ],
    total: 8 * (2.50 * 12 * 0.95) + 4 * 3.50,
  },
  {
    id: 'ORD-1012', hoReCa: HORECAS[3], submittedBy: USERS[2], orderDate: d(25, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(25, 10)),
    items: [
      { ...PRODUCTS[20], quantity: 5, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[26], quantity: 3, price: 4.00 },
      { ...PRODUCTS[56], quantity: 4, price: 3.00 },
    ],
    total: 5 * (4.00 * 6 * 0.95) + 3 * 4.00 + 4 * 3.00,
  },
  {
    id: 'ORD-1013', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(28, 9), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(28, 9)),
    items: [
      { ...PRODUCTS[7], quantity: 3, packSize: 12, price: 5.00 * 12 * 0.95 },
      { ...PRODUCTS[13], quantity: 2, packSize: 6, price: 4.90 * 6 * 0.95 },
    ],
    total: 3 * (5.00 * 12 * 0.95) + 2 * (4.90 * 6 * 0.95),
  },
  {
    id: 'ORD-1014', hoReCa: HORECAS[4], submittedBy: USERS[2], orderDate: d(30, 11), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(30, 11)),
    items: [
      { ...PRODUCTS[97], quantity: 8, price: 4.00 },
      { ...PRODUCTS[22], quantity: 4, packSize: 6, price: 4.00 * 6 * 0.95 },
    ],
    total: 8 * 4.00 + 4 * (4.00 * 6 * 0.95),
  },
  {
    id: 'ORD-1015', hoReCa: HORECAS[1], submittedBy: USERS[2], orderDate: d(35, 15), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(35, 15)),
    items: [
      { ...PRODUCTS[79], quantity: 3, packSize: 12, price: 3.50 * 12 * 0.95 },
      { ...PRODUCTS[41], quantity: 2, packSize: 6, price: 3.50 * 6 * 0.95 },
      { ...PRODUCTS[29], quantity: 5, price: 4.50 },
    ],
    total: 3 * (3.50 * 12 * 0.95) + 2 * (3.50 * 6 * 0.95) + 5 * 4.50,
  },
  {
    id: 'ORD-1016', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(38, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(38, 10)),
    items: [
      { ...PRODUCTS[2], quantity: 6, packSize: 12, price: 4.50 * 12 * 0.95 },
      { ...PRODUCTS[19], quantity: 4, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[63], quantity: 10, price: 3.50 },
    ],
    total: 6 * (4.50 * 12 * 0.95) + 4 * (4.00 * 6 * 0.95) + 10 * 3.50,
  },
  {
    id: 'ORD-1017', hoReCa: HORECAS[3], submittedBy: USERS[2], orderDate: d(40, 14), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(40, 14)),
    items: [
      { ...PRODUCTS[0], quantity: 12, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[56], quantity: 6, price: 3.00 },
    ],
    total: 12 * (2.50 * 12 * 0.95) + 6 * 3.00,
  },
  // Mountain Retreat Inn — hasn't ordered in 40+ days (at risk)
  {
    id: 'ORD-1018', hoReCa: HORECAS[2], submittedBy: USERS[2], orderDate: d(42, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(42, 10)),
    items: [
      { ...PRODUCTS[2], quantity: 2, price: 4.90 },
      { ...PRODUCTS[7], quantity: 2, price: 5.00 },
      { ...PRODUCTS[22], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[108], quantity: 6, price: 3.50 },
    ],
    total: 2 * 4.90 + 2 * 5.00 + 3 * (4.00 * 6 * 0.95) + 6 * 3.50,
    notes: 'Deliver to back entrance',
  },

  // --- Extended history (45-100 days ago) for buying pattern analytics ---

  // Grand Hotel — consistent ~10-day frequency (high_value, stable)
  {
    id: 'ORD-1019', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(48, 11), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(48, 11)),
    items: [
      { ...PRODUCTS[2], quantity: 5, packSize: 12, price: 4.50 * 12 * 0.95 },
      { ...PRODUCTS[19], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[7], quantity: 2, packSize: 12, price: 5.00 * 12 * 0.95 },
    ],
    total: 5 * (4.50 * 12 * 0.95) + 3 * (4.00 * 6 * 0.95) + 2 * (5.00 * 12 * 0.95),
  },
  {
    id: 'ORD-1020', hoReCa: HORECAS[0], submittedBy: USERS[2], orderDate: d(58, 9), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(58, 9)),
    items: [
      { ...PRODUCTS[2], quantity: 4, packSize: 12, price: 4.50 * 12 * 0.95 },
      { ...PRODUCTS[63], quantity: 6, price: 3.50 },
      { ...PRODUCTS[56], quantity: 4, price: 3.00 },
    ],
    total: 4 * (4.50 * 12 * 0.95) + 6 * 3.50 + 4 * 3.00,
  },

  // Seaside Bistro — ~15-20 day frequency (stable)
  {
    id: 'ORD-1021', hoReCa: HORECAS[1], submittedBy: USERS[2], orderDate: d(50, 14), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(50, 14)),
    items: [
      { ...PRODUCTS[79], quantity: 4, packSize: 12, price: 3.50 * 12 * 0.95 },
      { ...PRODUCTS[41], quantity: 3, packSize: 6, price: 3.50 * 6 * 0.95 },
    ],
    total: 4 * (3.50 * 12 * 0.95) + 3 * (3.50 * 6 * 0.95),
  },
  {
    id: 'ORD-1022', hoReCa: HORECAS[1], submittedBy: USERS[2], orderDate: d(68, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(68, 10)),
    items: [
      { ...PRODUCTS[2], quantity: 3, price: 4.90 },
      { ...PRODUCTS[79], quantity: 3, packSize: 12, price: 3.50 * 12 * 0.95 },
      { ...PRODUCTS[29], quantity: 4, price: 4.50 },
    ],
    total: 3 * 4.90 + 3 * (3.50 * 12 * 0.95) + 4 * 4.50,
  },
  {
    id: 'ORD-1023', hoReCa: HORECAS[1], submittedBy: USERS[2], orderDate: d(85, 15), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(85, 15)),
    items: [
      { ...PRODUCTS[41], quantity: 4, packSize: 6, price: 3.50 * 6 * 0.95 },
      { ...PRODUCTS[56], quantity: 3, price: 3.00 },
    ],
    total: 4 * (3.50 * 6 * 0.95) + 3 * 3.00,
  },

  // Mountain Retreat Inn — older orders to establish history, then long gap = at_risk
  {
    id: 'ORD-1024', hoReCa: HORECAS[2], submittedBy: USERS[2], orderDate: d(60, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(60, 10)),
    items: [
      { ...PRODUCTS[7], quantity: 3, price: 5.00 },
      { ...PRODUCTS[22], quantity: 2, packSize: 6, price: 4.00 * 6 * 0.95 },
    ],
    total: 3 * 5.00 + 2 * (4.00 * 6 * 0.95),
  },
  {
    id: 'ORD-1025', hoReCa: HORECAS[2], submittedBy: USERS[2], orderDate: d(75, 11), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(75, 11)),
    items: [
      { ...PRODUCTS[2], quantity: 3, price: 4.90 },
      { ...PRODUCTS[108], quantity: 4, price: 3.50 },
      { ...PRODUCTS[20], quantity: 2, packSize: 6, price: 4.00 * 6 * 0.95 },
    ],
    total: 3 * 4.90 + 4 * 3.50 + 2 * (4.00 * 6 * 0.95),
  },
  {
    id: 'ORD-1026', hoReCa: HORECAS[2], submittedBy: USERS[2], orderDate: d(90, 9), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(90, 9)),
    items: [
      { ...PRODUCTS[7], quantity: 2, price: 5.00 },
      { ...PRODUCTS[13], quantity: 3, packSize: 6, price: 4.90 * 6 * 0.95 },
    ],
    total: 2 * 5.00 + 3 * (4.90 * 6 * 0.95),
  },

  // Lotus Garden — accelerating frequency (growing)
  {
    id: 'ORD-1027', hoReCa: HORECAS[3], submittedBy: USERS[2], orderDate: d(55, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(55, 10)),
    items: [
      { ...PRODUCTS[56], quantity: 8, price: 3.00 },
      { ...PRODUCTS[19], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[63], quantity: 5, price: 3.50 },
    ],
    total: 8 * 3.00 + 3 * (4.00 * 6 * 0.95) + 5 * 3.50,
  },
  {
    id: 'ORD-1028', hoReCa: HORECAS[3], submittedBy: USERS[2], orderDate: d(75, 14), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(75, 14)),
    items: [
      { ...PRODUCTS[0], quantity: 6, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[41], quantity: 2, packSize: 6, price: 3.50 * 6 * 0.95 },
    ],
    total: 6 * (2.50 * 12 * 0.95) + 2 * (3.50 * 6 * 0.95),
  },

  // The Spice Room — shrinking basket sizes (declining)
  {
    id: 'ORD-1029', hoReCa: HORECAS[4], submittedBy: USERS[2], orderDate: d(50, 11), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(50, 11)),
    items: [
      { ...PRODUCTS[0], quantity: 8, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[20], quantity: 4, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[97], quantity: 10, price: 4.00 },
      { ...PRODUCTS[26], quantity: 5, price: 4.00 },
    ],
    total: 8 * (2.50 * 12 * 0.95) + 4 * (4.00 * 6 * 0.95) + 10 * 4.00 + 5 * 4.00,
  },
  {
    id: 'ORD-1030', hoReCa: HORECAS[4], submittedBy: USERS[2], orderDate: d(70, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(70, 10)),
    items: [
      { ...PRODUCTS[13], quantity: 6, packSize: 6, price: 4.90 * 6 * 0.95 },
      { ...PRODUCTS[97], quantity: 12, price: 4.00 },
      { ...PRODUCTS[22], quantity: 5, packSize: 6, price: 4.00 * 6 * 0.95 },
      { ...PRODUCTS[20], quantity: 3, packSize: 6, price: 4.00 * 6 * 0.95 },
    ],
    total: 6 * (4.90 * 6 * 0.95) + 12 * 4.00 + 5 * (4.00 * 6 * 0.95) + 3 * (4.00 * 6 * 0.95),
  },
  {
    id: 'ORD-1031', hoReCa: HORECAS[4], submittedBy: USERS[2], orderDate: d(90, 9), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(90, 9)),
    items: [
      { ...PRODUCTS[0], quantity: 12, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[97], quantity: 15, price: 4.00 },
      { ...PRODUCTS[26], quantity: 6, price: 4.00 },
      { ...PRODUCTS[22], quantity: 6, packSize: 6, price: 4.00 * 6 * 0.95 },
    ],
    total: 12 * (2.50 * 12 * 0.95) + 15 * 4.00 + 6 * 4.00 + 6 * (4.00 * 6 * 0.95),
  },

  // Harbour View Café — third order to have borderline "new" with 3 total orders
  {
    id: 'ORD-1032', hoReCa: HORECAS[5], submittedBy: USERS[2], orderDate: d(45, 10), status: 'delivered' as OrderStatus,
    statusHistory: mkHistory('delivered', d(45, 10)),
    items: [
      { ...PRODUCTS[0], quantity: 5, packSize: 12, price: 2.50 * 12 * 0.95 },
      { ...PRODUCTS[56], quantity: 4, price: 3.00 },
      { ...PRODUCTS[29], quantity: 3, price: 4.50 },
    ],
    total: 5 * (2.50 * 12 * 0.95) + 4 * 3.00 + 3 * 4.50,
  },
];

export const ALL_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'PO-2001',
    supplier: SUPPLIERS[0],
    items: [
      { productId: 3, productName: 'Coconut Milk 400ml', quantity: 100, cost: 3.20 },
      { productId: 20, productName: 'Thai Red Curry Paste 195g', quantity: 60, cost: 2.80 },
    ],
    total: 100 * 3.20 + 60 * 2.80,
    orderDate: d(20, 9),
    status: 'Completed' as import('../../types').PurchaseOrderStatus,
    submittedBy: USERS[0],
  },
  {
    id: 'PO-2002',
    supplier: SUPPLIERS[1],
    items: [
      { productId: 80, productName: 'Rice Noodles 200g', quantity: 80, cost: 2.00 },
      { productId: 112, productName: 'Sweet Corn Kernel 425g', quantity: 50, cost: 1.20 },
    ],
    total: 80 * 2.00 + 50 * 1.20,
    orderDate: d(15, 11),
    status: 'Submitted' as import('../../types').PurchaseOrderStatus,
    submittedBy: USERS[0],
  },
  {
    id: 'PO-2003',
    supplier: SUPPLIERS[2],
    items: [
      { productId: 14, productName: 'Organic Coconut Milk 400ml', quantity: 40, cost: 3.50 },
      { productId: 18, productName: 'Organic Virgin Coconut Oil 300ml', quantity: 20, cost: 9.00 },
    ],
    total: 40 * 3.50 + 20 * 9.00,
    orderDate: d(5, 14),
    status: 'Pending' as import('../../types').PurchaseOrderStatus,
    submittedBy: USERS[0],
  },
];

export const INITIAL_PANTRY_LISTS: PantryLists = {
  // The Grand Hotel
  1: [
    { productId: 3, preferredPackSize: 12, defaultQuantity: 3 },
    { productId: 20, preferredPackSize: 6, defaultQuantity: 2 },
    { productId: 57, preferredPackSize: 6, defaultQuantity: 2 },
    { productId: 64, preferredPackSize: undefined, defaultQuantity: 4 },
  ],
  // Seaside Bistro
  2: [
    { productId: 80, preferredPackSize: 12, defaultQuantity: 2 },
    { productId: 42, preferredPackSize: 6, defaultQuantity: 3 },
    { productId: 98, preferredPackSize: undefined, defaultQuantity: 5 },
  ],
  // Lotus Garden Restaurant
  4: [
    { productId: 21, preferredPackSize: 6, defaultQuantity: 3 },
    { productId: 57, preferredPackSize: undefined, defaultQuantity: 4 },
    { productId: 27, preferredPackSize: 6, defaultQuantity: 2 },
  ],
  // Mountain Retreat Inn
  3: [
    { productId: 3, preferredPackSize: 12, defaultQuantity: 2 },
    { productId: 22, preferredPackSize: 6, defaultQuantity: 3 },
    { productId: 109, preferredPackSize: undefined, defaultQuantity: 4 },
  ],
  // The Spice Room
  5: [
    { productId: 14, preferredPackSize: 6, defaultQuantity: 4 },
    { productId: 98, preferredPackSize: undefined, defaultQuantity: 6 },
    { productId: 23, preferredPackSize: 6, defaultQuantity: 2 },
  ],
  // Harbour View Café
  6: [
    { productId: 1, preferredPackSize: 12, defaultQuantity: 5 },
    { productId: 57, preferredPackSize: 6, defaultQuantity: 3 },
  ],
};

// Mock invoices simulating data from external accounting system
// Due dates spread across aging buckets relative to March 31 2026
export const INITIAL_INVOICES: Invoice[] = [
  // The Grand Hotel — has a 90+ day overdue invoice (BLOCKED)
  { id: 'INV-3001', orderId: 'ORD-1016', hoReCaId: 1, hoReCaName: 'The Grand Hotel', amount: 489.40, dueDate: '2025-12-15', status: 'overdue', createdDate: '2025-11-15' },  // ~106 days past due → 90+
  { id: 'INV-3002', orderId: 'ORD-1013', hoReCaId: 1, hoReCaName: 'The Grand Hotel', amount: 226.86, dueDate: '2026-02-01', status: 'overdue', createdDate: '2026-01-02' },  // ~58 days past due → 60
  { id: 'INV-3003', orderId: 'ORD-1010', hoReCaId: 1, hoReCaName: 'The Grand Hotel', amount: 267.48, dueDate: '2026-03-15', status: 'pending', createdDate: '2026-02-13' },  // ~16 days past due → Current
  { id: 'INV-3004', orderId: 'ORD-1005', hoReCaId: 1, hoReCaName: 'The Grand Hotel', amount: 295.90, dueDate: '2026-03-25', status: 'pending', createdDate: '2026-02-23' },  // ~6 days past due → Current

  // Seaside Bistro — 60 day overdue (not blocked)
  { id: 'INV-3005', orderId: 'ORD-1015', hoReCaId: 2, hoReCaName: 'Seaside Bistro', amount: 175.35, dueDate: '2026-01-28', status: 'overdue', createdDate: '2025-12-29' },  // ~62 days past due → 60
  { id: 'INV-3006', orderId: 'ORD-1009', hoReCaId: 2, hoReCaName: 'Seaside Bistro', amount: 112.90, dueDate: '2026-03-18', status: 'pending', createdDate: '2026-02-16' },  // ~13 days past due → Current

  // Mountain Retreat Inn — 30 day overdue
  { id: 'INV-3007', orderId: 'ORD-1018', hoReCaId: 3, hoReCaName: 'Mountain Retreat Inn', amount: 107.60, dueDate: '2026-02-20', status: 'overdue', createdDate: '2026-01-21' },  // ~39 days past due → 30

  // Lotus Garden — current only
  { id: 'INV-3008', orderId: 'ORD-1012', hoReCaId: 4, hoReCaName: 'Lotus Garden Restaurant', amount: 140.00, dueDate: '2026-03-28', status: 'pending', createdDate: '2026-02-26' },  // ~3 days past due → Current

  // The Spice Room — paid up (one still pending, current)
  { id: 'INV-3009', orderId: 'ORD-1014', hoReCaId: 5, hoReCaName: 'The Spice Room', amount: 123.20, dueDate: '2026-03-05', status: 'paid', paidDate: '2026-03-04', createdDate: '2026-02-03' },
  { id: 'INV-3010', orderId: 'ORD-1008', hoReCaId: 5, hoReCaName: 'The Spice Room', amount: 143.72, dueDate: '2026-03-20', status: 'pending', createdDate: '2026-02-18' },  // ~11 days past due → Current

  // Harbour View Café — clean (paid)
  { id: 'INV-3011', orderId: 'ORD-1011', hoReCaId: 6, hoReCaName: 'Harbour View Café', amount: 242.00, dueDate: '2026-03-10', status: 'paid', paidDate: '2026-03-09', createdDate: '2026-02-08' },
];
