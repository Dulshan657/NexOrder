// App.tsx — data root + provider mounts.
// All UI state, render tree, cart, and pantry logic live in components/AppShell.tsx.
import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { useToasts } from './hooks/useToasts';
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
    toProduct, toHoReCa, toOrder, toInvoice, toSupplier,
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
    const { data: rawProducts = [] } = useProducts();
    const horecasQuery = useHoReCas();
    const { data: rawHoReCas = [] } = horecasQuery;
    const { data: rawOrders = [] } = useOrders();
    const { data: rawInvoices = [] } = useInvoices();
    const { data: rawSuppliers = [] } = useSuppliers();
    const { data: rawPromotions = [] } = usePromotions();
    const { data: rawRoutes = [] } = useScheduledVisits();
    const { data: rawVisits = [] } = useVisits();
    const { data: rawProfiles = [] } = useProfiles();
    const { data: rawSalesTargets = [] } = useSalesTargets();
    const { data: rawSettings } = useSettings();
    const { data: rawNotifications = [] } = useNotifications(currentUserUuid, currentUser.role);

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

    // TEMP DIAGNOSTIC — REMOVE after the rep "only see 1 horeca" investigation is closed.
    // Logs unconditionally so we don't need a build-time env flag for the one-shot capture.
    useEffect(() => {
        // eslint-disable-next-line no-console
        console.groupCollapsed('[horeca-debug]');
        // eslint-disable-next-line no-console
        console.log('currentUser', { role: currentUser.role, hoReCaId: currentUser.hoReCaId, id: currentUser.id, email: currentUser.email });
        // eslint-disable-next-line no-console
        console.log('currentUserUuid', currentUserUuid);
        // eslint-disable-next-line no-console
        console.log('useHoReCas state', { status: horecasQuery.status, fetchStatus: horecasQuery.fetchStatus, isError: horecasQuery.isError, errorMessage: horecasQuery.error instanceof Error ? horecasQuery.error.message : null });
        // eslint-disable-next-line no-console
        console.log('rawHoReCas', {
            count: (rawHoReCas as Array<{ id: number; name: string }>).length,
            names: (rawHoReCas as Array<{ id: number; name: string }>).map(h => h.name),
            ids: (rawHoReCas as Array<{ id: number; name: string }>).map(h => h.id),
        });
        // eslint-disable-next-line no-console
        console.log('hoReCas (adapted)', { count: hoReCas.length, names: hoReCas.map(h => h.name), ids: hoReCas.map(h => h.id) });
        // eslint-disable-next-line no-console
        console.log('mode', import.meta.env.MODE);
        // eslint-disable-next-line no-console
        console.groupEnd();
    }, [currentUser, currentUserUuid, horecasQuery.status, horecasQuery.fetchStatus, horecasQuery.isError, horecasQuery.error, rawHoReCas, hoReCas]);

    // Users are derived from real profiles. Empty during the brief boot window
    // before profiles load — it used to fall back to the seeded demo roster,
    // which on a client's deployment named six people who do not work there.
    const users = useMemo(() => rawProfiles.map(profileToUser), [rawProfiles]);

    // Orders embed hoReCa, user, and product objects
    const allOrders = useMemo(
        () => rawOrders.map(o => toOrder(o, hoReCas, users, products)),
        [rawOrders, hoReCas, users, products],
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
