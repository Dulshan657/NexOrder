import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AuditEventRow } from '../../services/supabase/auditService';

interface AuditMutationRowProps {
    row: AuditEventRow;
    actorName: string;
    expanded: boolean;
    onToggle: () => void;
}

const ACTION_PILL: Record<AuditEventRow['action'], string> = {
    create: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    update: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
    delete: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
};

function formatWhen(iso: string): { relative: string; absolute: string } {
    const d = new Date(iso);
    const absolute = d.toLocaleString();
    const seconds = Math.round((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return { relative: `${seconds}s ago`, absolute };
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return { relative: `${minutes}m ago`, absolute };
    const hours = Math.round(minutes / 60);
    if (hours < 24) return { relative: `${hours}h ago`, absolute };
    const days = Math.round(hours / 24);
    if (days < 30) return { relative: `${days}d ago`, absolute };
    return { relative: d.toLocaleDateString(), absolute };
}

function truncateId(id: string | null): string {
    if (!id) return '—';
    if (id.length <= 10) return id;
    return `${id.slice(0, 8)}…`;
}

interface DiffEntry {
    key: string;
    kind: 'changed' | 'added' | 'removed' | 'unchanged';
    before: unknown;
    after: unknown;
}

function computeDiff(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
): DiffEntry[] {
    const keys = new Set<string>([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
    ]);
    const entries: DiffEntry[] = [];
    for (const key of keys) {
        const b = before?.[key];
        const a = after?.[key];
        const bMissing = before == null || !(key in before);
        const aMissing = after == null || !(key in after);
        let kind: DiffEntry['kind'] = 'unchanged';
        if (bMissing && !aMissing) kind = 'added';
        else if (!bMissing && aMissing) kind = 'removed';
        else if (JSON.stringify(b) !== JSON.stringify(a)) kind = 'changed';
        entries.push({ key, kind, before: b, after: a });
    }
    // Show changed/added/removed first
    return entries.sort((x, y) => {
        const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
        return order[x.kind] - order[y.kind] || x.key.localeCompare(y.key);
    });
}

function formatValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
}

const AuditMutationRow: React.FC<AuditMutationRowProps> = memo(function AuditMutationRow({
    row,
    actorName,
    expanded,
    onToggle,
}) {
    const when = formatWhen(row.occurred_at);
    const diff = expanded ? computeDiff(row.before_data, row.after_data) : [];

    return (
        <>
            <tr
                onClick={onToggle}
                className="hover:bg-stone-50 cursor-pointer transition-colors"
            >
                <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                        <ChevronRight
                            className={`w-4 h-4 text-stone-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                        <span title={when.absolute} className="font-mono text-xs text-stone-700">
                            {when.relative}
                        </span>
                    </div>
                </td>
                <td className="px-4 py-3 text-sm">
                    <div className="text-stone-900">{actorName}</div>
                    <div className="text-xs text-stone-500">{row.actor_role}</div>
                </td>
                <td className="px-4 py-3">
                    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${ACTION_PILL[row.action]}`}>
                        {row.action}
                    </span>
                </td>
                <td className="px-4 py-3 text-sm text-stone-700">{row.resource}</td>
                <td className="px-4 py-3 text-sm">
                    <span title={row.resource_id ?? ''} className="font-mono text-xs text-stone-600">
                        {truncateId(row.resource_id)}
                    </span>
                </td>
                <td className="px-4 py-3 text-sm text-stone-600 max-w-xs truncate" title={row.reason ?? ''}>
                    {row.reason ?? '—'}
                </td>
            </tr>
            {expanded && (
                <tr className="bg-stone-50">
                    <td colSpan={6} className="pl-12 pr-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
                                    Before
                                </h4>
                                {row.before_data == null ? (
                                    <p className="text-xs italic text-stone-400">No prior state (create event).</p>
                                ) : (
                                    <dl className="space-y-1 font-mono text-xs">
                                        {diff.map(({ key, kind, before }) => (
                                            <div key={`b-${key}`} className="flex gap-2">
                                                <dt className={`shrink-0 font-medium ${kind === 'changed' || kind === 'removed' ? 'text-nexgen-blue' : 'text-stone-500'}`}>
                                                    {key}:
                                                </dt>
                                                <dd className={`flex-1 break-all whitespace-pre-wrap ${kind === 'removed' ? 'line-through text-stone-400' : 'text-stone-700'}`}>
                                                    {formatValue(before)}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                            </div>
                            <div>
                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
                                    After
                                </h4>
                                {row.after_data == null ? (
                                    <p className="text-xs italic text-stone-400">No subsequent state (delete event).</p>
                                ) : (
                                    <dl className="space-y-1 font-mono text-xs">
                                        {diff.map(({ key, kind, after }) => (
                                            <div key={`a-${key}`} className="flex gap-2">
                                                <dt className={`shrink-0 font-medium ${kind === 'changed' || kind === 'added' ? 'text-nexgen-blue' : 'text-stone-500'}`}>
                                                    {key}:
                                                </dt>
                                                <dd className={`flex-1 break-all whitespace-pre-wrap ${kind === 'added' ? 'text-emerald-700 bg-emerald-50/60 px-1 rounded' : kind === 'changed' ? 'text-nexgen-blue bg-nexgen-blue/5 px-1 rounded' : 'text-stone-700'}`}>
                                                    {formatValue(after)}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                            </div>
                        </div>
                        {row.reason && (
                            <p className="mt-4 text-xs italic text-stone-600">
                                <span className="not-italic font-semibold uppercase tracking-wider text-[10px] text-stone-500 mr-2">
                                    Reason
                                </span>
                                {row.reason}
                            </p>
                        )}
                    </td>
                </tr>
            )}
        </>
    );
});

export default AuditMutationRow;
