import React, { Suspense } from 'react';
import { UserRole, User, Product, HoReCa, Supplier, Order, AppSettings, Invoice, OrderStatus, SalesTarget, Promotion, Visit, ScheduledVisit } from '../types';
import { LoadingSkeleton } from './Skeleton';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import ProductAdmin from './ProductAdmin';
import HoReCaListView from './HoReCaListView';
import UserAdmin from './UserAdmin';
import SupplierAdmin from './SupplierAdmin';
import SettingsPanel from './SettingsPanel';
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
const DispatchedOrdersView = lazyWithRetry(() => import('./inventory/DispatchedOrdersView'));
const DocumentsView = lazyWithRetry(() => import('./inventory/DocumentsView'));
const AuditLogTab = lazyWithRetry(() => import('./admin/AuditLogTab'));
const POInboxView = lazyWithRetry(() => import('./admin/POInboxView'));

interface AdminViewProps {
    currentUser: User;
    products: Product[];
    hoReCas: HoReCa[];
    users: User[];
    suppliers: Supplier[];
    allOrders: Order[];
    appLogo: string | null;
    appSettings: AppSettings;
    onUpdateLogo: (logo: string | null) => void;
    onSaveSettings: (settings: AppSettings) => void;
    onAddProduct: (product: Omit<Product, 'id' | 'inventory'>) => void;
    onUpdateProduct: (product: Product) => void;
    onDeleteProduct: (productId: number) => void;
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

export type AdminTab = 'Dashboard' | 'Shop' | 'Products' | 'HoReCa' | 'HoReCa Insights' | 'Order Import' | 'Promotions' | 'Accounts' | 'Stock' | 'Receiving' | 'Pick Queue' | 'Dispatched' | 'Documents' | 'Scheduled Visits' | 'Walk-in Review' | 'Users' | 'Suppliers' | 'PO Inbox' | 'Settings' | 'Audit Log';

const AdminView: React.FC<AdminViewProps> = (props) => {
    const isDashboard = props.activeTab === 'Dashboard';
    return (
        <div>
            <ErrorBoundary label={`Admin · ${props.activeTab}`}>
            <Suspense fallback={<LoadingSkeleton />}>
            <div>
                {isDashboard && <AdminDashboard allOrders={props.allOrders} products={props.products} hoReCas={props.hoReCas} users={props.users} lowStockThreshold={props.appSettings.lowStockThreshold} invoices={props.invoices} salesTargets={props.salesTargets} onUpdateSalesTargets={props.onUpdateSalesTargets} currentUser={props.currentUser} promotions={props.promotions} visits={props.visits} routes={props.routes} onNavigateTab={props.onSetAdminView ? (tab: string) => props.onSetAdminView!(tab as AdminTab) : undefined} />}
                {props.activeTab === 'Products' && <ProductAdmin products={props.products} suppliers={props.suppliers} onAddProduct={props.onAddProduct} onUpdateProduct={props.onUpdateProduct} onDeleteProduct={props.onDeleteProduct} />}
                {props.activeTab === 'HoReCa' && <HoReCaListView hoReCas={props.hoReCas} orders={props.allOrders} invoices={props.invoices} currentUser={props.currentUser} visits={props.visits} onAddHoReCa={props.onAddHoReCa} onUpdateHoReCa={props.onUpdateHoReCa} onDeleteHoReCa={props.onDeleteHoReCa} />}
                {props.activeTab === 'HoReCa Insights' && <HoReCaInsightsPanel allOrders={props.allOrders} hoReCas={props.hoReCas} products={props.products} />}
                {props.activeTab === 'Order Import' && <OrderImportPage orders={props.allOrders} invoices={props.invoices} hoReCas={props.hoReCas} currentUser={props.currentUser} onReorder={props.onReorder} onViewDetail={props.onViewOrderDetail} onUpdateStatus={props.onUpdateOrderStatus} onBack={() => {}} highlightOrderId={props.highlightOrderId ?? null} onClearHighlightOrderId={props.onClearHighlightOrderId} />}
                {props.activeTab === 'Promotions' && props.currentUser.role === UserRole.ADMIN && props.promotions && props.onAddPromotion && props.onUpdatePromotion && props.onDeletePromotion && (
                    <PromotionAdmin promotions={props.promotions} products={props.products} hoReCas={props.hoReCas} users={props.users} onAdd={props.onAddPromotion} onUpdate={props.onUpdatePromotion} onDelete={props.onDeletePromotion} />
                )}
                {props.activeTab === 'Accounts' && <AccountsAgingTable invoices={props.invoices} hoReCas={props.hoReCas} currentUser={props.currentUser} />}
                {props.activeTab === 'Stock' && <StockView products={props.products} currentUser={props.currentUser} />}
                {props.activeTab === 'Receiving' && <ReceiveStockView products={props.products} currentUser={props.currentUser} />}
                {props.activeTab === 'Pick Queue' && <PickQueueView />}
                {props.activeTab === 'Dispatched' && <DispatchedOrdersView orders={props.allOrders} onViewDetail={props.onViewOrderDetail} />}
                {props.activeTab === 'Documents' && (props.currentUser.role === UserRole.ADMIN || props.currentUser.role === UserRole.MANAGER || props.currentUser.role === UserRole.WAREHOUSE) && <DocumentsView />}
                {props.activeTab === 'Scheduled Visits' && props.routes && props.onSetRoutes && props.addToast && (
                    <ScheduledVisitsAdmin routes={props.routes} users={props.users} hoReCas={props.hoReCas} visits={props.visits ?? []} currentUser={props.currentUser} onSetRoutes={props.onSetRoutes} addToast={props.addToast} />
                )}
                {props.activeTab === 'Walk-in Review' && (
                    <WalkInReviewTab hoReCas={props.hoReCas} users={props.users} currentUser={props.currentUser} addToast={props.addToast} />
                )}
                {props.activeTab === 'Users' && props.currentUser.role === UserRole.ADMIN && <UserAdmin users={props.users} onAddUser={props.onAddUser} onUpdateUser={props.onUpdateUser} onDeleteUser={props.onDeleteUser} />}
                {props.activeTab === 'Suppliers' && props.currentUser.role === UserRole.ADMIN && <SupplierAdmin suppliers={props.suppliers} onAddSupplier={props.onAddSupplier} onUpdateSupplier={props.onUpdateSupplier} onDeleteSupplier={props.onDeleteSupplier} />}
                {props.activeTab === 'Settings' && props.currentUser.role === UserRole.ADMIN && (
                    <SettingsPanel
                        settings={props.appSettings}
                        appLogo={props.appLogo}
                        hoReCas={props.hoReCas}
                        products={props.products}
                        onSaveSettings={props.onSaveSettings}
                        onUpdateLogo={props.onUpdateLogo}
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
            </div>
            </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default AdminView;