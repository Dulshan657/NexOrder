import React, { Suspense } from 'react';
import { UserRole, User, Product, ProductSupplierLink, HoReCa, Supplier, Order, AppSettings, Invoice, OrderStatus, SalesTarget, Promotion, Visit, ScheduledVisit } from '../types';
import { LoadingSkeleton } from './Skeleton';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import {
    MODULE_FIELD_OPS,
    MODULE_INVENTORY_DISPATCH,
    MODULE_INVOICING,
    MODULE_PO_INBOX,
    MODULE_PROMOTIONS,
    MODULE_SALES_ORDERS,
} from '../lib/modules';
import type { AdminTab } from '../lib/adminTabUrl';
import type { NavTarget as SetupNavTarget } from '../lib/warehouseSetup/steps';
import ProductAdmin from './ProductAdmin';
import HoReCaListView from './HoReCaListView';
import UserAdmin from './UserAdmin';
import SupplierAdmin from './SupplierAdmin';
import WalkInReviewTab from './admin/WalkInReviewTab';

// Heavy admin views — lazy-loaded so rep/customer paths don't pull them in.
// lazyWithRetry recovers from stale chunk hashes after a redeploy.
//
// ── THE MODULE GATE HAS TO BE ON THE DECLARATION, NOT ONLY THE JSX ──────────
//
// `{MODULE_X && props.activeTab === 'Stock' && <StockView/>}` stops the view
// RENDERING, but the `import()` below runs at module scope and Rollup would
// still emit the chunk — so a tenant without the module would be served every
// byte of it, one devtools Network tab away. Wrapping the declaration puts the
// `import()` inside a branch that folds to `false`, and the chunk is never
// emitted. Hidden vs not shipped, again; see lib/modules.ts.
//
// `__moduleOff` is a typed `null` so the JSX below stays valid — there is no
// @types/react here, so components are `any` and React never sees it, because
// the same constant gates the render.
const AdminDashboard = lazyWithRetry(() => import('./AdminDashboard'));
const AuditLogTab = lazyWithRetry(() => import('./admin/AuditLogTab'));
const SystemHealthTab = lazyWithRetry(() => import('./admin/SystemHealthTab'));
const SettingsView = lazyWithRetry(() => import('./admin/settings/SettingsView'));

// Both of these were plain top-of-file imports until 2026-08-20, which meant
// their module gate stopped them RENDERING and shipped every byte regardless —
// the exact failure the comment above warns about, sitting twenty lines below
// it. They are lazy and gated now.
const OrderImportPage = MODULE_SALES_ORDERS ? lazyWithRetry(() => import('./OrderImportPage')) : null;
const AccountsAgingTable = MODULE_INVOICING ? lazyWithRetry(() => import('./AccountsAgingTable')) : null;

const PromotionAdmin = MODULE_PROMOTIONS ? lazyWithRetry(() => import('./PromotionAdmin')) : null;
const POInboxView = MODULE_PO_INBOX ? lazyWithRetry(() => import('./admin/POInboxView')) : null;

const HoReCaInsightsPanel = MODULE_FIELD_OPS ? lazyWithRetry(() => import('./HoReCaInsightsPanel')) : null;
const ScheduledVisitsAdmin = MODULE_FIELD_OPS ? lazyWithRetry(() => import('./admin/ScheduledVisitsAdmin')) : null;

const StockView = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./StockView')) : null;
const ReceiveStockView = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/ReceiveStockView')) : null;
const PickQueueView = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/PickQueueView')) : null;
const PutawayQueuePage = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/PutawayQueuePage')) : null;
const ReplenQueuePage = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/ReplenQueuePage')) : null;
const StocktakePage = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/StocktakePage')) : null;
const DispatchedOrdersView = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/DispatchedOrdersView')) : null;
const DocumentsView = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/DocumentsView')) : null;
const WarehousePage = MODULE_INVENTORY_DISPATCH ? lazyWithRetry(() => import('./inventory/warehouse/WarehousePage')) : null;

interface AdminViewProps {
    currentUser: User;
    products: Product[];
    hoReCas: HoReCa[];
    users: User[];
    suppliers: Supplier[];
    allOrders: Order[];
    appSettings: AppSettings;
    onAddProduct: (product: Omit<Product, 'id' | 'inventory'>) => Promise<void>;
    onUpdateProduct: (product: Product) => Promise<void>;
    onDeleteProduct: (productId: number) => void;
    /** Replace one product's supplier links (mig 00070) — Suppliers → Products panel. */
    onSaveProductSupplierLinks: (productId: number, links: ProductSupplierLink[]) => Promise<void>;
    onAddHoReCa: (customer: Omit<HoReCa, 'id'>, reason?: string) => void;
    onUpdateHoReCa: (customer: HoReCa, reason?: string) => void;
    onDeleteHoReCa: (hoReCaId: number) => void;
    onAddUser: (user: Omit<User, 'id'>) => void;
    onUpdateUser: (user: User) => void;
    onDeleteUser: (userId: number) => void;
    onAddSupplier: (supplier: Omit<Supplier, 'id'>) => void;
    onUpdateSupplier: (supplier: Supplier) => void;
    onDeleteSupplier: (supplierId: number) => void;
    invoices: Invoice[];
    salesTargets?: SalesTarget[];
    onUpdateSalesTargets?: (targets: SalesTarget[]) => void;
    promotions?: Promotion[];
    onAddPromotion?: (promo: Promotion) => void;
    onUpdatePromotion?: (promo: Promotion) => void;
    onDeletePromotion?: (promoId: string) => void;
    onUpdateInvoiceStatus: (invoiceId: string, status: Invoice['status']) => void;
    onUpdateOrderStatus: (orderId: string, newStatus: OrderStatus, note?: string) => void;
    onReorder: (order: Order) => void;
    onViewOrderDetail: (orderId: string) => void;
    activeTab: AdminTab;
    visits?: Visit[];
    routes?: ScheduledVisit[];
    onSetRoutes?: (routes: ScheduledVisit[]) => void;
    addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
    onSetAdminView?: (tab: AdminTab) => void;
    /** Order id flashed in the Order Import row table after a deep-link from PO Inbox. */
    highlightOrderId?: string | null;
    onClearHighlightOrderId?: () => void;
    /** Switch to Order Import AND prime highlightOrderId. Called by POInboxDetailModal on approve. */
    onViewInOrderImport?: (orderId: string) => void;
}

// The union moved to lib/adminTabUrl.ts so `?tab=` parsing can validate against
// it without importing a component. Re-exported here so the many existing
// `import type { AdminTab } from './AdminView'` call sites keep working.
export type { AdminTab } from '../lib/adminTabUrl';

const AdminView: React.FC<AdminViewProps> = (props) => {
    const isDashboard = props.activeTab === 'Dashboard';
    // The one deep-link writer. Params are written to the URL FIRST, then the
    // tab switches — every admin tab unmounts on switch, so the target mounts
    // fresh and reads them in a mount effect. A null value deletes the param,
    // which is how a stale flag from a previous link gets cleared.
    const openWith = (tab: AdminTab, params?: Record<string, string | null>) => {
        const url = new URL(window.location.href);
        for (const [key, value] of Object.entries(params ?? {})) {
            if (value === null) url.searchParams.delete(key);
            else url.searchParams.set(key, value);
        }
        window.history.replaceState({}, '', url.toString());
        props.onSetAdminView?.(tab);
    };
    // Jump from the Warehouse viewer's empty-state CTA into the Layout Designer:
    // deep-link the warehouse via ?designer= (and ?import= for the floor-plan flow),
    // then switch to Settings where WarehousesSettingsSection auto-opens it.
    const openDesigner = (warehouseId: number, opts?: { import?: boolean }) =>
        openWith('Settings', {
            designer: String(warehouseId),
            import: opts?.import ? '1' : null,
        });
    // Post-receipt "Go to putaway" deep-link: pre-select the receipt's
    // server-resolved destination warehouse via ?wh= (PutawayQueuePage reads
    // this the same way the Warehouse viewer does) before switching tabs.
    const openPutaway = (warehouseId: number) => openWith('Putaway', { wh: String(warehouseId) });

    // Setup-checklist steps. The target says which params it needs; the
    // warehouse id is substituted here because only this level knows it.
    const openSetupTarget = (target: SetupNavTarget, warehouseId: number) => {
        const params: Record<string, string | null> = { ...(target.params ?? {}) };
        if (target.warehouseParam) params[target.warehouseParam] = String(warehouseId);
        if (target.section) params.section = target.section;
        openWith(target.tab, params);
    };
    return (
        <div>
            <ErrorBoundary label={`Admin · ${props.activeTab}`}>
            <Suspense fallback={<LoadingSkeleton />}>
            <div>
                {isDashboard && <AdminDashboard allOrders={props.allOrders} products={props.products} hoReCas={props.hoReCas} users={props.users} lowStockThreshold={props.appSettings.lowStockThreshold} invoices={props.invoices} salesTargets={props.salesTargets} onUpdateSalesTargets={props.onUpdateSalesTargets} currentUser={props.currentUser} promotions={props.promotions} visits={props.visits} routes={props.routes} onNavigateTab={props.onSetAdminView ? (tab: string) => props.onSetAdminView!(tab as AdminTab) : undefined} />}
                {props.activeTab === 'Products' && <ProductAdmin products={props.products} suppliers={props.suppliers} onAddProduct={props.onAddProduct} onUpdateProduct={props.onUpdateProduct} onDeleteProduct={props.onDeleteProduct} addToast={props.addToast} />}
                {props.activeTab === 'HoReCa' && <HoReCaListView hoReCas={props.hoReCas} orders={props.allOrders} invoices={props.invoices} currentUser={props.currentUser} visits={props.visits} onAddHoReCa={props.onAddHoReCa} onUpdateHoReCa={props.onUpdateHoReCa} onDeleteHoReCa={props.onDeleteHoReCa} />}
                {MODULE_FIELD_OPS && props.activeTab === 'HoReCa Insights' && <HoReCaInsightsPanel allOrders={props.allOrders} hoReCas={props.hoReCas} products={props.products} />}
                {MODULE_SALES_ORDERS && props.activeTab === 'Order Import' && <OrderImportPage orders={props.allOrders} invoices={props.invoices} hoReCas={props.hoReCas} currentUser={props.currentUser} onReorder={props.onReorder} onViewDetail={props.onViewOrderDetail} onUpdateStatus={props.onUpdateOrderStatus} onBack={() => {}} highlightOrderId={props.highlightOrderId ?? null} onClearHighlightOrderId={props.onClearHighlightOrderId} />}
                {MODULE_PROMOTIONS && props.activeTab === 'Promotions' && props.currentUser.role === UserRole.ADMIN && props.promotions && props.onAddPromotion && props.onUpdatePromotion && props.onDeletePromotion && (
                    <PromotionAdmin promotions={props.promotions} products={props.products} hoReCas={props.hoReCas} users={props.users} onAdd={props.onAddPromotion} onUpdate={props.onUpdatePromotion} onDelete={props.onDeletePromotion} />
                )}
                {MODULE_INVOICING && props.activeTab === 'Accounts' && <AccountsAgingTable invoices={props.invoices} hoReCas={props.hoReCas} currentUser={props.currentUser} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Stock' && <StockView products={props.products} currentUser={props.currentUser} addToast={props.addToast} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Receiving' && <ReceiveStockView products={props.products} currentUser={props.currentUser} onOpenPutaway={openPutaway} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Putaway' && <PutawayQueuePage currentUser={props.currentUser} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Replenishment' && <ReplenQueuePage currentUser={props.currentUser} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Stocktake' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER || props.currentUser.role === UserRole.WAREHOUSE) && <StocktakePage currentUser={props.currentUser} products={props.products} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Pick Queue' && <PickQueueView currentUser={props.currentUser} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Dispatched' && <DispatchedOrdersView orders={props.allOrders} onViewDetail={props.onViewOrderDetail} />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Documents' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER || props.currentUser.role === UserRole.WAREHOUSE) && <DocumentsView />}
                {MODULE_INVENTORY_DISPATCH && props.activeTab === 'Warehouse' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER || props.currentUser.role === UserRole.WAREHOUSE) && <WarehousePage currentUser={props.currentUser} onOpenDesigner={props.currentUser.role === UserRole.ADMIN ? openDesigner : undefined} onNavigateSetup={openSetupTarget} />}
                {MODULE_FIELD_OPS && props.activeTab === 'Scheduled Visits' && props.routes && props.onSetRoutes && props.addToast && (
                    <ScheduledVisitsAdmin routes={props.routes} users={props.users} hoReCas={props.hoReCas} visits={props.visits ?? []} currentUser={props.currentUser} onSetRoutes={props.onSetRoutes} addToast={props.addToast} />
                )}
                {MODULE_FIELD_OPS && props.activeTab === 'Walk-in Review' && (
                    <WalkInReviewTab hoReCas={props.hoReCas} users={props.users} currentUser={props.currentUser} addToast={props.addToast} />
                )}
                {props.activeTab === 'Users' && props.currentUser.role === UserRole.ADMIN && <UserAdmin users={props.users} onAddUser={props.onAddUser} onUpdateUser={props.onUpdateUser} onDeleteUser={props.onDeleteUser} />}
                {props.activeTab === 'Suppliers' && props.currentUser.role === UserRole.ADMIN && <SupplierAdmin suppliers={props.suppliers} products={props.products} onAddSupplier={props.onAddSupplier} onUpdateSupplier={props.onUpdateSupplier} onDeleteSupplier={props.onDeleteSupplier} onSaveProductSupplierLinks={props.onSaveProductSupplierLinks} />}
                {props.activeTab === 'Settings' && props.currentUser.role === UserRole.ADMIN && (
                    <SettingsView
                        hoReCas={props.hoReCas}
                        products={props.products}
                        onUpdateHoReCa={props.onUpdateHoReCa}
                    />
                )}
                {MODULE_PO_INBOX && props.activeTab === 'PO Inbox' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER) && (
                    <POInboxView
                        hoReCas={props.hoReCas}
                        products={props.products}
                        addToast={props.addToast}
                        onViewInOrderImport={props.onViewInOrderImport}
                    />
                )}
                {props.activeTab === 'Audit Log' && props.currentUser.role === UserRole.ADMIN && (
                    <AuditLogTab users={props.users} />
                )}
                {props.activeTab === 'System Health' && props.currentUser.role === UserRole.ADMIN && (
                    <SystemHealthTab />
                )}
            </div>
            </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default AdminView;