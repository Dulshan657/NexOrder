import React, { useMemo, useState, useCallback } from 'react';
import {
    RefreshCw,
    Download,
    ChevronLeft,
    ChevronRight as ChevronRightIcon,
    AlertTriangle,
    ScrollText,
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

    // Filter object for the active mode. Identity changes invalidate the
    // TanStack query cache key, so memoise per-input.
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

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                    <div className="hidden sm:flex w-10 h-10 rounded-lg bg-nexgen-blue/10 items-center justify-center shrink-0">
                        <ScrollText className="w-5 h-5 text-nexgen-blue" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Audit log</h2>
                        <p className="text-sm text-stone-500">
                            {isLoading ? 'Loading…' : `${total.toLocaleString()} ${mode === 'mutations' ? 'mutation events' : 'client errors'}`}
                            {isFetching && !isLoading ? ' · refreshing' : ''}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Segmented mode toggle */}
                    <div className="inline-flex bg-stone-100 rounded-lg p-1">
                        <button
                            type="button"
                            onClick={() => handleSwitchMode('mutations')}
                            className={`text-sm px-3 py-1.5 rounded-md transition-colors btn-press ${
                                mode === 'mutations'
                                    ? 'bg-white text-stone-900 shadow-sm'
                                    : 'text-stone-600 hover:text-stone-900'
                            }`}
                        >
                            Mutations
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSwitchMode('errors')}
                            className={`text-sm px-3 py-1.5 rounded-md transition-colors btn-press ${
                                mode === 'errors'
                                    ? 'bg-white text-stone-900 shadow-sm'
                                    : 'text-stone-600 hover:text-stone-900'
                            }`}
                        >
                            Errors
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isFetching}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 disabled:opacity-60 btn-press"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={handleDownloadCsv}
                        disabled={total === 0}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 btn-press"
                        title="Download visible page as CSV"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Filter row */}
            <div className="bg-stone-50 rounded-xl border border-stone-100 p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">From</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
                            className="text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">To</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => { setToDate(e.target.value); setPage(0); }}
                            className="text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Actor</span>
                        <select
                            value={actorId}
                            onChange={(e) => { setActorId(e.target.value); setPage(0); }}
                            className="text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                        >
                            <option value="">All actors</option>
                            {users.map((u) => (
                                <option key={u.id} value={numericIdToUuid(u.id)}>
                                    {u.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {mode === 'mutations' && (
                        <>
                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Resource</span>
                                <select
                                    value={resource}
                                    onChange={(e) => { setResource(e.target.value); setPage(0); }}
                                    className="text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                                >
                                    <option value="">All resources</option>
                                    {KNOWN_RESOURCES.map((r) => (
                                        <option key={r} value={r}>
                                            {r}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Action</span>
                                <select
                                    value={action}
                                    onChange={(e) => { setAction(e.target.value as AuditAction | ''); setPage(0); }}
                                    className="text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                                >
                                    <option value="">All actions</option>
                                    {KNOWN_ACTIONS.map((a) => (
                                        <option key={a} value={a}>
                                            {a}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </>
                    )}
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Search</span>
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                            placeholder={mode === 'mutations' ? 'Reason or resource ID…' : 'Message or URL…'}
                            className="text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                        />
                    </label>
                </div>
                {hasFilters && (
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            onClick={handleClearFilters}
                            className="text-xs text-nexgen-blue hover:underline btn-press"
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
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
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
                            <tbody className="divide-y divide-stone-100">
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
                    </div>
                    {!isLoading && total === 0 && (
                        <EmptyState onClear={hasFilters ? handleClearFilters : undefined} mode={mode} />
                    )}
                </div>
            )}

            {/* Pagination */}
            {!queryError && total > 0 && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-stone-500 font-mono">
                        Showing {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0 || isFetching}
                            className="inline-flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-md bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 disabled:opacity-50 btn-press"
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
                            className="inline-flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-md bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 disabled:opacity-50 btn-press"
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
    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
        {children}
    </th>
);

const SkeletonRows: React.FC<{ columns: number }> = ({ columns }) => (
    <>
        {Array.from({ length: 12 }).map((_, i) => (
            <tr key={i}>
                {Array.from({ length: columns }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-stone-100 rounded animate-pulse" style={{ width: `${50 + ((i + j) % 5) * 10}%` }} />
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
    <div className="p-12 text-center">
        <p className="text-stone-500">
            {mode === 'mutations'
                ? 'No mutation events match these filters.'
                : 'No client errors match these filters.'}
        </p>
        {onClear && (
            <button
                type="button"
                onClick={onClear}
                className="mt-3 text-sm text-nexgen-blue hover:underline btn-press"
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
    <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-900">
        <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="font-semibold mb-1">Could not load audit log</p>
                <p className="text-sm text-rose-800/80 mb-3">{error.message}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-white text-rose-900 ring-1 ring-inset ring-rose-200 hover:bg-rose-100 btn-press"
                >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                </button>
            </div>
        </div>
    </div>
);

export default AuditLogTab;
