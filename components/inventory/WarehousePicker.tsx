// WarehousePicker — the one reusable control for the shared warehouse scope
// (see context/WarehouseScopeContext.tsx). Pinned (Warehouse role) users get a
// read-only site label; everyone else gets a plain inline <select>. This is
// not a hand-rolled overlay, so scripts/check-overlays.mjs has no concern
// with it — no backdrop, no portal, just an inline control.

import React from 'react';
import { Lock } from 'lucide-react';
import { useWarehouseScope } from '../../context/WarehouseScopeContext';

export interface WarehousePickerProps {
    className?: string;
    /** Suppress the 'All warehouses' option even for roles that can select it. */
    showAllOption?: boolean;
    /**
     * Display-only fallback used when `scope === 'all'` but this instance of
     * the picker still needs to show a specific site selected (e.g. the
     * Warehouse/Putaway tabs, which locally default off the shared 'all'
     * scope without writing back to it). Ignored once `scope` is a real
     * warehouse id. Has no effect on `onChange`, which still calls
     * `setScope(Number(...))` — selecting a site always writes back to the
     * shared scope.
     */
    effectiveId?: number;
}

export function WarehousePicker({ className, showAllOption = true, effectiveId }: WarehousePickerProps) {
    const { scope, setScope, isPinned, canSelectAll, activeWarehouses, scopeLabel } = useWarehouseScope();

    if (isPinned) {
        return (
            <span className={`inline-flex items-center gap-1.5 text-sm text-stone-600 ${className ?? ''}`}>
                <Lock className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
                <span className="font-medium">Warehouse: {scopeLabel}</span>
            </span>
        );
    }

    const showAllWarehousesOption = canSelectAll && showAllOption;
    const selectValue = scope === 'all' ? (effectiveId != null ? String(effectiveId) : '') : String(scope);

    return (
        <select
            aria-label="Warehouse scope"
            value={selectValue}
            onChange={e => setScope(e.target.value ? Number(e.target.value) : 'all')}
            className={`text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 ${className ?? ''}`}
        >
            {showAllWarehousesOption && <option value="">All warehouses</option>}
            {activeWarehouses.map(w => (
                <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                </option>
            ))}
        </select>
    );
}

export default WarehousePicker;
