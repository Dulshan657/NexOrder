import React, { Suspense } from 'react';
import { UserRole, User, Product, ProductSupplierLink, HoReCa, Supplier, Order, AppSettings, Invoice, OrderStatus, SalesTarget, Promotion, Visit, ScheduledVisit } from '../types';
import { LoadingSkeleton } from './Skeleton';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import ProductAdmin from './ProductAdmin';
import HoReCaListView from './HoReCaListView';
import UserAdmin from './UserAdmin';
import SupplierAdmin from './SupplierAdmin';
import AccountsAgingTable from './AccountsAgingTable';
import OrderImportPage from './OrderImportPage';
import WalkInReviewTab from './admin/WalkInReviewTab';

// Heavy admin views — lazy-loaded so rep/customer paths don't pull them in.
// lazyWithRetry recovers from stale chunk hashes after a redeploy.
const AdminDashboard = lazyWithRetry(() => import('./AdminDashboard'));
const PromotionAdmin = lazyWithRetry(() => import('./PromotionAdmin'));
const HoReCaInsightsPanel = lazyWithRetry(() => import('./HoReCaInsightsPanel'));
const ScheduledVisitsAdmin = lazyWithRetry(() => import('./admin/ScheduledVisitsAdmin'));
const StockView = lazyWithRetry(() => import('./StockView'));
const ReceiveStockView = lazyWithRetry(() => import('./inventory/ReceiveStockView'));
const PickQueueView = lazyWithRetry(() => import('./inventory/PickQueueView'));
const PutawayQueuePage = lazyWithRetry(() => import('./inventory/PutawayQueuePage'));
const DispatchedOrdersView = lazyWithRetry(() => import('./inventory/DispatchedOrdersView'));
const DocumentsView = lazyWithRetry(() => import('./inventory/DocumentsView'));
const WarehousePage = lazyWithRetry(() => import('./inventory/warehouse/WarehousePage'));
const AuditLogTab = lazyWithRetry(() => import('./admin/AuditLogTab'));
const SystemHealthTab = lazyWithRetry(() => import('./admin/SystemHealthTab'));
const POInboxView = lazyWithRetry(() => import('./admin/POInboxView'));
const SettingsView = lazyWithRetry(() => import('./admin/settings/SettingsView'));

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

export type AdminTab = 'Dashboard' | 'Shop' | 'Products' | 'HoReCa' | 'HoReCa Insights' | 'Order Import' | 'Promotions' | 'Accounts' | 'Stock' | 'Receiving' | 'Putaway' | 'Pick Queue' | 'Dispatched' | 'Documents' | 'Warehouse' | 'Scheduled Visits' | 'Walk-in Review' | 'Users' | 'Suppliers' | 'PO Inbox' | 'Settings' | 'Audit Log' | 'System Health';

const AdminView: React.FC<AdminViewProps> = (props) => {
    const isDashboard = props.activeTab === 'Dashboard';
    // Jump from the Warehouse viewer's empty-state CTA into the Layout Designer:
    // deep-link the warehouse via ?designer= (and ?import= for the floor-plan flow),
    // then switch to Settings where WarehousesSettingsSection auto-opens it.
    const openDesigner = (warehouseId: number, opts?: { import?: boolean }) => {
        const url = new URL(window.location.href);
        url.searchParams.set('designer', String(warehouseId));
        if (opts?.import) url.searchParams.set('import', '1');
        else url.searchParams.delete('import');
        window.history.replaceState({}, '', url.toString());
        props.onSetAdminView?.('Settings');
    };
    // Post-receipt "Go to putaway" deep-link: pre-select the receipt's
    // server-resolved destination warehouse via ?wh= (PutawayQueuePage reads
    // this the same way the Warehouse viewer does) before switching tabs.
    const openPutaway = (warehouseId: number) => {
        const url = new URL(window.location.href);
        url.searchParams.set('wh', String(warehouseId));
        window.history.replaceState({}, '', url.toString());
        props.onSetAdminView?.('Putaway');
    };
    return (
        <div>
            <ErrorBoundary label={`Admin · ${props.activeTab}`}>
            <Suspense fallback={<LoadingSkeleton />}>
            <div>
                {isDashboard && <AdminDashboard allOrders={props.allOrders} products={props.products} hoReCas={props.hoReCas} users={props.users} lowStockThreshold={props.appSettings.lowStockThreshold} invoices={props.invoices} salesTargets={props.salesTargets} onUpdateSalesTargets={props.onUpdateSalesTargets} currentUser={props.currentUser} promotions={props.promotions} visits={props.visits} routes={props.routes} onNavigateTab={props.onSetAdminView ? (tab: string) => props.onSetAdminView!(tab as AdminTab) : undefined} />}
                {props.activeTab === 'Products' && <ProductAdmin products={props.products} suppliers={props.suppliers} onAddProduct={props.onAddProduct} onUpdateProduct={props.onUpdateProduct} onDeleteProduct={props.onDeleteProduct} addToast={props.addToast} />}
                {props.activeTab === 'HoReCa' && <HoReCaListView hoReCas={props.hoReCas} orders={props.allOrders} invoices={props.invoices} currentUser={props.currentUser} visits={props.visits} onAddHoReCa={props.onAddHoReCa} onUpdateHoReCa={props.onUpdateHoReCa} onDeleteHoReCa={props.onDeleteHoReCa} />}
                {props.activeTab === 'HoReCa Insights' && <HoReCaInsightsPanel allOrders={props.allOrders} hoReCas={props.hoReCas} products={props.products} />}
                {props.activeTab === 'Order Import' && <OrderImportPage orders={props.allOrders} invoices={props.invoices} hoReCas={props.hoReCas} currentUser={props.currentUser} onReorder={props.onReorder} onViewDetail={props.onViewOrderDetail} onUpdateStatus={props.onUpdateOrderStatus} onBack={() => {}} highlightOrderId={props.highlightOrderId ?? null} onClearHighlightOrderId={props.onClearHighlightOrderId} />}
                {props.activeTab === 'Promotions' && props.currentUser.role === UserRole.ADMIN && props.promotions && props.onAddPromotion && props.onUpdatePromotion && props.onDeletePromotion && (
                    <PromotionAdmin promotions={props.promotions} products={props.products} hoReCas={props.hoReCas} users={props.users} onAdd={props.onAddPromotion} onUpdate={props.onUpdatePromotion} onDelete={props.onDeletePromotion} />
                )}
                {props.activeTab === 'Accounts' && <AccountsAgingTable invoices={props.invoices} hoReCas={props.hoReCas} currentUser={props.currentUser} />}
                {props.activeTab === 'Stock' && <StockView products={props.products} currentUser={props.currentUser} addToast={props.addToast} />}
                {props.activeTab === 'Receiving' && <ReceiveStockView products={props.products} currentUser={props.currentUser} onOpenPutaway={openPutaway} />}
                {props.activeTab === 'Putaway' && <PutawayQueuePage currentUser={props.currentUser} />}
                {props.activeTab === 'Pick Queue' && <PickQueueView currentUser={props.currentUser} />}
                {props.activeTab === 'Dispatched' && <DispatchedOrdersView orders={props.allOrders} onViewDetail={props.onViewOrderDetail} />}
                {props.activeTab === 'Documents' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER || props.currentUser.role === UserRole.WAREHOUSE) && <DocumentsView />}
                {props.activeTab === 'Warehouse' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER || props.currentUser.role === UserRole.WAREHOUSE) && <WarehousePage currentUser={props.currentUser} onOpenDesigner={props.currentUser.role === UserRole.ADMIN ? openDesigner : undefined} />}
                {props.activeTab === 'Scheduled Visits' && props.routes && props.onSetRoutes && props.addToast && (
                    <ScheduledVisitsAdmin routes={props.routes} users={props.users} hoReCas={props.hoReCas} visits={props.visits ?? []} currentUser={props.currentUser} onSetRoutes={props.onSetRoutes} addToast={props.addToast} />
                )}
                {props.activeTab === 'Walk-in Review' && (
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
                {props.activeTab === 'PO Inbox' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER) && (
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