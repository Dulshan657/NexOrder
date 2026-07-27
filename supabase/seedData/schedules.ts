// Demo seed: sales targets, promotions, routes and visits.
//
// Split out of constants.ts so this never reaches the browser bundle. Only
// supabase/seed.ts imports it. See supabase/seedData/index.ts.
import type { SalesTarget, Promotion, ScheduledVisit, Visit } from '../../types';

export const INITIAL_SALES_TARGETS: SalesTarget[] = [
  // Charlie Brown (Field Sales Rep, id: 3)
  { id: 'TGT-001', userId: 3, type: 'revenue',       targetValue: 50000, startDate: '2026-04-01', endDate: '2026-04-30', createdAt: '2026-03-28T09:00:00Z' },
  { id: 'TGT-002', userId: 3, type: 'orders',         targetValue: 30,    startDate: '2026-04-01', endDate: '2026-04-30', createdAt: '2026-03-28T09:00:00Z' },
  { id: 'TGT-003', userId: 3, type: 'new_horecas',  targetValue: 5,     startDate: '2026-04-01', endDate: '2026-04-30', createdAt: '2026-03-28T09:00:00Z' },
  // Emma Chen (Office Sales Rep, id: 5)
  { id: 'TGT-004', userId: 5, type: 'revenue',       targetValue: 35000, startDate: '2026-04-01', endDate: '2026-04-30', createdAt: '2026-03-28T10:00:00Z' },
  { id: 'TGT-005', userId: 5, type: 'orders',         targetValue: 25,    startDate: '2026-04-01', endDate: '2026-04-30', createdAt: '2026-03-28T10:00:00Z' },
  { id: 'TGT-006', userId: 5, type: 'new_horecas',  targetValue: 3,     startDate: '2026-04-01', endDate: '2026-04-30', createdAt: '2026-03-28T10:00:00Z' },
  // Bob Williams (Manager, id: 2)
  { id: 'TGT-007', userId: 2, type: 'revenue',       targetValue: 100000, startDate: '2026-04-01', endDate: '2026-06-30', createdAt: '2026-03-28T11:00:00Z' },
  { id: 'TGT-008', userId: 2, type: 'orders',         targetValue: 80,     startDate: '2026-04-01', endDate: '2026-06-30', createdAt: '2026-03-28T11:00:00Z' },
  // Alice Johnson (Admin, id: 1)
  { id: 'TGT-009', userId: 1, type: 'revenue',       targetValue: 200000, startDate: '2026-04-01', endDate: '2026-06-30', createdAt: '2026-03-28T12:00:00Z' },
];

export const INITIAL_PROMOTIONS: Promotion[] = [
  {
    id: 'PROMO-001', name: 'Coconut Season Sale', description: '15% off all Coconut products this April',
    type: 'percentage', percentOff: 15,
    scope: { kind: 'categories', categories: ['Coconut'] },
    targeting: { kind: 'all' },
    stackWithHoReCaPricing: true,
    startDate: '2026-04-01', endDate: '2026-04-30',
    isActive: true, createdAt: '2026-03-25T09:00:00Z', createdBy: 1, priority: 10,
  },
  {
    id: 'PROMO-002', name: 'Exclusive Laksa Deal', description: 'Gold-tier hoReCas get Laksa Curry Paste at $3.00',
    type: 'fixed_price', fixedPrice: 3.00,
    scope: { kind: 'products', productIds: [27] },
    targeting: { kind: 'tier', tiers: ['Gold'] },
    stackWithHoReCaPricing: false,
    isActive: true, createdAt: '2026-03-25T10:00:00Z', createdBy: 1, priority: 5,
  },
  {
    id: 'PROMO-003', name: 'Buy 2 Get 1 Red Curry', description: 'Buy 2 Thai Red Curry Paste, get 1 free!',
    type: 'bogo', bogoConfig: { buyProductId: 20, buyQuantity: 2, getProductId: 20, getQuantity: 1 },
    scope: { kind: 'products', productIds: [20] },
    targeting: { kind: 'all' },
    stackWithHoReCaPricing: true,
    startDate: '2026-04-01', endDate: '2026-05-31',
    isActive: true, createdAt: '2026-03-25T11:00:00Z', createdBy: 1, priority: 10,
  },
  {
    id: 'PROMO-004', name: 'Asian Sauce Starter Pack', description: 'Get Oyster Sauce, Fish Sauce & Soy Sauce together for $9.50',
    type: 'bundle', bundleConfig: { productIds: [39, 42, 57], bundlePrice: 9.50 },
    scope: { kind: 'products', productIds: [39, 42, 57] },
    targeting: { kind: 'all' },
    stackWithHoReCaPricing: true,
    isActive: true, createdAt: '2026-03-25T12:00:00Z', createdBy: 1, priority: 10,
  },
  {
    id: 'PROMO-005', name: 'XO Sauce Clearance', description: '40% off XO Sauce — while stocks last!',
    type: 'clearance', clearancePercent: 40,
    scope: { kind: 'products', productIds: [51] },
    targeting: { kind: 'all' },
    stackWithHoReCaPricing: false,
    isActive: true, createdAt: '2026-03-25T13:00:00Z', createdBy: 1, priority: 1,
  },
  {
    id: 'PROMO-006', name: 'Grand Hotel VIP', description: 'Exclusive 10% storewide discount for The Grand Hotel',
    type: 'percentage', percentOff: 10,
    scope: { kind: 'storewide' },
    targeting: { kind: 'horecas', hoReCaIds: [1] },
    stackWithHoReCaPricing: false,
    isActive: true, createdAt: '2026-03-25T14:00:00Z', createdBy: 1, priority: 20,
  },
];

// Helper for route/visit dates relative to "today"
const routeDate = (daysOffset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().slice(0, 10);
};

const visitTime = (daysAgo: number, hour: number, minute: number = 0): string => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

export const INITIAL_ROUTES: ScheduledVisit[] = [
  {
    id: 'ROUTE-001',
    name: 'Sydney CBD Run',
    date: routeDate(0),
    stops: [
      { hoReCaId: 1, sequence: 1, status: 'pending', plannedArrival: '09:00' },
      { hoReCaId: 4, sequence: 2, status: 'pending', plannedArrival: '10:30' },
      { hoReCaId: 6, sequence: 3, status: 'pending', plannedArrival: '12:00' },
    ],
    status: 'planned',
    createdBy: 3,
    createdAt: visitTime(1, 17),
  },
  {
    id: 'ROUTE-002',
    name: 'Sydney West Tour',
    date: routeDate(-1),
    stops: [
      { hoReCaId: 1, sequence: 1, status: 'arrived', visitId: 'VISIT-001', plannedArrival: '09:00' },
      { hoReCaId: 3, sequence: 2, status: 'arrived', visitId: 'VISIT-002', plannedArrival: '11:30' },
    ],
    status: 'completed',
    createdBy: 3,
    createdAt: visitTime(2, 16),
    completedAt: visitTime(1, 14),
  },
  {
    id: 'ROUTE-003',
    name: 'Melbourne Visit',
    date: routeDate(3),
    stops: [
      { hoReCaId: 5, sequence: 1, status: 'pending', plannedArrival: '10:00' },
    ],
    status: 'planned',
    createdBy: 5,
    createdAt: visitTime(0, 9),
  },
  // Assigned routes (Bob -> Charlie)
  {
    id: 'ROUTE-A01',
    name: 'CBD Priority Visits',
    date: routeDate(0),
    stops: [
      { hoReCaId: 1, sequence: 1, status: 'arrived', visitId: 'VISIT-003', plannedArrival: '09:00' },
      { hoReCaId: 3, sequence: 2, status: 'pending', plannedArrival: '10:30' },
      { hoReCaId: 6, sequence: 3, status: 'pending', plannedArrival: '12:00' },
    ],
    status: 'in_progress',
    createdBy: 2,
    createdAt: visitTime(1, 8),
    assignedTo: 3,
    assignedBy: 2,
    assignedAt: visitTime(1, 8),
  },
  {
    id: 'ROUTE-A02',
    name: 'Inner West Restaurants',
    date: routeDate(1),
    stops: [
      { hoReCaId: 2, sequence: 1, status: 'pending', plannedArrival: '09:30' },
      { hoReCaId: 4, sequence: 2, status: 'pending', plannedArrival: '11:00' },
      { hoReCaId: 5, sequence: 3, status: 'pending', plannedArrival: '13:00' },
    ],
    status: 'planned',
    createdBy: 2,
    createdAt: visitTime(0, 9),
    assignedTo: 3,
    assignedBy: 2,
    assignedAt: visitTime(0, 9),
    changeRequests: [
      {
        id: 'CR-001',
        scheduledVisitId: 'ROUTE-A02',
        requestedBy: 3,
        requestedAt: visitTime(0, 10),
        type: 'reorder',
        status: 'pending',
        description: 'Swap stops 1 and 2 — Golden Dragon is closer to my starting point',
        payload: { newStopOrder: [4, 2, 5] },
      },
    ],
  },
  // ScheduledVisit template
  {
    id: 'TMPL-001',
    name: 'Weekly Sydney CBD',
    date: '',
    stops: [
      { hoReCaId: 1, sequence: 1, status: 'pending' },
      { hoReCaId: 4, sequence: 2, status: 'pending' },
      { hoReCaId: 6, sequence: 3, status: 'pending' },
    ],
    status: 'planned',
    createdBy: 2,
    createdAt: visitTime(7, 9),
    assignedTo: 3,
    assignedBy: 2,
    isTemplate: true,
    recurrence: { frequency: 'weekly', dayOfWeek: 1 },
  },
];

export const INITIAL_VISITS: Visit[] = [
  // Linked to ROUTE-002 (completed yesterday)
  {
    id: 'VISIT-001',
    hoReCaId: 1,
    userId: 3,
    scheduledVisitId: 'ROUTE-002',
    arrivalTime: visitTime(1, 9, 15),
    departureTime: visitTime(1, 10, 30),
    outcome: 'order_placed',
    notes: 'Spoke with head chef about new coconut products. Placed large order for weekend event.',
    competitorNotes: 'Noticed competitor brand soy sauce on shelf — pricing appears lower.',
    stockCheckNotes: 'Running low on Thai Red Curry Paste and Coconut Milk 400ml.',
    nextVisitRecommendation: 'Follow up in 1 week about new satay range.',
    photos: [],
    createdAt: visitTime(1, 10, 30),
  },
  {
    id: 'VISIT-002',
    hoReCaId: 3,
    userId: 3,
    scheduledVisitId: 'ROUTE-002',
    arrivalTime: visitTime(1, 11, 45),
    departureTime: visitTime(1, 12, 15),
    outcome: 'follow_up_needed',
    notes: 'Manager was busy with lunch service. Left new product catalogue. Call back Thursday.',
    stockCheckNotes: 'Good stock levels on most items.',
    photos: [],
    createdAt: visitTime(1, 12, 15),
  },
  // Ad-hoc visits (no route)
  {
    id: 'VISIT-003',
    hoReCaId: 4,
    userId: 3,
    arrivalTime: visitTime(3, 14, 0),
    departureTime: visitTime(3, 14, 45),
    outcome: 'order_placed',
    notes: 'Quick drop-in. Reordered usual items plus trying new noodle range.',
    photos: [],
    createdAt: visitTime(3, 14, 45),
  },
  {
    id: 'VISIT-004',
    hoReCaId: 6,
    userId: 3,
    arrivalTime: visitTime(5, 10, 0),
    departureTime: visitTime(5, 10, 20),
    outcome: 'not_available',
    notes: 'Cafe was closed for private event. Will try again next week.',
    photos: [],
    createdAt: visitTime(5, 10, 20),
  },
  {
    id: 'VISIT-005',
    hoReCaId: 2,
    userId: 5,
    arrivalTime: visitTime(2, 11, 0),
    departureTime: visitTime(2, 11, 30),
    outcome: 'stock_check_only',
    notes: 'Phone call check-in. Reviewed current stock levels.',
    stockCheckNotes: 'Fish sauce and rice noodles need reorder within 2 weeks.',
    nextVisitRecommendation: 'Schedule order call for next Monday.',
    photos: [],
    createdAt: visitTime(2, 11, 30),
  },
];
