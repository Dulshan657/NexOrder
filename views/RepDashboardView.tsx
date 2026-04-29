import React, { useCallback } from 'react';
import type {
    HoReCa,
    Invoice,
    Order,
    Product,
    SalesTarget,
    ScheduledVisit,
    User,
    Visit,
} from '../types';
import RepDashboardV2 from '../components/RepDashboardV2';
import { startScheduledVisit } from '../services/scheduledVisitService';

export interface RepDashboardViewProps {
    currentUser: User;
    hoReCas: HoReCa[];
    products: Product[];
    orders: Order[];
    invoices: Invoice[];
    salesTargets: SalesTarget[];
    visits: Visit[];
    routes: ScheduledVisit[];

    onStartOrder: (hoReCaId: number) => void;
    onUpdateSalesTargets: (targets: SalesTarget[]) => void;
    onSetVisits: (visits: Visit[]) => void;
    onUpdateRoute: (route: ScheduledVisit) => void;
    onSelectRoute: (scheduledVisitId: string) => void;
}

const RepDashboardView: React.FC<RepDashboardViewProps> = ({
    currentUser,
    hoReCas,
    products,
    orders,
    invoices,
    salesTargets,
    visits,
    routes,
    onStartOrder,
    onUpdateSalesTargets,
    onSetVisits,
    onUpdateRoute,
    onSelectRoute,
}) => {
    const handleStartRoute = useCallback(
        (route: ScheduledVisit) => {
            const started = startScheduledVisit(route);
            onUpdateRoute(started);
            onSelectRoute(started.id);
        },
        [onUpdateRoute, onSelectRoute],
    );

    return (
        <RepDashboardV2
            currentUser={currentUser}
            hoReCas={hoReCas}
            products={products}
            orders={orders}
            invoices={invoices}
            salesTargets={salesTargets}
            visits={visits}
            routes={routes}
            onStartOrder={onStartOrder}
            onUpdateSalesTargets={onUpdateSalesTargets}
            setVisits={onSetVisits}
            onStartRoute={handleStartRoute}
            onViewRoute={onSelectRoute}
        />
    );
};

export default RepDashboardView;
