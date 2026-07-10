// WarehouseScopeContext — the one app-wide warehouse filter (a specific site
// or 'all'), shared by Products/Stock/Dashboard/Warehouse/Putaway. See
// lib/warehouseScope.ts for the pure resolution rules this context wraps in
// React state + URL/localStorage persistence.
//
// Persistence: `?wh=<id>` (existing convention, `history.replaceState`) and
// `localStorage['nexorder.wh_scope']`. Switching to 'all' deletes `?wh=` —
// that's what lets the Warehouse/Putaway tabs fall back to their own
// resolvers instead of reading this shared scope.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { UserRole, type User, type Warehouse } from '../types';
import { useWarehouses } from '../hooks/queries/useWarehouses';
import { canSelectAll as canSelectAllForRole, resolveInitialScope, type WarehouseScope } from '../lib/warehouseScope';

const STORAGE_KEY = 'nexorder.wh_scope';

export interface WarehouseScopeValue {
    scope: WarehouseScope;
    setScope: (s: WarehouseScope) => void;
    /** True for the Warehouse role — scope is locked to their home site. */
    isPinned: boolean;
    canSelectAll: boolean;
    activeWarehouses: Warehouse[];
    /** 'All sites' | the warehouse code | '—' while warehouses are still loading. */
    scopeLabel: string;
}

interface WarehouseScopeProviderProps {
    children: React.ReactNode;
    currentUser: User;
}

const WarehouseScopeContext = createContext<WarehouseScopeValue | null>(null);

function readUrlToken(): string | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('wh');
}

function readStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        // Private-browsing modes can throw on localStorage access.
        return null;
    }
}

function writeStoredToken(scope: WarehouseScope): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, scope === 'all' ? 'all' : String(scope));
    } catch {
        // Non-fatal — persistence is a nicety, not a requirement.
    }
}

export function WarehouseScopeProvider({ children, currentUser }: WarehouseScopeProviderProps) {
    const { data: warehouses } = useWarehouses();
    const activeWarehouses = useMemo(() => (warehouses ?? []).filter(w => w.isActive), [warehouses]);

    const isPinned = currentUser.role === UserRole.WAREHOUSE;
    const canSelectAllValue = canSelectAllForRole(currentUser.role);

    // Lazy init: warehouses haven't loaded yet on first render, so
    // resolveInitialScope is called with an empty active list and accepts a
    // numeric token provisionally. The re-validation effect below corrects it
    // once the real active set arrives.
    const [scope, setScopeState] = useState<WarehouseScope>(() =>
        resolveInitialScope({
            role: currentUser.role,
            homeWarehouseId: currentUser.homeWarehouseId,
            urlToken: readUrlToken(),
            storedToken: readStoredToken(),
            activeWarehouseIds: [],
        }),
    );

    // Re-validate once the active warehouse list is populated. This is what
    // corrects a bogus `?wh=` or a scope pointing at a deactivated warehouse
    // (Admin/Manager -> 'all'), and what resolves the Warehouse role's
    // degenerate initial 'all' (home site undefined) down to home/first
    // active once real ids are known.
    useEffect(() => {
        if (activeWarehouses.length === 0) return;
        const activeIds = activeWarehouses.map(w => w.id);
        const numericNotActive = typeof scope === 'number' && !activeIds.includes(scope);
        const pinnedShowingAll = isPinned && scope === 'all';
        if (!numericNotActive && !pinnedShowingAll) return;

        const resolved = resolveInitialScope({
            role: currentUser.role,
            homeWarehouseId: currentUser.homeWarehouseId,
            urlToken: readUrlToken(),
            storedToken: readStoredToken(),
            activeWarehouseIds: activeIds,
        });
        setScopeState(resolved);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWarehouses]);

    // Sync the resolved scope back out to the URL + localStorage.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        if (typeof scope === 'number') {
            url.searchParams.set('wh', String(scope));
        } else {
            url.searchParams.delete('wh');
        }
        window.history.replaceState({}, '', url.toString());
        writeStoredToken(scope);
    }, [scope]);

    const setScope = useCallback(
        (s: WarehouseScope) => {
            if (isPinned) return; // Defensive — the picker never renders a control for this role.
            setScopeState(s);
        },
        [isPinned],
    );

    const scopeLabel = useMemo(() => {
        if (scope === 'all') return 'All sites';
        const match = activeWarehouses.find(w => w.id === scope);
        return match?.code ?? '—';
    }, [scope, activeWarehouses]);

    const value = useMemo<WarehouseScopeValue>(
        () => ({
            scope,
            setScope,
            isPinned,
            canSelectAll: canSelectAllValue,
            activeWarehouses,
            scopeLabel,
        }),
        [scope, setScope, isPinned, canSelectAllValue, activeWarehouses, scopeLabel],
    );

    return <WarehouseScopeContext.Provider value={value}>{children}</WarehouseScopeContext.Provider>;
}

export function useWarehouseScope(): WarehouseScopeValue {
    const ctx = useContext(WarehouseScopeContext);
    if (!ctx) throw new Error('useWarehouseScope must be used within a WarehouseScopeProvider');
    return ctx;
}
