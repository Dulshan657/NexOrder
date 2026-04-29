// App.tsx — data root + provider mounts.
// All UI state, render tree, cart, and pantry logic live in components/AppShell.tsx.
import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { useToasts } from './hooks/useToasts';
import { profileToUser } from './lib/profileToUser';
import { USERS, DEFAULT_SETTINGS } from './constants';
import AppShell from './components/AppShell';

// ── Query hooks ───────────────────────────────────────────────────────────────
import { useProducts } from './hooks/queries/useProducts';
import { useHoReCas } from './hooks/queries/useHoReCas';
import { useOrders, usePlaceOrder } from './hooks/queries/useOrders';
import { useInvoices } from './hooks/queries/useInvoices';
import { useSuppliers } from './hooks/queries/useSuppliers';
import { usePurchaseOrders } from './hooks/queries/usePurchaseOrders';
import { usePromotions } from './hooks/queries/usePromotions';
import { useScheduledVisits } from './hooks/queries/useScheduledVisits';
import { useVisits } from './hooks/queries/useVisits';
import { useSalesTargets } from './hooks/queries/useSalesTargets';
import { useSettings } from './hooks/queries/useSettings';
import { useNotifications } from './hooks/queries/useNotifications';
import { useProfiles } from './hooks/queries/useProfiles';
import { setUserIdMap } from './lib/userIdMap';

// ── Adapters ──────────────────────────────────────────────────────────────────
import {
    toProduct, toHoReCa, toOrder, toInvoice, toSupplier, toPurchaseOrder,
    toPromotion, toScheduledVisit, toVisit, toSalesTarget, toAppSettings, toNotification,
} from './lib/adapters';

const App: React.FC = () => {
    // ── Auth ──────────────────────────────────────────────────────────────────
    // AuthGate above this component guarantees user + profile are non-null by
    // the time App renders, so the non-null assertions are safe.
    const auth = useAuth();
    const currentUser = useMemo(() => profileToUser(auth.profile!), [auth.profile]);
    const currentUserUuid = auth.user?.id ?? '';
    const queryClient = useQueryClient();
    const { addToast } = useToasts();

    // ── Server state — Supabase query hooks ───────────────────────────────────
    const { data: rawProducts = [] } = useProducts();
    const { data: rawHoReCas = [] } = useHoReCas();
    const { data: rawOrders = [] } = useOrders();
    const { data: rawInvoices = [] } = useInvoices();
    const { data: rawSuppliers = [] } = useSuppliers();
    const { data: rawPurchaseOrders = [] } = usePurchaseOrders();
    const { data: rawPromotions = [] } = usePromotions();
    const { data: rawRoutes = [] } = useScheduledVisits();
    const { data: rawVisits = [] } = useVisits();
    const { data: rawProfiles = [] } = useProfiles();
    const { data: rawSalesTargets = [] } = useSalesTargets();
    const { data: rawSettings } = useSettings();
    const { data: rawNotifications = [] } = useNotifications(currentUserUuid, currentUser.role);

    // Populate the numeric-id → real-profile-UUID registry used by adapters.
    // Falls back to deterministic UUIDs if profiles haven't loaded yet.
    useEffect(() => {
        if (!rawProfiles.length) return;
        const byEmail = new Map(rawProfiles.map(p => [p.email, p.id]));
        const entries: Array<[number, string]> = [];
        for (const u of USERS) {
            const uuid = byEmail.get(u.email);
            if (uuid) entries.push([u.id, uuid]);
        }
        setUserIdMap(entries);
    }, [rawProfiles]);

    // ── Adapt DB rows → frontend types ────────────────────────────────────────
    const products = useMemo(() => rawProducts.map(toProduct), [rawProducts]);
    const hoReCas = useMemo(() => rawHoReCas.map(toHoReCa), [rawHoReCas]);
    const suppliers = useMemo(() => rawSuppliers.map(toSupplier), [rawSuppliers]);
    const promotions = useMemo(() => rawPromotions.map(toPromotion), [rawPromotions]);
    const routes = useMemo(() => rawRoutes.map(toScheduledVisit), [rawRoutes]);
    const visits = useMemo(() => rawVisits.map(toVisit), [rawVisits]);
    const salesTargets = useMemo(() => rawSalesTargets.map(toSalesTarget), [rawSalesTargets]);
    const invoices = useMemo(() => rawInvoices.map(toInvoice), [rawInvoices]);
    const notifications = useMemo(() => rawNotifications.map(toNotification), [rawNotifications]);
    const appSettings = useMemo(
        () => (rawSettings ? toAppSettings(rawSettings) : DEFAULT_SETTINGS),
        [rawSettings],
    );

    // Users are derived from real profiles. Falls back to mock USERS during
    // the brief boot window before profiles have loaded.
    const users = useMemo(
        () => (rawProfiles.length > 0 ? rawProfiles.map(profileToUser) : USERS),
        [rawProfiles],
    );

    // Orders embed hoReCa, user, and product objects
    const allOrders = useMemo(
        () => rawOrders.map(o => toOrder(o, hoReCas, users, products)),
        [rawOrders, hoReCas, users, products],
    );

    // Purchase orders embed supplier and user objects
    const purchaseOrders = useMemo(
        () => rawPurchaseOrders.map(po => toPurchaseOrder(po, suppliers, users)),
        [rawPurchaseOrders, suppliers, users],
    );

    // ── Mutation hooks ────────────────────────────────────────────────────────
    const placeOrderMutation = usePlaceOrder();

    return (
        <AppShell
            currentUser={currentUser}
            currentUserUuid={currentUserUuid}
            products={products}
            hoReCas={hoReCas}
            allOrders={allOrders}
            invoices={invoices}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            promotions={promotions}
            salesTargets={salesTargets}
            routes={routes}
            visits={visits}
            users={users}
            appSettings={appSettings}
            notifications={notifications}
            addToast={addToast}
            placeOrderMutation={placeOrderMutation}
            queryClient={queryClient}
        />
    );
};

export default App;
