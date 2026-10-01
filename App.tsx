// App.tsx — data root + provider mounts.
// All UI state, render tree, cart, and pantry logic live in components/AppShell.tsx.
import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { useToastActions } from './hooks/useToasts';
import { numericIdForProfile, profileToUser } from './lib/profileToUser';
import { DEFAULT_SETTINGS } from './constants';
import AppShell from './components/AppShell';

// ── Query hooks ───────────────────────────────────────────────────────────────
import { useProducts } from './hooks/queries/useProducts';
import { useHoReCas } from './hooks/queries/useHoReCas';
import { useOrders, usePlaceOrder } from './hooks/queries/useOrders';
import { useInvoices } from './hooks/queries/useInvoices';
import { useSuppliers } from './hooks/queries/useSuppliers';
import { usePromotions } from './hooks/queries/usePromotions';
import { useScheduledVisits } from './hooks/queries/useScheduledVisits';
import { useVisits } from './hooks/queries/useVisits';
import { useSalesTargets } from './hooks/queries/useSalesTargets';
import { useSettings } from './hooks/queries/useSettings';
import { useNotifications } from './hooks/queries/useNotifications';
import { useProfiles } from './hooks/queries/useProfiles';
import { useRealtimeSubscriptions } from './hooks/useRealtimeSubscriptions';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { setUserIdMap } from './lib/userIdMap';

// ── Adapters ──────────────────────────────────────────────────────────────────
import {
    toProduct, toHoReCa, toOrders, toInvoice, toSupplier,
    toPromotion, toScheduledVisit, toVisit, toSalesTarget, toAppSettings, toNotification,
} from './lib/adapters';
import { summariseQueries } from './lib/queryHealth';
import { appDataNeeds } from './lib/appDataNeeds';

// Shared fallback for lists that have not loaded; see the note in App.
const EMPTY: never[] = [];

const App: React.FC = () => {
    // ── Auth ──────────────────────────────────────────────────────────────────
    // AuthGate above this component guarantees user + profile are non-null by
    // the time App renders, so the non-null assertions are safe.
    const auth = useAuth();
    const currentUser = useMemo(() => profileToUser(auth.profile!), [auth.profile]);
    const currentUserUuid = auth.user?.id ?? '';
    const queryClient = useQueryClient();
    const { addToast } = useToastActions();

    // Subscribe to Supabase postgres_changes so orders / notifications /
    // products stay live without polling. RLS filters per-user automatically.
    // Admin/Manager additionally subscribe to PO Inbox tables via a
    // separate channel; reps + customers never receive those events.
    useRealtimeSubscriptions({ userId: currentUserUuid, role: currentUser.role });

    // Auto-signout after 30 minutes of inactivity.
    useIdleTimeout({
        enabled: !!currentUserUuid,
        onIdle: async () => {
            try {
                await auth.signOut();
                addToast('Signed out due to inactivity', 'info');
            } catch (err) {
                console.warn('Idle signOut failed:', err);
            }
        },
    });

    // ── Server state — Supabase query hooks ───────────────────────────────────
    const productsQuery = useProducts();
    const hoReCasQuery = useHoReCas();
    const ordersQuery = useOrders();
    // Only what this role can ever display (lib/appDataNeeds.ts).
    const needs = useMemo(() => appDataNeeds(currentUser.role), [currentUser.role]);
    const invoicesQuery = useInvoices({}, { enabled: needs.invoices });
    const suppliersQuery = useSuppliers({ enabled: needs.suppliers });
    const promotionsQuery = usePromotions({ enabled: needs.promotions });
    const routesQuery = useScheduledVisits({}, { enabled: needs.routes });
    const visitsQuery = useVisits({}, { enabled: needs.visits });
    const profilesQuery = useProfiles({ enabled: needs.users });
    const salesTargetsQuery = useSalesTargets(undefined, { enabled: needs.salesTargets });
    const settingsQuery = useSettings();
    const notificationsQuery = useNotifications(currentUserUuid, currentUser.role);

    // One shared empty array: a fresh `[]` per render would re-run every
    // adapter memo below on every render until the data arrives.
    const rawProducts = productsQuery.data ?? EMPTY;
    const rawHoReCas = hoReCasQuery.data ?? EMPTY;
    const rawOrders = ordersQuery.data ?? EMPTY;
    const rawInvoices = invoicesQuery.data ?? EMPTY;
    const rawSuppliers = suppliersQuery.data ?? EMPTY;
    const rawPromotions = promotionsQuery.data ?? EMPTY;
    const rawRoutes = routesQuery.data ?? EMPTY;
    const rawVisits = visitsQuery.data ?? EMPTY;
    // A role that may not list profiles (RLS returns only its own row anyway)
    // gets the signed-in profile, so order "submitted by" names and the
    // numeric-id registry below are exactly what the query used to produce.
    const ownProfileOnly = useMemo(() => (auth.profile ? [auth.profile] : EMPTY), [auth.profile]);
    const rawProfiles = needs.users ? profilesQuery.data ?? EMPTY : ownProfileOnly;
    const rawSalesTargets = salesTargetsQuery.data ?? EMPTY;
    const rawSettings = settingsQuery.data;
    const rawNotifications = notificationsQuery.data ?? EMPTY;

    // Failed / first-loading lists, so AppShell can say so instead of letting
    // a failure pass as an empty state. Settings has a default and is omitted.
    const dataQueries = [
        { label: 'orders', query: ordersQuery },
        { label: 'products', query: productsQuery },
        { label: 'customers', query: hoReCasQuery },
        { label: 'invoices', query: invoicesQuery },
        { label: 'suppliers', query: suppliersQuery },
        { label: 'promotions', query: promotionsQuery },
        { label: 'routes', query: routesQuery },
        { label: 'visits', query: visitsQuery },
        { label: 'users', query: profilesQuery },
        { label: 'sales targets', query: salesTargetsQuery },
        { label: 'notifications', query: notificationsQuery },
    ];
    const dataStatus = summariseQueries(dataQueries);
    const dataStatusKey = `${dataStatus.failed.join()}|${dataStatus.loading.join()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const stableDataStatus = useMemo(() => dataStatus, [dataStatusKey]);
    const retryFailedData = () => {
        for (const { query } of dataQueries) if (query.isError) void query.refetch();
    };

    // Populate the numeric-id → real-profile-UUID registry used by adapters.
    //
    // Built from EVERY profile, using the same derivation profileToUser() uses.
    // It previously walked the seeded USERS roster and matched by email, which
    // registered only accounts that happened to be seeded — so on any database
    // without them (i.e. a client's) the registry was empty and every
    // numericIdToUuid() call fell through to the 00000000-… placeholder.
    useEffect(() => {
        if (!rawProfiles.length) return;
        const entries: Array<[number, string]> = [];
        const seen = new Map<number, string>();
        for (const p of rawProfiles) {
            const id = numericIdForProfile(p.id);
            const clash = seen.get(id);
            if (clash) {
                // Two UUIDs hashed into the same slot. Rare (10,000 slots), but
                // it would silently merge two people, so say so rather than let
                // it be discovered as "the audit log blames the wrong user".
                // eslint-disable-next-line no-console
                console.error(`[userIdMap] numeric id ${id} collides: ${clash} and ${p.id}`);
                continue;
            }
            seen.set(id, p.id);
            entries.push([id, p.id]);
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

    // Users are derived from real profiles. Empty during the brief boot window
    // before profiles load — it used to fall back to the seeded demo roster,
    // which on a client's deployment named six people who do not work there.
    const users = useMemo(() => rawProfiles.map(profileToUser), [rawProfiles]);

    // Orders embed hoReCa, user, and product objects
    const allOrders = useMemo(
        () => toOrders(rawOrders, hoReCas, users, products),
        [rawOrders, hoReCas, users, products],
    );

    // ── Mutation hooks ────────────────────────────────────────────────────────
    const placeOrderMutation = usePlaceOrder();

    return (
        <AppShell
            dataStatus={stableDataStatus}
            onRetryData={retryFailedData}
            currentUser={currentUser}
            currentUserUuid={currentUserUuid}
            products={products}
            hoReCas={hoReCas}
            allOrders={allOrders}
            invoices={invoices}
            suppliers={suppliers}
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
