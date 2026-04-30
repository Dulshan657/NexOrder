import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ClientErrorRow } from '../../services/supabase/auditService';

interface AuditErrorRowProps {
    row: ClientErrorRow;
    actorName: string;
    expanded: boolean;
    onToggle: () => void;
}

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

const AuditErrorRow: React.FC<AuditErrorRowProps> = memo(function AuditErrorRow({
    row,
    actorName,
    expanded,
    onToggle,
}) {
    const when = formatWhen(row.occurred_at);
    const metadataEntries = Object.entries(row.metadata ?? {});

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
                    {row.actor_role && (
                        <div className="text-xs text-stone-500">{row.actor_role}</div>
                    )}
                </td>
                <td className="px-4 py-3 text-sm text-stone-700 max-w-md truncate" title={row.message}>
                    {row.message}
                </td>
                <td className="px-4 py-3 text-sm max-w-xs truncate" title={row.url ?? ''}>
                    <span className="font-mono text-xs text-stone-500">{row.url ?? '—'}</span>
                </td>
            </tr>
            {expanded && (
                <tr className="bg-stone-50">
                    <td colSpan={4} className="pl-12 pr-6 py-4 space-y-4">
                        {row.stack && (
                            <div>
                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
                                    Stack
                                </h4>
                                <pre className="font-mono text-xs text-stone-700 bg-white border border-stone-200 rounded-md p-3 whitespace-pre-wrap break-words">
                                    {row.stack}
                                </pre>
                            </div>
                        )}
                        {row.component_stack && (
                            <div>
                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
                                    Component stack
                                </h4>
                                <pre className="font-mono text-xs text-stone-700 bg-white border border-stone-200 rounded-md p-3 whitespace-pre-wrap break-words">
                                    {row.component_stack}
                                </pre>
                            </div>
                        )}
                        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                            {row.user_agent && (
                                <>
                                    <dt className="text-stone-500">User agent</dt>
                                    <dd className="text-stone-700 break-all">{row.user_agent}</dd>
                                </>
                            )}
                            {metadataEntries.map(([k, v]) => (
                                <React.Fragment key={k}>
                                    <dt className="text-stone-500">{k}</dt>
                                    <dd className="text-stone-700 break-all">
                                        {typeof v === 'string' ? v : JSON.stringify(v)}
                                    </dd>
                                </React.Fragment>
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
});

export default AuditErrorRow;
