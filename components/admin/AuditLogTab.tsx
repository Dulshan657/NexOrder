import React, { useMemo, useState, useCallback } from 'react';
import {
    RefreshCw,
    Download,
    ChevronLeft,
    ChevronRight as ChevronRightIcon,
    AlertTriangle,
    Search,
    X,
} from 'lucide-react';
import type { User } from '../../types';
import { numericIdToUuid } from '../../lib/userIdMap';
import { downloadCsv } from '../../lib/csvExport';
import { useAuditEvents, useClientErrors } from '../../hooks/queries/useAudit';
import type {
    AuditEventRow,
    ClientErrorRow,
    AuditAction,
} from '../../services/supabase/auditService';
import AuditMutationRow from './AuditMutationRow';
import AuditErrorRow from './AuditErrorRow';

const PAGE_SIZE = 50;

const KNOWN_RESOURCES = [
    'app_settings',
    'promotion',
    'horeca',
    'product',
    'supplier',
    'purchase_order',
    'sales_target',
    'pantry_item',
];

const KNOWN_ACTIONS: AuditAction[] = ['create', 'update', 'delete'];

type Mode = 'mutations' | 'errors';

interface AuditLogTabProps {
    users: User[];
}

const AuditLogTab: React.FC<AuditLogTabProps> = ({ users }) => {
    const [mode, setMode] = useState<Mode>('mutations');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [actorId, setActorId] = useState('');
    const [resource, setResource] = useState('');
    const [action, setAction] = useState<'' | AuditAction>('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // UUID → user lookup. Pre-built once for the lifetime of the prop array.
    const actorMap = useMemo(() => {
        const m = new Map<string, User>();
        for (const u of users) m.set(numericIdToUuid(u.id), u);
        return m;
    }, [users]);

    const mutationFilters = useMemo(
        () => ({
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
            actorId: actorId || undefined,
            resource: resource || undefined,
            action: (action || undefined) as AuditAction | undefined,
            search: search.trim() || undefined,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        }),
        [fromDate, toDate, actorId, resource, action, search, page],
    );

    const errorFilters = useMemo(
        () => ({
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
            actorId: actorId || undefined,
            search: search.trim() || undefined,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        }),
        [fromDate, toDate, actorId, search, page],
    );

    const mutationsQuery = useAuditEvents(mutationFilters);
    const errorsQuery = useClientErrors(errorFilters);

    const activeQuery = mode === 'mutations' ? mutationsQuery : errorsQuery;
    const total = activeQuery.data?.total ?? 0;
    const isLoading = activeQuery.isLoading;
    const isFetching = activeQuery.isFetching;
    const queryError = activeQuery.error;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const handleSwitchMode = useCallback((next: Mode) => {
        setMode(next);
        setPage(0);
        setExpandedId(null);
    }, []);

    const handleClearFilters = useCallback(() => {
        setFromDate('');
        setToDate('');
        setActorId('');
        setResource('');
        setAction('');
        setSearch('');
        setPage(0);
    }, []);

    const handleRefresh = useCallback(() => {
        void activeQuery.refetch();
    }, [activeQuery]);

    const actorNameFor = useCallback(
        (uuid: string | null): string => {
            if (!uuid) return 'Anonymous (pre-auth)';
            return actorMap.get(uuid)?.name ?? 'Unknown user';
        },
        [actorMap],
    );

    const handleDownloadCsv = useCallback(() => {
        const today = new Date().toISOString().slice(0, 10);
        if (mode === 'mutations') {
            const rows = (mutationsQuery.data?.rows ?? []) as AuditEventRow[];
            const csvRows = rows.map((r) => [
                new Date(r.occurred_at).toISOString(),
                actorNameFor(r.actor_id),
                r.actor_role,
                r.action,
                r.resource,
                r.resource_id ?? '',
                r.reason ?? '',
            ]);
            downloadCsv(
                ['When', 'Actor', 'Role', 'Action', 'Resource', 'Resource ID', 'Reason'],
                csvRows,
                `audit-mutations-${today}.csv`,
            );
        } else {
            const rows = (errorsQuery.data?.rows ?? []) as ClientErrorRow[];
            const csvRows = rows.map((r) => [
                new Date(r.occurred_at).toISOString(),
                actorNameFor(r.actor_id),
                r.actor_role ?? '',
                r.message,
                r.url ?? '',
                r.user_agent ?? '',
            ]);
            downloadCsv(
                ['When', 'Actor', 'Role', 'Message', 'URL', 'UserAgent'],
                csvRows,
                `audit-errors-${today}.csv`,
            );
        }
    }, [mode, mutationsQuery.data, errorsQuery.data, actorNameFor]);

    const hasFilters = !!(fromDate || toDate || actorId || resource || action || search);

    const totalLabel = mode === 'mutations' ? 'mutation events' : 'client errors';

    const inputClass =
        'w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue';
    const selectClass =
        'w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue cursor-pointer';

    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Audit Log</h1>
                    <p className="text-xs text-stone-500 mt-0.5">
                        {isLoading
                            ? 'Loading…'
                            : `${total.toLocaleString()} ${totalLabel}`}
                        {isFetching && !isLoading ? ' · refreshing' : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isFetching}
                        className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 text-sm font-medium transition-colors disabled:opacity-60 cursor-pointer btn-press"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={handleDownloadCsv}
                        disabled={total === 0}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-50 cursor-pointer btn-press"
                        title="Download visible page as CSV"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Mode chips */}
            <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                    type="button"
                    onClick={() => handleSwitchMode('mutations')}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        mode === 'mutations'
                            ? 'bg-nexgen-blue text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                >
                    Mutations
                </button>
                <button
                    type="button"
                    onClick={() => handleSwitchMode('errors')}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        mode === 'errors'
                            ? 'bg-nexgen-blue text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                >
                    Errors
                </button>
            </div>

            {/* Filters */}
            <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                    <div className="lg:col-span-2">
                        <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">From</label>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
                            className={inputClass}
                        />
                    </div>
                    <div className="lg:col-span-2">
                        <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">To</label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => { setToDate(e.target.value); setPage(0); }}
                            className={inputClass}
                        />
                    </div>
                    <div className="lg:col-span-3">
                        <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Actor</label>
                        <select
                            value={actorId}
                            onChange={(e) => { setActorId(e.target.value); setPage(0); }}
                            className={selectClass}
                        >
                            <option value="">All actors</option>
                            {users.map((u) => (
                                <option key={u.id} value={numericIdToUuid(u.id)}>
                                    {u.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {mode === 'mutations' ? (
                        <>
                            <div className="lg:col-span-2">
                                <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Resource</label>
                                <select
                                    value={resource}
                                    onChange={(e) => { setResource(e.target.value); setPage(0); }}
                                    className={selectClass}
                                >
                                    <option value="">All resources</option>
                                    {KNOWN_RESOURCES.map((r) => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="lg:col-span-3">
                                <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Action</label>
                                <select
                                    value={action}
                                    onChange={(e) => { setAction(e.target.value as AuditAction | ''); setPage(0); }}
                                    className={selectClass}
                                >
                                    <option value="">All actions</option>
                                    {KNOWN_ACTIONS.map((a) => (
                                        <option key={a} value={a}>{a}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    ) : (
                        <div className="lg:col-span-5" />
                    )}
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                        placeholder={mode === 'mutations' ? 'Search reason or resource ID…' : 'Search message or URL…'}
                        className="w-full pl-10 pr-10 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => { setSearch(''); setPage(0); }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-600 cursor-pointer"
                            aria-label="Clear search"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
                {hasFilters && (
                    <div className="flex justify-between items-center">
                        <p className="text-xs text-stone-500">
                            {total.toLocaleString()} matching {totalLabel}
                        </p>
                        <button
                            type="button"
                            onClick={handleClearFilters}
                            className="text-xs font-medium text-nexgen-blue hover:text-nexgen-blue/80 cursor-pointer"
                        >
                            Clear filters
                        </button>
                    </div>
                )}
            </div>

            {/* Table or state */}
            {queryError ? (
                <ErrorState error={queryError as Error} onRetry={handleRefresh} />
            ) : (
                <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-card">
                    <table className="min-w-full divide-y divide-stone-200">
                        <thead className="bg-stone-50">
                            {mode === 'mutations' ? (
                                <tr>
                                    <Th>When</Th>
                                    <Th>Actor</Th>
                                    <Th>Action</Th>
                                    <Th>Resource</Th>
                                    <Th>Resource ID</Th>
                                    <Th>Reason</Th>
                                </tr>
                            ) : (
                                <tr>
                                    <Th>When</Th>
                                    <Th>Actor</Th>
                                    <Th>Message</Th>
                                    <Th>URL</Th>
                                </tr>
                            )}
                        </thead>
                        <tbody className="bg-white divide-y divide-stone-200">
                            {isLoading ? (
                                <SkeletonRows columns={mode === 'mutations' ? 6 : 4} />
                            ) : mode === 'mutations' ? (
                                (mutationsQuery.data?.rows ?? []).map((row) => (
                                    <AuditMutationRow
                                        key={row.id}
                                        row={row}
                                        actorName={actorNameFor(row.actor_id)}
                                        expanded={expandedId === row.id}
                                        onToggle={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                                    />
                                ))
                            ) : (
                                (errorsQuery.data?.rows ?? []).map((row) => (
                                    <AuditErrorRow
                                        key={row.id}
                                        row={row}
                                        actorName={actorNameFor(row.actor_id)}
                                        expanded={expandedId === row.id}
                                        onToggle={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                    {!isLoading && total === 0 && (
                        <EmptyState onClear={hasFilters ? handleClearFilters : undefined} mode={mode} />
                    )}
                </div>
            )}

            {/* Pagination */}
            {!queryError && total > 0 && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-stone-500 font-mono text-xs">
                        Showing {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0 || isFetching}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer btn-press"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Prev
                        </button>
                        <span className="text-stone-500 px-2 font-mono text-xs">
                            {page + 1} / {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage((p) => p + 1)}
                            disabled={page + 1 >= totalPages || isFetching}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer btn-press"
                        >
                            Next
                            <ChevronRightIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <th
        scope="col"
        className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider"
    >
        {children}
    </th>
);

const SkeletonRows: React.FC<{ columns: number }> = ({ columns }) => (
    <>
        {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i}>
                {Array.from({ length: columns }).map((__, j) => (
                    <td key={j} className="px-6 py-4">
                        <div
                            className="h-4 bg-stone-100 rounded animate-pulse"
                            style={{ width: `${50 + ((i + j) % 5) * 10}%` }}
                        />
                    </td>
                ))}
            </tr>
        ))}
    </>
);

interface EmptyStateProps {
    mode: Mode;
    onClear?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ mode, onClear }) => (
    <div className="bg-white p-12 text-center">
        <p className="text-stone-500">
            {mode === 'mutations'
                ? 'No mutation events match these filters.'
                : 'No client errors match these filters.'}
        </p>
        {onClear && (
            <button
                type="button"
                onClick={onClear}
                className="mt-3 text-sm font-medium text-nexgen-blue hover:text-nexgen-blue/80 cursor-pointer"
            >
                Clear filters
            </button>
        )}
    </div>
);

interface ErrorStateProps {
    error: Error;
    onRetry: () => void;
}

const ErrorState: React.FC<ErrorStateProps> = ({ error, onRetry }) => (
    <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-900 shadow-card">
        <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="font-semibold mb-1">Could not load audit log</p>
                <p className="text-sm text-red-800/80 mb-3">{error.message}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-red-900 border border-red-200 hover:bg-red-100 text-sm font-medium transition-colors cursor-pointer btn-press"
                >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                </button>
            </div>
        </div>
    </div>
);

export default AuditLogTab;
