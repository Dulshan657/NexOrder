import React from 'react';
import type {
    AppSettings,
    DeliveryTimeSlot,
    HoReCa,
    Invoice,
    Order,
    OrderItem,
    OrderingHint,
    PantryItem,
    Product,
    Promotion,
    User,
} from '../types';
import { CATEGORIES } from '../constants';
import { resolveHoReCaPrice } from '../pricing';
import OrderingTabBar from '../components/OrderingTabBar';
import type { OrderingTabKey } from '../components/OrderingTabBar';
import ShopTopBar from '../components/ShopTopBar';
import type { SortOption } from '../components/ShopTopBar';
import PromotionsBanner from '../components/PromotionsBanner';
import CategoryFilter from '../components/CategoryFilter';
import MissingItemsNudge from '../components/MissingItemsNudge';
import ProductCard from '../components/ProductCard';
import PantryList from '../components/PantryList';
import ReorderTab from '../components/ReorderTab';
import CartSlidePanel from '../components/CartSlidePanel';

export interface ShopViewProps {
    // App-level data
    products: Product[];
    hoReCas: HoReCa[];
    promotions: Promotion[];
    invoices: Invoice[];
    allOrders: Order[];
    currentUser: User;
    appSettings: AppSettings;

    // Cart state
    orderItems: OrderItem[];
    selectedHoReCa: HoReCa | undefined;
    selectedHoReCaId: number | null;
    notes: string;
    deliveryDate: string;
    deliveryTimeSlot: DeliveryTimeSlot | '';
    isLoading: boolean;
    errors: { hoReCa?: string; emptyOrder?: string; api?: string };
    total: number;
    isAdminOrManager: boolean;

    // Pantry state
    currentPantryItems: PantryItem[];
    pantryEstTotal: number;

    // Derived shop memos
    filteredProducts: Product[];
    hintsPerProduct: Map<number, OrderingHint[]>;
    missingItemHints: OrderingHint[];
    recentHoReCaProducts: Product[];
    lastOrderForHoReCa: Order | null;

    // UI state
    orderingTab: OrderingTabKey;
    onOrderingTabChange: (tab: OrderingTabKey) => void;
    selectedCategory: string;
    onSelectedCategoryChange: (c: string) => void;
    searchQuery: string;
    onSearchQueryChange: (q: string) => void;
    sortOption: SortOption;
    onSortOptionChange: (s: SortOption) => void;
    isCartOpen: boolean;
    onCartOpenChange: (b: boolean) => void;

    // Cart handlers
    onAddItem: (product: Product, options: { packSize?: number; price: number; unit: string }, quantity?: number) => void;
    onApplyPromo: (promo: Promotion) => void;
    onUpdateQuantity: (productId: number, newQuantity: number, packSize?: number) => void;
    onSubmitOrder: () => void;
    onSelectHoReCa: (id: number | null) => void;
    onNotesChange: (s: string) => void;
    onDeliveryDateChange: (s: string) => void;
    onDeliveryTimeSlotChange: (s: DeliveryTimeSlot | '') => void;
    onReorderItems: (items: OrderItem[], mode: 'replace' | 'merge') => void;

    // Pantry handlers
    onTogglePantry: (productId: number) => void;
    onAddPantryItemToOrder: (pantryItem: PantryItem) => void;
    onAddAllPantryToOrder: () => void;
    onAddSelectedPantryToOrder: (items: PantryItem[]) => void;
    onRemoveFromPantry: (productId: number) => void;
    onUpdatePantryItem: (
        productId: number,
        updates: Partial<Pick<PantryItem, 'preferredPackSize' | 'defaultQuantity'>>,
    ) => void;
}

const ShopView: React.FC<ShopViewProps> = ({
    products,
    hoReCas,
    promotions,
    invoices,
    allOrders,
    currentUser,
    appSettings,
    orderItems,
    selectedHoReCa,
    selectedHoReCaId,
    notes,
    deliveryDate,
    deliveryTimeSlot,
    isLoading,
    errors,
    total,
    isAdminOrManager,
    currentPantryItems,
    pantryEstTotal,
    filteredProducts,
    hintsPerProduct,
    missingItemHints,
    recentHoReCaProducts,
    lastOrderForHoReCa,
    orderingTab,
    onOrderingTabChange,
    selectedCategory,
    onSelectedCategoryChange,
    searchQuery,
    onSearchQueryChange,
    sortOption,
    onSortOptionChange,
    isCartOpen,
    onCartOpenChange,
    onAddItem,
    onApplyPromo,
    onUpdateQuantity,
    onSubmitOrder,
    onSelectHoReCa,
    onNotesChange,
    onDeliveryDateChange,
    onDeliveryTimeSlotChange,
    onReorderItems,
    onTogglePantry,
    onAddPantryItemToOrder,
    onAddAllPantryToOrder,
    onAddSelectedPantryToOrder,
    onRemoveFromPantry,
    onUpdatePantryItem,
}) => {
    return (
        <>
            <div className={isCartOpen ? 'cart-push' : ''}>
                <div className="space-y-6 p-4 sm:p-6 lg:p-8">
                    <OrderingTabBar
                        activeTab={orderingTab}
                        onTabChange={onOrderingTabChange}
                        pantryItemCount={currentPantryItems.length}
                        pantryEstTotal={pantryEstTotal}
                        hasHoReCa={!!selectedHoReCa}
                        hasLastOrder={!!lastOrderForHoReCa}
                    />
                    <ShopTopBar
                        currentUser={currentUser}
                        hoReCas={hoReCas}
                        selectedHoReCaId={selectedHoReCaId}
                        onSelectHoReCa={onSelectHoReCa}
                        hoReCaError={errors.hoReCa}
                        cartItemCount={orderItems.reduce((sum, i) => sum + i.quantity, 0)}
                        cartTotal={total}
                        isCartOpen={isCartOpen}
                        onToggleCart={() => onCartOpenChange(!isCartOpen)}
                        searchQuery={searchQuery}
                        onSearchChange={onSearchQueryChange}
                        sortOption={sortOption}
                        onSortChange={onSortOptionChange}
                        products={products}
                        recentItems={recentHoReCaProducts}
                        selectedHoReCaName={selectedHoReCa?.name ?? ''}
                    />

                    {orderingTab === 'catalogue' && (
                        <>
                            {promotions.length > 0 && (
                                <PromotionsBanner
                                    promotions={promotions}
                                    customer={selectedHoReCa}
                                    currentUser={currentUser}
                                    products={products}
                                    onApplyPromo={onApplyPromo}
                                />
                            )}
                            <CategoryFilter
                                categories={CATEGORIES}
                                selectedCategory={selectedCategory}
                                onSelectCategory={onSelectedCategoryChange}
                                hasDeals={promotions.some(p => p.isActive)}
                            />
                            {selectedHoReCa && orderItems.length > 0 && missingItemHints.length > 0 && (
                                <MissingItemsNudge
                                    hints={missingItemHints}
                                    products={products}
                                    onAddItem={(product: Product) =>
                                        onAddItem(product, {
                                            price: resolveHoReCaPrice(product, selectedHoReCa),
                                            unit: product.unit,
                                        })
                                    }
                                />
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {filteredProducts.length > 0 ? (
                                    filteredProducts.map(product => (
                                        <ProductCard
                                            key={product.id}
                                            product={product}
                                            onAddItem={onAddItem}
                                            selectedHoReCa={selectedHoReCa}
                                            onTogglePantry={selectedHoReCa ? onTogglePantry : undefined}
                                            isPantryItem={currentPantryItems.some(i => i.productId === product.id)}
                                            cartonDiscountPercent={appSettings.cartonDiscountPercent}
                                            lowStockThreshold={appSettings.lowStockThreshold}
                                            hints={hintsPerProduct.get(product.id)}
                                            promotions={promotions}
                                            currentUser={currentUser}
                                        />
                                    ))
                                ) : (
                                    <div className="md:col-span-2 lg:col-span-3 xl:col-span-4 text-center py-16 bg-white rounded-xl border border-stone-200/60 border-dashed shadow-card">
                                        <h3 className="text-xl font-display font-semibold text-stone-800 text-balance">
                                            No Products Found
                                        </h3>
                                        <p className="text-stone-500 mt-2">
                                            No products match your current search and category filters.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {orderingTab === 'pantry' && (
                        <PantryList
                            pantryItems={currentPantryItems}
                            products={products}
                            categories={CATEGORIES}
                            selectedHoReCa={selectedHoReCa ?? null}
                            allOrders={allOrders}
                            currentCart={orderItems}
                            cartonDiscountPercent={appSettings.cartonDiscountPercent}
                            lowStockThreshold={appSettings.lowStockThreshold}
                            onAddToOrder={onAddPantryItemToOrder}
                            onAddAllToOrder={onAddAllPantryToOrder}
                            onAddSelectedToOrder={onAddSelectedPantryToOrder}
                            onRemoveFromPantry={onRemoveFromPantry}
                            onUpdatePantryItem={onUpdatePantryItem}
                            onAddToPantry={onTogglePantry}
                        />
                    )}

                    {orderingTab === 'reorder' && (
                        <ReorderTab
                            lastOrder={lastOrderForHoReCa}
                            products={products}
                            selectedHoReCa={selectedHoReCa ?? null}
                            cartonDiscountPercent={appSettings.cartonDiscountPercent}
                            cartItemCount={orderItems.length}
                            onAddItems={onReorderItems}
                        />
                    )}
                </div>
            </div>

            <CartSlidePanel
                isOpen={isCartOpen}
                onClose={() => onCartOpenChange(false)}
                items={orderItems}
                total={total}
                currentUser={currentUser}
                userRole={currentUser.role}
                hoReCas={hoReCas}
                selectedHoReCaId={selectedHoReCaId}
                notes={notes}
                deliveryDate={deliveryDate}
                deliveryTimeSlot={deliveryTimeSlot}
                onSelectHoReCa={onSelectHoReCa}
                onUpdateQuantity={onUpdateQuantity}
                onSubmitOrder={onSubmitOrder}
                onNotesChange={onNotesChange}
                onDeliveryDateChange={onDeliveryDateChange}
                onDeliveryTimeSlotChange={onDeliveryTimeSlotChange}
                isLoading={isLoading}
                errors={errors}
                invoices={invoices}
                isAdminOrManager={isAdminOrManager}
                promotions={promotions}
                products={products}
            />
        </>
    );
};

export default ShopView;
