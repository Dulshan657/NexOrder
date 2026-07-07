// Nex Order — product catalog and mock data for the application.
import type { Product, HoReCa, User, Category, Supplier, Order, PurchaseOrder, PantryLists, AppSettings, OrderStatus, DeliveryTimeSlot, Invoice, OrderVerification, SalesTarget, Promotion, ScheduledVisit, Visit, ScheduledVisitChangeRequest } from './types';
import { UserRole } from './types';

export const USERS: User[] = [
  { id: 1, name: 'Alice Johnson', email: 'alice@nexorder.com.au', role: UserRole.ADMIN, avatarUrl: 'https://i.pravatar.cc/150?u=1' },
  { id: 2, name: 'Bob Williams', email: 'bob@nexorder.com.au', role: UserRole.MANAGER, avatarUrl: 'https://i.pravatar.cc/150?u=2' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@nexorder.com.au', role: UserRole.FIELD_REP, avatarUrl: 'https://i.pravatar.cc/150?u=3' },
  { id: 4, name: 'David Lee', email: 'david@seasidebistro.com', role: UserRole.CUSTOMER, avatarUrl: 'https://i.pravatar.cc/150?u=4', hoReCaId: 2 },
  { id: 5, name: 'Emma Chen', email: 'emma@nexorder.com.au', role: UserRole.OFFICE_REP, avatarUrl: 'https://i.pravatar.cc/150?u=5' },
  { id: 6, name: 'Mei Lin', email: 'mei@lotusgarden.com.au', role: UserRole.CUSTOMER, avatarUrl: 'https://i.pravatar.cc/150?u=6', hoReCaId: 4 },
];

export const CATEGORIES: readonly Category[] = [
  'Plant-Based', 'Coconut', 'Meal Pastes', 'Asian Sauces', 'Soy Sauces', 'Chilli Sauces',
  'Condiments', 'Noodles', 'Fish', 'Satay Sauces', 'Desserts',
  'Ready Meal Sauces', 'Other'
];

export const SUPPLIERS: Supplier[] = [
  { id: 1, name: 'AYAM Brand Malaysia', contactPerson: 'Ahmad Razak', email: 'sales@ayam.com.my', phone: '+60-3-7785-1234' },
  { id: 2, name: 'AYAM Australia Distribution', contactPerson: 'Sarah Mitchell', email: 'distribution@ayam.com.au', phone: '+61-2-9876-5432' },
  { id: 3, name: 'AYAM Organic Supply', contactPerson: 'Lisa Chen', email: 'organic@ayam.com.au', phone: '+61-3-8765-4321' },
  // V2food — plant-based range for the V2food client demo (featured at the top of the shop).
  { id: 4, name: 'v2food', contactPerson: 'Foodservice Team', email: 'foodservice@v2food.com', phone: '+61-2-8520-0000' },
];

// V2food product photography (their live foodservice CDN).
const V2 = 'https://cdn.prod.website-files.com/67886572ee5d279b0cc8aab7';

const IMG = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_IMAGE_CDN_URL)
  || 'https://ayam.com/images/com_hikashop/upload/thumbnails/263x263f';

// Seed literals omit `available` (demo data is not allocation-aware); it
// defaults to on-hand below. Real product data comes from Supabase via the
// adapter, which sets `available` from the products.available cache (mig 00041).
const PRODUCTS_SEED: Omit<Product, 'available'>[] = [
  // ===== COCONUT (22 products) =====
  // Regular
  { id: 1, sku: 'AYM-COC-001', name: 'Coconut Milk 140ml', description: '100% natural coconut milk, perfect for curries, soups, and desserts.', price: 2.50, category: 'Coconut', inventory: 120, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9311627603729-1.png`, supplierId: 1 },
  { id: 2, sku: 'AYM-COC-002', name: 'Coconut Milk 270ml', description: '100% natural coconut milk in a convenient 270ml can.', price: 3.90, category: 'Coconut', inventory: 100, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/09311627010183_front.jpg`, supplierId: 1 },
  { id: 3, sku: 'AYM-COC-003', name: 'Coconut Milk 400ml', description: '100% natural coconut milk, crafted using naturally sweet, ripe flesh of hand-picked coconuts.', price: 4.90, category: 'Coconut', inventory: 80, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/09556041604734_a1n1.jpg`, supplierId: 1 },
  { id: 4, sku: 'AYM-COC-004', name: 'Light Coconut Milk 270ml', description: 'Lighter coconut milk with reduced fat, ideal for health-conscious cooking.', price: 3.90, category: 'Coconut', inventory: 60, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60251-1.png`, supplierId: 1 },
  { id: 5, sku: 'AYM-COC-005', name: 'Light Coconut Milk 400ml', description: 'Light coconut milk with all the flavour and less fat.', price: 4.90, category: 'Coconut', inventory: 50, unit: 'can', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041640961-1.png`, supplierId: 1 },
  { id: 6, sku: 'AYM-COC-006', name: 'Coconut Cream 140ml', description: 'Rich and thick coconut cream for curries and desserts.', price: 2.60, category: 'Coconut', inventory: 90, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9311627603767-1.png`, supplierId: 1 },
  { id: 7, sku: 'AYM-COC-007', name: 'Coconut Cream 270ml', description: 'Premium thick coconut cream, perfect for rich curries.', price: 4.00, category: 'Coconut', inventory: 70, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60457-1.png`, supplierId: 1 },
  { id: 8, sku: 'AYM-COC-008', name: 'Coconut Cream 400ml', description: 'Premium coconut cream for rich and creamy dishes.', price: 5.00, category: 'Coconut', inventory: 85, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/61442-1.jpg`, supplierId: 1 },
  { id: 9, sku: 'AYM-COC-009', name: 'Light Coconut Cream 270ml', description: 'Lighter coconut cream with reduced fat content.', price: 4.00, category: 'Coconut', inventory: 55, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60457-1.png`, supplierId: 1 },
  { id: 10, sku: 'AYM-COC-010', name: 'Light Coconut Cream 400ml', description: 'Light coconut cream, great for soups and lighter curries.', price: 5.00, category: 'Coconut', inventory: 45, unit: 'can', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60987-1.jpg`, supplierId: 1 },
  { id: 11, sku: 'AYM-COC-011', name: 'Coconut Milk Powder 150g', description: 'Convenient coconut milk in powder form, just add water.', price: 5.50, category: 'Coconut', inventory: 40, unit: 'packet', cartonSize: 8, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60218-1.jpg`, supplierId: 1 },
  { id: 12, sku: 'AYM-COC-012', name: 'Coconut Milk 200ml (Carton)', description: 'Coconut milk in a convenient carton pack.', price: 2.90, category: 'Coconut', inventory: 60, unit: 'carton', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041640992-1.png`, supplierId: 1 },
  { id: 13, sku: 'AYM-COC-013', name: 'Coconut Cream 200ml (Carton)', description: 'Rich coconut cream in a convenient carton pack.', price: 3.00, category: 'Coconut', inventory: 55, unit: 'carton', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041640992-1.png`, supplierId: 1 },
  // Organic
  { id: 14, sku: 'AYM-COC-014', name: 'Organic Coconut Milk 400ml', description: 'Certified organic coconut milk for the health-conscious cook.', price: 4.90, category: 'Coconut', inventory: 35, unit: 'can', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN', 'ORGANIC'], imageUrl: `${IMG}/61441-1.jpg`, supplierId: 3 },
  { id: 15, sku: 'AYM-COC-015', name: 'Organic Light Coconut Milk 400ml', description: 'Organic light coconut milk with reduced fat.', price: 4.90, category: 'Coconut', inventory: 30, unit: 'can', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN', 'ORGANIC'], imageUrl: `${IMG}/60997-1.jpg`, supplierId: 3 },
  { id: 16, sku: 'AYM-COC-016', name: 'Organic Coconut Cream 400ml', description: 'Rich organic coconut cream for premium dishes.', price: 5.00, category: 'Coconut', inventory: 25, unit: 'can', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN', 'ORGANIC'], imageUrl: `${IMG}/61442-1.jpg`, supplierId: 3 },
  { id: 17, sku: 'AYM-COC-017', name: 'Organic Light Coconut Cream 400ml', description: 'Light organic coconut cream, perfect for lighter dishes.', price: 5.00, category: 'Coconut', inventory: 20, unit: 'can', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN', 'ORGANIC'], imageUrl: `${IMG}/60987-1.jpg`, supplierId: 3 },
  { id: 18, sku: 'AYM-COC-018', name: 'Organic Virgin Coconut Oil 300ml', description: 'Cold-pressed organic virgin coconut oil.', price: 13.00, category: 'Coconut', inventory: 3, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN', 'ORGANIC'], imageUrl: `${IMG}/61441-1.jpg`, supplierId: 3 },
  { id: 19, sku: 'AYM-COC-019', name: 'Coconut Milk 65ml', description: 'Mini coconut milk portion, perfect for single servings.', price: 1.10, category: 'Coconut', inventory: 200, unit: 'can', cartonSize: 46, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9311627603729-1.png`, supplierId: 1 },

  // ===== MEAL PASTES (19 products) =====
  // Curry Pastes
  { id: 20, sku: 'AYM-CUR-001', name: 'Thai Red Curry Paste 195g', description: 'Authentic Thai red curry paste made with traditional spices and herbs.', price: 4.00, category: 'Meal Pastes', inventory: 75, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/60847-1-r3.jpg`, supplierId: 1 },
  { id: 21, sku: 'AYM-CUR-002', name: 'Thai Green Curry Paste 195g', description: 'Aromatic Thai green curry paste for vibrant green curries.', price: 4.00, category: 'Meal Pastes', inventory: 0, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/60848-1-r2.jpg`, supplierId: 1 },
  { id: 22, sku: 'AYM-CUR-003', name: 'Thai Yellow Curry Paste 185g', description: 'Mild and fragrant Thai yellow curry paste.', price: 4.00, category: 'Meal Pastes', inventory: 65, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/61248-1_1048543834.jpg`, supplierId: 1 },
  { id: 23, sku: 'AYM-CUR-004', name: 'Thai Massaman Curry Paste 195g', description: 'Rich and aromatic Massaman curry paste with warm spices.', price: 4.00, category: 'Meal Pastes', inventory: 55, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61268-1-r2.jpg`, supplierId: 1 },
  { id: 24, sku: 'AYM-CUR-005', name: 'Thai Panang Curry Paste 195g', description: 'Smooth and creamy Panang curry paste with peanut undertones.', price: 4.00, category: 'Meal Pastes', inventory: 50, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61341-1.png`, supplierId: 1 },
  { id: 25, sku: 'AYM-CUR-006', name: 'Malaysian Nyonya Curry Paste 185g', description: 'Traditional Nyonya-style curry paste with rich spice blend.', price: 4.00, category: 'Meal Pastes', inventory: 45, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61264-1_1396946629.jpg`, supplierId: 1 },
  { id: 26, sku: 'AYM-CUR-007', name: 'Malaysian Rendang Curry Paste 185g', description: 'Aromatic dry curry paste for authentic rendang dishes.', price: 4.00, category: 'Meal Pastes', inventory: 40, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61260-1_37133492.jpg`, supplierId: 1 },
  { id: 27, sku: 'AYM-CUR-008', name: 'Malaysian Laksa Curry Paste 185g', description: 'Spicy and fragrant laksa paste for rich noodle soups.', price: 4.00, category: 'Meal Pastes', inventory: 35, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61264-1_1396946629.jpg`, supplierId: 1 },
  { id: 28, sku: 'AYM-CUR-009', name: 'Balinese Curry Paste 185g', description: 'Fragrant Balinese curry paste with lemongrass and galangal.', price: 4.00, category: 'Meal Pastes', inventory: 30, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9556041613392-2.jpg`, supplierId: 1 },
  { id: 29, sku: 'AYM-CUR-010', name: 'Japanese Curry Paste 185g', description: 'Mild and sweet Japanese-style curry paste.', price: 4.00, category: 'Meal Pastes', inventory: 25, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61160-1.png`, supplierId: 1 },
  // Stir Fry Pastes
  { id: 30, sku: 'AYM-STF-001', name: 'Thai Chilli Jam Paste 185g', description: 'Sweet and spicy chilli jam paste for stir fries and dipping.', price: 4.50, category: 'Meal Pastes', inventory: 40, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9556041612067-1.png`, supplierId: 1 },
  { id: 31, sku: 'AYM-STF-002', name: 'Thai Pad Prik Khing Paste 185g', description: 'Aromatic paste for classic Pad Prik Khing stir fry.', price: 4.50, category: 'Meal Pastes', inventory: 35, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/61093-1.jpg`, supplierId: 1 },
  { id: 32, sku: 'AYM-STF-003', name: 'Malaysian Sambal Paste 185g', description: 'Fiery sambal paste for authentic Malaysian dishes.', price: 4.50, category: 'Meal Pastes', inventory: 30, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61373-1.png`, supplierId: 1 },
  { id: 33, sku: 'AYM-STF-004', name: 'Malaysian Sambal Shrimp Paste 185g', description: 'Traditional sambal with shrimp paste for bold flavour.', price: 4.50, category: 'Meal Pastes', inventory: 25, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/61373-1.png`, supplierId: 1 },
  { id: 34, sku: 'AYM-STF-005', name: 'Thai Basil Chilli Paste 185g', description: 'Fragrant basil and chilli paste for Thai stir fries.', price: 4.50, category: 'Meal Pastes', inventory: 20, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9556041612067-1.png`, supplierId: 1 },
  // Soup
  { id: 35, sku: 'AYM-SOU-001', name: 'Vietnamese Pho Soup Paste 185g', description: 'Authentic Vietnamese pho soup paste for rich, aromatic broth.', price: 4.50, category: 'Meal Pastes', inventory: 40, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/9556041130998-1.png`, supplierId: 1 },
  // Rice Pastes
  { id: 36, sku: 'AYM-RIC-001', name: 'Malaysian Nasi Goreng Paste 185g', description: 'Paste for authentic Malaysian fried rice.', price: 4.00, category: 'Meal Pastes', inventory: 45, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61275-1_1084451740.jpg`, supplierId: 1 },
  { id: 37, sku: 'AYM-RIC-002', name: 'Thai Fried Rice Paste 185g', description: 'Quick and easy Thai fried rice paste.', price: 5.00, category: 'Meal Pastes', inventory: 35, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/61367-01.jpg`, supplierId: 1 },
  { id: 38, sku: 'AYM-RIC-003', name: 'Singaporean Hainanese Chicken Rice Paste 185g', description: 'Paste for the famous Hainanese chicken rice.', price: 5.00, category: 'Meal Pastes', inventory: 30, unit: 'jar', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61205-01.jpg`, supplierId: 1 },

  // ===== ASIAN SAUCES (18 products) =====
  { id: 39, sku: 'AYM-SAU-001', name: 'Oyster Sauce 210ml', description: 'Rich and savoury oyster sauce for stir fries and marinades.', price: 3.90, category: 'Asian Sauces', inventory: 90, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/fc3ef1444f30e6f3242b96c7b94b5b6cc7526b33.png`, supplierId: 1 },
  { id: 40, sku: 'AYM-SAU-002', name: 'Oyster Sauce 420ml', description: 'Premium oyster sauce in a larger bottle for frequent use.', price: 5.00, category: 'Asian Sauces', inventory: 60, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/09556041200202_a1n1_2121899857.jpg`, supplierId: 1 },
  { id: 41, sku: 'AYM-SAU-003', name: 'Hoi Sin Sauce 210ml', description: 'Sweet and savoury hoi sin sauce for dipping, glazing, and stir fries.', price: 3.90, category: 'Asian Sauces', inventory: 55, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61088-1.jpg`, supplierId: 1 },
  { id: 42, sku: 'AYM-SAU-004', name: 'Fish Sauce 210ml', description: 'Traditional fish sauce, essential for Southeast Asian cooking.', price: 3.90, category: 'Asian Sauces', inventory: 80, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/61116-1.jpg`, supplierId: 1 },
  { id: 43, sku: 'AYM-SAU-005', name: 'Fish Sauce 420ml', description: 'Fish sauce in a larger bottle for commercial kitchens.', price: 5.00, category: 'Asian Sauces', inventory: 50, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/09556041614207_a1n1_1679130595_111075509.jpg`, supplierId: 1 },
  { id: 44, sku: 'AYM-SAU-006', name: 'Black Bean Sauce 210ml', description: 'Savoury black bean sauce for stir fries and braised dishes.', price: 3.90, category: 'Asian Sauces', inventory: 45, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61055-1.jpg`, supplierId: 1 },
  { id: 45, sku: 'AYM-SAU-007', name: 'Plum Sauce 210ml', description: 'Sweet and tangy plum sauce for dipping and glazing.', price: 3.90, category: 'Asian Sauces', inventory: 40, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61089-1.jpg`, supplierId: 1 },
  { id: 46, sku: 'AYM-SAU-008', name: 'Teriyaki Sauce 210ml', description: 'Japanese-style teriyaki sauce for grilling and marinating.', price: 3.90, category: 'Asian Sauces', inventory: 65, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61115-1.jpg`, supplierId: 1 },
  { id: 47, sku: 'AYM-SAU-009', name: 'Honey & Soy Sauce 210ml', description: 'Sweet honey and soy blend for marinades and glazes.', price: 3.90, category: 'Asian Sauces', inventory: 50, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/60287-1.jpg`, supplierId: 1 },
  { id: 48, sku: 'AYM-SAU-010', name: 'Sweet and Sour Sauce 210ml', description: 'Classic sweet and sour sauce for stir fries and dipping.', price: 3.90, category: 'Asian Sauces', inventory: 55, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61112-1.jpg`, supplierId: 1 },
  { id: 49, sku: 'AYM-SAU-011', name: 'Vegetarian Oyster Sauce 210ml', description: 'Plant-based oyster sauce alternative with rich umami flavour.', price: 3.90, category: 'Asian Sauces', inventory: 35, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61351-1.jpg`, supplierId: 1 },
  { id: 50, sku: 'AYM-SAU-012', name: 'Lemon Chicken Sauce 210ml', description: 'Tangy lemon sauce for classic lemon chicken dishes.', price: 3.90, category: 'Asian Sauces', inventory: 30, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61237-1.jpg`, supplierId: 1 },
  { id: 51, sku: 'AYM-SAU-013', name: 'XO Sauce 220g', description: 'Premium XO sauce with dried shrimp and chilli.', price: 5.50, category: 'Asian Sauces', inventory: 5, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/9556041643351_t1.png`, supplierId: 1 },
  { id: 52, sku: 'AYM-SAU-014', name: 'Vegetarian Fish Sauce 210ml', description: 'Plant-based fish sauce alternative for vegan cooking.', price: 3.90, category: 'Asian Sauces', inventory: 25, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61116-1.jpg`, supplierId: 1 },
  { id: 53, sku: 'AYM-SAU-015', name: 'Kung Pao Sauce 210ml', description: 'Spicy and tangy Kung Pao sauce for classic Sichuan dishes.', price: 3.90, category: 'Asian Sauces', inventory: 30, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61112-1.jpg`, supplierId: 1 },
  { id: 54, sku: 'AYM-SAU-016', name: 'Mongolian Sauce 210ml', description: 'Sweet and savoury Mongolian sauce for lamb and beef dishes.', price: 3.90, category: 'Asian Sauces', inventory: 25, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61088-1.jpg`, supplierId: 1 },
  { id: 55, sku: 'AYM-SAU-017', name: 'Stir Fry Sauce 210ml', description: 'Versatile stir fry sauce for quick and easy meals.', price: 3.90, category: 'Asian Sauces', inventory: 40, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61115-1.jpg`, supplierId: 1 },
  { id: 56, sku: 'AYM-SAU-018', name: 'Abalone Sauce 210ml', description: 'Rich abalone-flavoured sauce for premium dishes.', price: 4.50, category: 'Asian Sauces', inventory: 8, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/fc3ef1444f30e6f3242b96c7b94b5b6cc7526b33.png`, supplierId: 1 },

  // ===== SOY SAUCES (7 products) =====
  { id: 57, sku: 'AYM-SOY-001', name: 'Light Soy Sauce 210ml', description: 'All-purpose light soy sauce for seasoning and dipping.', price: 3.50, category: 'Soy Sauces', inventory: 100, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9556041611138-1.png`, supplierId: 1 },
  { id: 58, sku: 'AYM-SOY-002', name: 'Light Soy Sauce 420ml', description: 'Light soy sauce in a larger bottle for busy kitchens.', price: 5.00, category: 'Soy Sauces', inventory: 60, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61421-1_1170974908.jpg`, supplierId: 1 },
  { id: 59, sku: 'AYM-SOY-003', name: 'Reduced Salt Soy Sauce 210ml', description: 'Lower sodium soy sauce without compromising flavour.', price: 3.50, category: 'Soy Sauces', inventory: 45, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/reduced-salt-soy-210ml-1.png`, supplierId: 1 },
  { id: 60, sku: 'AYM-SOY-004', name: 'Dark Soy Sauce 210ml', description: 'Rich and slightly sweet dark soy sauce for colour and flavour.', price: 3.50, category: 'Soy Sauces', inventory: 50, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61363-1.jpg`, supplierId: 1 },
  { id: 61, sku: 'AYM-SOY-005', name: 'Sweet Soy Sauce 210ml', description: 'Indonesian-style sweet soy sauce (kecap manis).', price: 3.50, category: 'Soy Sauces', inventory: 55, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61362-1.jpg`, supplierId: 1 },
  { id: 62, sku: 'AYM-SOY-006', name: 'Organic Soy Sauce 210ml', description: 'Certified organic soy sauce brewed with traditional methods.', price: 6.00, category: 'Soy Sauces', inventory: 30, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN', 'ORGANIC'], imageUrl: `${IMG}/61364-1.jpg`, supplierId: 3 },
  { id: 63, sku: 'AYM-SOY-007', name: 'Seasoning Sauce 150ml', description: 'Concentrated seasoning sauce for enhanced umami.', price: 5.00, category: 'Soy Sauces', inventory: 25, unit: 'bottle', cartonSize: 8, dietaryLabels: [], imageUrl: `${IMG}/61366-1.jpg`, supplierId: 1 },

  // ===== CHILLI SAUCES (9 products) =====
  { id: 64, sku: 'AYM-CHL-001', name: 'Sweet Chilli Sauce 435ml', description: 'Classic sweet chilli sauce for dipping and cooking.', price: 4.00, category: 'Chilli Sauces', inventory: 80, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041608794-1.png`, supplierId: 1 },
  { id: 65, sku: 'AYM-CHL-002', name: 'Thai Sweet Chilli Sauce 435ml', description: 'Authentic Thai sweet chilli with a perfect balance of sweet and heat.', price: 4.00, category: 'Chilli Sauces', inventory: 70, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041608770-1.png`, supplierId: 1 },
  { id: 66, sku: 'AYM-CHL-003', name: 'Hot Chilli Sauce (Sriracha) 435ml', description: 'Hot sriracha-style chilli sauce with garlic undertones.', price: 6.00, category: 'Chilli Sauces', inventory: 0, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041609142-1.png`, supplierId: 1 },
  { id: 67, sku: 'AYM-CHL-004', name: 'Ginger Sweet Chilli Sauce 435ml', description: 'Sweet chilli sauce infused with ginger for extra warmth.', price: 6.00, category: 'Chilli Sauces', inventory: 40, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041612913-1.png`, supplierId: 1 },
  { id: 68, sku: 'AYM-CHL-005', name: 'Chilli Garlic Sauce 435ml', description: 'Bold chilli sauce with a distinct garlic kick.', price: 4.00, category: 'Chilli Sauces', inventory: 45, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/09556041614290_a1n1.png`, supplierId: 1 },
  { id: 69, sku: 'AYM-CHL-006', name: 'Thai Sweet Chilli Sauce Light 285ml', description: 'Lighter version of Thai sweet chilli with fewer calories.', price: 3.00, category: 'Chilli Sauces', inventory: 35, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041613613-1.png`, supplierId: 1 },
  { id: 70, sku: 'AYM-CHL-007', name: 'Chilli Sauce (Hot) 275ml', description: 'Traditional hot chilli sauce for adding heat to any dish.', price: 3.00, category: 'Chilli Sauces', inventory: 50, unit: 'bottle', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60273-1.jpg`, supplierId: 1 },
  { id: 71, sku: 'AYM-CHL-008', name: 'Chilli Sauce (Sweet) 275ml', description: 'Aromatic and sweet chilli sauce, ideal as a dipping sauce.', price: 3.00, category: 'Chilli Sauces', inventory: 60, unit: 'bottle', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60272-1.jpg`, supplierId: 1 },
  { id: 72, sku: 'AYM-CHL-009', name: 'Chilli Sauce (Garlic) 275ml', description: 'Garlic-infused chilli sauce for spring rolls and fried dishes.', price: 3.00, category: 'Chilli Sauces', inventory: 45, unit: 'bottle', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/60274-1.jpg`, supplierId: 1 },

  // ===== CONDIMENTS (7 products) =====
  { id: 73, sku: 'AYM-CON-001', name: 'Crispy Chilli Oil 200g', description: 'Crunchy chilli flakes in oil for topping noodles, rice, and dumplings.', price: 6.00, category: 'Condiments', inventory: 40, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/9556041643290-2.jpg`, supplierId: 1 },
  { id: 74, sku: 'AYM-CON-002', name: 'Sambal Oelek 220g', description: 'Indonesian chilli paste for cooking and as a condiment.', price: 6.00, category: 'Condiments', inventory: 35, unit: 'jar', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/9556041643313_t1_1414271935.png`, supplierId: 1 },
  { id: 75, sku: 'AYM-CON-003', name: 'Curry Powder 130g', description: 'Aromatic curry powder blend for curries and marinades.', price: 5.00, category: 'Condiments', inventory: 50, unit: 'jar', cartonSize: 12, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/60356-1.jpg`, supplierId: 1 },
  { id: 76, sku: 'AYM-CON-004', name: 'Satay Seasoning 160g', description: 'Dry seasoning mix for making satay marinades and sauces.', price: 6.00, category: 'Condiments', inventory: 30, unit: 'packet', cartonSize: 12, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/60410-1.jpg`, supplierId: 1 },
  { id: 77, sku: 'AYM-CON-005', name: 'Pure Sesame Oil 210ml', description: '100% pure sesame oil for finishing and flavouring Asian dishes.', price: 6.50, category: 'Condiments', inventory: 45, unit: 'bottle', cartonSize: 12, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/02001-1.jpg`, supplierId: 1 },
  { id: 78, sku: 'AYM-CON-006', name: 'Pure Sesame Oil 420ml', description: 'Pure sesame oil in a larger bottle for frequent use.', price: 9.90, category: 'Condiments', inventory: 25, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61241-1.jpg`, supplierId: 1 },
  { id: 79, sku: 'AYM-CON-007', name: 'Pure Black Sesame Oil 210ml', description: 'Premium black sesame oil with a deeper, nuttier flavour.', price: 6.90, category: 'Condiments', inventory: 7, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/61242-1.jpg`, supplierId: 1 },

  // ===== NOODLES (6 products) =====
  { id: 80, sku: 'AYM-NOO-001', name: 'Rice Noodles 200g', description: 'Flat rice noodles for pad thai, stir fries, and soups.', price: 2.00, category: 'Noodles', inventory: 80, unit: 'packet', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/09556041610193_a1n1.jpg`, supplierId: 2 },
  { id: 81, sku: 'AYM-NOO-002', name: 'Rice Flake Noodles 200g', description: 'Wide, flat rice flake noodles for Pad See Ew and stir fries.', price: 3.00, category: 'Noodles', inventory: 60, unit: 'packet', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/rice-flake-noodles-front.jpg`, supplierId: 2 },
  { id: 82, sku: 'AYM-NOO-003', name: 'Rice Noodle Nests 300g', description: 'Portioned rice noodle nests for easy cooking.', price: 4.00, category: 'Noodles', inventory: 45, unit: 'packet', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/rice-noodle-nests-front.jpg`, supplierId: 2 },
  { id: 83, sku: 'AYM-NOO-004', name: 'Rice Vermicelli Noodles 200g', description: 'Thin rice vermicelli for salads, spring rolls, and soups.', price: 2.00, category: 'Noodles', inventory: 90, unit: 'packet', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/09556041610209_a1n1.jpg`, supplierId: 2 },
  { id: 84, sku: 'AYM-NOO-005', name: 'Brown Rice Vermicelli Noodles 200g', description: 'Healthier brown rice vermicelli noodles.', price: 3.00, category: 'Noodles', inventory: 35, unit: 'packet', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/09556041613330_a1n1.jpg`, supplierId: 2 },
  { id: 85, sku: 'AYM-NOO-006', name: 'Instant Noodles 700g', description: 'Large pack of instant noodles for quick meals.', price: 5.00, category: 'Noodles', inventory: 25, unit: 'packet', cartonSize: 4, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9311627612028-1.png`, supplierId: 2 },

  // ===== FISH (12 products) =====
  { id: 86, sku: 'AYM-FSH-001', name: 'Sardines in Black Bean Sauce 120g', description: 'Premium sardines in savoury black bean sauce.', price: 2.50, category: 'Fish', inventory: 70, unit: 'can', cartonSize: 12, dietaryLabels: [], imageUrl: `${IMG}/60001-1_875193042.jpg`, supplierId: 1 },
  { id: 87, sku: 'AYM-FSH-002', name: 'Sardines in Teriyaki Sauce 120g', description: 'Sardines in sweet and savoury teriyaki glaze.', price: 2.50, category: 'Fish', inventory: 65, unit: 'can', cartonSize: 12, dietaryLabels: [], imageUrl: `${IMG}/60003-1_1794748812.jpg`, supplierId: 1 },
  { id: 88, sku: 'AYM-FSH-003', name: 'Sardines in Chilli Oil 120g', description: 'Sardines packed in spicy chilli oil.', price: 2.50, category: 'Fish', inventory: 55, unit: 'can', cartonSize: 12, dietaryLabels: [], imageUrl: `${IMG}/60004-1_15611341.jpg`, supplierId: 1 },
  { id: 89, sku: 'AYM-FSH-004', name: 'Sardines in Szechuan Sauce 120g', description: 'Sardines in bold and spicy Szechuan sauce.', price: 2.50, category: 'Fish', inventory: 50, unit: 'can', cartonSize: 12, dietaryLabels: [], imageUrl: `${IMG}/60005-1_1436962510.jpg`, supplierId: 1 },
  { id: 90, sku: 'AYM-FSH-005', name: 'Sardines in Tomato Sauce 155g', description: 'Classic sardines in rich tomato sauce.', price: 2.00, category: 'Fish', inventory: 80, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/60108-1.jpg`, supplierId: 1 },
  { id: 91, sku: 'AYM-FSH-006', name: 'Sardines in Tomato Sauce 215g (Oval)', description: 'Sardines in tomato sauce in a premium oval can.', price: 3.25, category: 'Fish', inventory: 40, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/60163-1.jpg`, supplierId: 1 },
  { id: 92, sku: 'AYM-FSH-007', name: 'Sardines in Tomato Sauce 425g', description: 'Family-size sardines in tomato sauce.', price: 4.50, category: 'Fish', inventory: 30, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/60110-1.jpg`, supplierId: 1 },
  { id: 93, sku: 'AYM-FSH-008', name: 'Sardines in Tomato Sauce 425g (Oval)', description: 'Large oval can of sardines in tomato sauce.', price: 5.25, category: 'Fish', inventory: 25, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/60121-1.jpg`, supplierId: 1 },
  { id: 94, sku: 'AYM-FSH-009', name: 'Chilli Tuna 160g', description: 'Tuna flakes in spicy chilli sauce.', price: 3.00, category: 'Fish', inventory: 45, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/95502335-1_1925404781.jpg`, supplierId: 1 },
  { id: 95, sku: 'AYM-FSH-010', name: 'Chilli Tuna Fire Hot 160g', description: 'Extra hot chilli tuna for heat lovers.', price: 3.00, category: 'Fish', inventory: 35, unit: 'can', cartonSize: 12, dietaryLabels: [], imageUrl: `${IMG}/09556041640091_a1c1_884024619.jpg`, supplierId: 1 },
  { id: 96, sku: 'AYM-FSH-011', name: 'Tuna Flakes in Oil 150g', description: 'Premium tuna flakes in vegetable oil.', price: 3.00, category: 'Fish', inventory: 50, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/60421-1_1473316457.jpg`, supplierId: 1 },
  { id: 97, sku: 'AYM-FSH-012', name: 'Fried Mackerel in Chilli Sauce 155g', description: 'Fried mackerel in a tangy chilli sauce.', price: 3.00, category: 'Fish', inventory: 40, unit: 'can', cartonSize: 12, dietaryLabels: ['GF'], imageUrl: `${IMG}/60120-1.jpg`, supplierId: 1 },

  // ===== SATAY SAUCES (5 products) =====
  { id: 98, sku: 'AYM-SAT-001', name: 'Satay Sauce 250ml', description: 'Classic peanut satay sauce for dipping and marinating.', price: 4.50, category: 'Satay Sauces', inventory: 55, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9311627603842-1.png`, supplierId: 1 },
  { id: 99, sku: 'AYM-SAT-002', name: 'Thai Satay Sauce 250ml', description: 'Thai-style satay sauce with coconut and peanut.', price: 4.50, category: 'Satay Sauces', inventory: 45, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF'], imageUrl: `${IMG}/9556041612722-1.png`, supplierId: 1 },
  { id: 100, sku: 'AYM-SAT-003', name: 'Gado Gado Peanut Sauce 250ml', description: 'Indonesian peanut sauce for gado gado and salads.', price: 4.50, category: 'Satay Sauces', inventory: 35, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/9556041612739-1.png`, supplierId: 1 },
  { id: 101, sku: 'AYM-SAT-004', name: 'Satay Marinade 250ml', description: 'Ready-to-use satay marinade for grilling and barbecue.', price: 4.50, category: 'Satay Sauces', inventory: 30, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041612883-1.png`, supplierId: 1 },
  { id: 102, sku: 'AYM-SAT-005', name: 'Sriracha Satay Sauce 250ml', description: 'Satay sauce with a sriracha chilli kick.', price: 4.50, category: 'Satay Sauces', inventory: 25, unit: 'bottle', cartonSize: 6, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/sriracha-satay-sauce-250ml-1.png`, supplierId: 1 },

  // ===== DESSERTS (3 products) =====
  { id: 103, sku: 'AYM-DES-001', name: 'Sago Dessert 200g', description: 'Traditional sago pearl dessert, ready to serve.', price: 5.00, category: 'Desserts', inventory: 30, unit: 'jar', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041613521-1.png`, supplierId: 1 },
  { id: 104, sku: 'AYM-DES-002', name: 'Coconut Spread (Kaya) 200g', description: 'Sweet coconut jam spread, perfect on toast.', price: 5.00, category: 'Desserts', inventory: 25, unit: 'jar', cartonSize: 6, dietaryLabels: ['GF'], imageUrl: `${IMG}/coconut_spread_kaya_200g_1_dync_2_1406988399.png`, supplierId: 1 },
  { id: 105, sku: 'AYM-DES-003', name: 'Palm Sugar Syrup 200g', description: 'Natural palm sugar syrup for desserts and drinks.', price: 5.00, category: 'Desserts', inventory: 20, unit: 'bottle', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/9556041613538-1.jpg`, supplierId: 1 },

  // ===== READY MEAL SAUCES (3 products) =====
  { id: 106, sku: 'AYM-RMS-001', name: 'Pad Thai Sauce 200g', description: 'Ready-to-use pad thai sauce for authentic noodle dishes.', price: 4.00, category: 'Ready Meal Sauces', inventory: 35, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/8886009900426_t1_516530233.png`, supplierId: 1 },
  { id: 107, sku: 'AYM-RMS-002', name: 'Pad See Ew Sauce 200g', description: 'Thai-style sauce for Pad See Ew flat noodles.', price: 4.00, category: 'Ready Meal Sauces', inventory: 30, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/8886009900433_t1_985955568.png`, supplierId: 1 },
  { id: 108, sku: 'AYM-RMS-003', name: 'Korean Japchae Sauce 200g', description: 'Sweet and savoury sauce for Korean glass noodle dishes.', price: 4.00, category: 'Ready Meal Sauces', inventory: 25, unit: 'bottle', cartonSize: 6, dietaryLabels: [], imageUrl: `${IMG}/8886009900518_t1_938407247.png`, supplierId: 1 },

  // ===== OTHER (6 products) =====
  { id: 109, sku: 'AYM-OTH-001', name: 'White Pearl Barley 450g', description: 'Premium white pearl barley for soups and desserts.', price: 3.50, category: 'Other', inventory: 40, unit: 'packet', cartonSize: 12, dietaryLabels: ['VEGAN'], imageUrl: `${IMG}/60218-1.jpg`, supplierId: 2 },
  { id: 110, sku: 'AYM-OTH-002', name: 'Petai in Brine 170g', description: 'Stink beans preserved in brine, a Southeast Asian delicacy.', price: 5.50, category: 'Other', inventory: 20, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/6a040cf37b3da7793da61deee9650f7927e3300d.png`, supplierId: 1 },
  { id: 111, sku: 'AYM-OTH-003', name: 'Tamarind Puree 114g', description: 'Concentrated tamarind puree for sour notes in Asian cooking.', price: 5.00, category: 'Other', inventory: 35, unit: 'jar', cartonSize: 6, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/61091-1.jpg`, supplierId: 1 },
  { id: 112, sku: 'AYM-OTH-004', name: 'Sweet Corn Kernel 425g', description: 'Whole kernel sweet corn, ready to use.', price: 2.00, category: 'Other', inventory: 60, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/13d4a0427ee342cf1cc6cde511d26666178314d8.png`, supplierId: 2 },
  { id: 113, sku: 'AYM-OTH-005', name: 'Creamed Corn 425g', description: 'Smooth and creamy corn, great for soups and sides.', price: 2.00, category: 'Other', inventory: 55, unit: 'can', cartonSize: 12, dietaryLabels: ['GF', 'VEGAN'], imageUrl: `${IMG}/dc6daae2eeffd1a1872e4d9ba2a5878acbd9b47e.png`, supplierId: 2 },
  { id: 114, sku: 'AYM-OTH-006', name: 'Baked Beans in Tomato Sauce 425g', description: 'Classic baked beans in rich tomato sauce.', price: 2.00, category: 'Other', inventory: 50, unit: 'can', cartonSize: 12, dietaryLabels: [], imageUrl: `${IMG}/baked-beans-in-tomato-sauce-425g-1.png`, supplierId: 2 },

  // ===== V2FOOD PLANT-BASED (V2food client demo) =====
  // `featured: true` pins these to the top of the shop. SKUs double as the codes
  // printed on the Young & Jacksons demo POs (po_product_aliases.source_code).
  { id: 200, sku: 'V2F-MINCE-001', name: 'v2food Plant-Based Mince 1kg', description: 'Plant-based mince — versatile high-protein meat alternative for bolognese, tacos, and pies.', price: 12.50, category: 'Plant-Based', inventory: 90, unit: 'pack', cartonSize: 6, dietaryLabels: ['VEGAN'], featured: true, imageUrl: `${V2}/681ab841bb919774d4e6e309_image-v2mince-spaghetti-bolognese-1200px.jpg`, supplierId: 4 },
  { id: 201, sku: 'V2F-BURG-001', name: 'v2food Plant-Based Burger Patties 1.13kg (10pk)', description: 'Juicy plant-based burger patties — chargrill or pan-fry for a classic pub burger.', price: 24.00, category: 'Plant-Based', inventory: 70, unit: 'box', cartonSize: 4, dietaryLabels: ['VEGAN'], featured: true, imageUrl: `${V2}/681abaa747c603ee5ccb4787_v2burger%20in%20build.jpg`, supplierId: 4 },
  { id: 202, sku: 'V2F-SCHN-001', name: 'v2food Plant-Based Schnitzel 1kg', description: 'Crumbed plant-based schnitzel — crisp coating, oven or fry, ideal for parmas and salads.', price: 18.00, category: 'Plant-Based', inventory: 60, unit: 'pack', cartonSize: 6, dietaryLabels: ['VEGAN'], featured: true, imageUrl: `${V2}/681ab964a044554efcf12b6a_schnitzel%20garden%20salad%20from%20above.jpg`, supplierId: 4 },
  { id: 203, sku: 'V2F-TEND-001', name: 'v2food Plant-Based Chicken-Style Tenders 1kg', description: 'Golden plant-based tenders — share plates, wraps, and bar snacks.', price: 16.50, category: 'Plant-Based', inventory: 65, unit: 'pack', cartonSize: 6, dietaryLabels: ['VEGAN'], featured: true, imageUrl: `${V2}/681ab8cb9e3f914397e0bcf0_nuggets%20from%20above%20white%20crop.jpg`, supplierId: 4 },
  { id: 204, sku: 'V2F-PIES-001', name: 'v2food Plant-Based Party Pies 1kg (12pk)', description: 'Plant-based party pies — crowd-pleasing finger food for functions and the front bar.', price: 14.00, category: 'Plant-Based', inventory: 80, unit: 'pack', cartonSize: 6, dietaryLabels: ['VEGAN'], featured: true, imageUrl: `${V2}/681aa8d57f9f9e7e4bcd3c95_V2_Party%20Pies_1.png`, supplierId: 4 },
];

export const PRODUCTS: Product[] = PRODUCTS_SEED.map(p => ({ ...p, available: p.inventory }));

// Assign realistic volume data (m³) to products based on size extracted from name/unit
const sizeMatch = (name: string): number | null => {
  const ml = name.match(/(\d+)\s*ml/i);
  if (ml) return parseInt(ml[1]);
  const g = name.match(/(\d+)\s*g\b/i);
  if (g) return parseInt(g[1]);
  return null;
};

const UNIT_VOLUMES: Record<string, Record<string, { unit: number; carton: number }>> = {
  // cm³ approximate by unit type and size category
  can: { small: { unit: 0.00025, carton: 0.0035 }, medium: { unit: 0.00055, carton: 0.0075 }, large: { unit: 0.00075, carton: 0.0095 } },
  jar: { small: { unit: 0.00035, carton: 0.0025 }, medium: { unit: 0.00055, carton: 0.004 }, large: { unit: 0.0008, carton: 0.006 } },
  bottle: { small: { unit: 0.0004, carton: 0.003 }, medium: { unit: 0.0008, carton: 0.006 }, large: { unit: 0.0015, carton: 0.01 } },
  packet: { small: { unit: 0.0003, carton: 0.003 }, medium: { unit: 0.0006, carton: 0.005 }, large: { unit: 0.001, carton: 0.009 } },
  carton: { small: { unit: 0.0004, carton: 0.005 }, medium: { unit: 0.0006, carton: 0.008 }, large: { unit: 0.001, carton: 0.013 } },
};

PRODUCTS.forEach(p => {
  const size = sizeMatch(p.name);
  const sizeKey = !size || size <= 200 ? 'small' : size <= 400 ? 'medium' : 'large';
  const unitType = UNIT_VOLUMES[p.unit] ?? UNIT_VOLUMES.can;
  const vol = unitType[sizeKey] ?? unitType.medium;
  p.cubicMetersUnit = vol.unit;
  p.cubicMetersCarton = vol.carton;
});

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

const mkHistory = (status: OrderStatus, orderDate: string): import('./types').StatusHistoryEntry[] => {
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
    status: 'Completed' as import('./types').PurchaseOrderStatus,
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
    status: 'Submitted' as import('./types').PurchaseOrderStatus,
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
    status: 'Pending' as import('./types').PurchaseOrderStatus,
    submittedBy: USERS[0],
  },
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
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    processing: 'Processing',
    processed: 'Processed',
    picked: 'Picked',
    packed: 'Packed',
    dispatched: 'Dispatched',
    delivered: 'Delivered',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, { bg: string; text: string; border: string }> = {
    processing: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    processed: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    picked: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    packed: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    dispatched: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    delivered: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

export const ORDER_STATUS_SEQUENCE: OrderStatus[] = ['processing', 'processed', 'picked', 'packed', 'dispatched', 'delivered'];

export const DELIVERY_TIME_SLOTS: DeliveryTimeSlot[] = [
    'Morning (8am-12pm)',
    'Afternoon (12pm-4pm)',
    'Evening (4pm-8pm)',
];

export const DELIVERY_LEAD_DAYS = 1;

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
