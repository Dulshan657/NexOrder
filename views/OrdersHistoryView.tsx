import React, { useCallback } from 'react';
import { UserRole, type HoReCa, type Invoice, type Order, type OrderItem, type OrderStatus, type User } from '../types';
import OrderHistory from '../components/OrderHistory';
import OrderImportPage from '../components/OrderImportPage';

export interface OrdersHistoryViewProps {
    orders: Order[];
    hoReCas: HoReCa[];
    invoices: Invoice[];
    currentUser: User;
    onReorder: (order: Order) => void;
    onReorderItems: (items: OrderItem[], mode: 'replace' | 'merge') => void;
    onResetOrder: () => void;
    onSelectOrder: (id: string | null) => void;
    onUpdateStatus?: (orderId: string, newStatus: OrderStatus, note?: string) => void;
    onNavigateToShop: () => void;
    onNavigateBack: () => void;
}

const OrdersHistoryView: React.FC<OrdersHistoryViewProps> = ({
    orders,
    hoReCas,
    invoices,
    currentUser,
    onReorder,
    onReorderItems,
    onResetOrder,
    onSelectOrder,
    onUpdateStatus,
    onNavigateToShop,
    onNavigateBack,
}) => {
    const isCustomer = currentUser.role === UserRole.CUSTOMER;

    const handleBulkReorder = useCallback(
        (selectedOrders: Order[]) => {
            onResetOrder();
            const merged: OrderItem[] = [];
            for (const order of selectedOrders) {
                for (const item of order.items) {
                    const existing = merged.find(i => i.id === item.id && i.packSize === item.packSize);
                    if (existing) {
                        existing.quantity += item.quantity;
                    } else {
                        merged.push({ ...item });
                    }
                }
            }
            onReorderItems(merged, 'replace');
            onNavigateToShop();
        },
        [onResetOrder, onReorderItems, onNavigateToShop],
    );

    if (isCustomer) {
        return (
            <OrderHistory
                orders={orders}
                hoReCas={hoReCas}
                invoices={invoices}
                currentUser={currentUser}
                onReorder={onReorder}
                onBulkReorder={handleBulkReorder}
                onViewDetail={onSelectOrder}
                onBack={onNavigateToShop}
            />
        );
    }

    return (
        <OrderImportPage
            orders={orders}
            hoReCas={hoReCas}
            invoices={invoices}
            currentUser={currentUser}
            onReorder={onReorder}
            onBulkReorder={handleBulkReorder}
            onViewDetail={onSelectOrder}
            onUpdateStatus={onUpdateStatus}
            onBack={onNavigateBack}
        />
    );
};

export default OrdersHistoryView;
