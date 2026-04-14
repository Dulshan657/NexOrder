import React from 'react';
import type { OrderStatus, StatusHistoryEntry } from '../types';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, ORDER_STATUS_SEQUENCE } from '../constants';
import { Check } from 'lucide-react';

interface StatusTimelineProps {
    statusHistory: StatusHistoryEntry[];
    currentStatus: OrderStatus;
}

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' at ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
};

const StatusTimeline: React.FC<StatusTimelineProps> = ({ statusHistory, currentStatus }) => {
    const currentIdx = ORDER_STATUS_SEQUENCE.indexOf(currentStatus);
    const historyMap = new Map(statusHistory.map(h => [h.status, h]));

    return (
        <div className="space-y-0">
            {ORDER_STATUS_SEQUENCE.map((status, idx) => {
                const entry = historyMap.get(status);
                const isReached = idx <= currentIdx;
                const isCurrent = status === currentStatus;
                const isLast = idx === ORDER_STATUS_SEQUENCE.length - 1;
                const colors = ORDER_STATUS_COLORS[status];

                return (
                    <div key={status} className="flex gap-3">
                        {/* Timeline dot and line */}
                        <div className="flex flex-col items-center">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                                isReached
                                    ? `${colors.bg} ${colors.border} ${colors.text}`
                                    : 'bg-stone-50 border-stone-200 text-stone-300'
                            }`}>
                                {isReached ? (
                                    <Check className="w-3.5 h-3.5" />
                                ) : (
                                    <span className="w-2 h-2 rounded-full bg-stone-200" />
                                )}
                            </div>
                            {!isLast && (
                                <div className={`w-0.5 h-8 ${isReached && idx < currentIdx ? colors.bg.replace('bg-', 'bg-') : 'bg-stone-200'}`} />
                            )}
                        </div>

                        {/* Content */}
                        <div className={`pb-6 ${isLast ? 'pb-0' : ''}`}>
                            <p className={`text-sm font-medium ${isReached ? 'text-stone-900' : 'text-stone-400'}`}>
                                {ORDER_STATUS_LABELS[status]}
                                {isCurrent && <span className="ml-2 text-xs font-normal text-stone-500">(current)</span>}
                            </p>
                            {entry && (
                                <>
                                    <p className="text-xs text-stone-500 mt-0.5">{formatDate(entry.timestamp)}</p>
                                    {entry.note && <p className="text-xs text-stone-600 mt-1 italic">"{entry.note}"</p>}
                                </>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default StatusTimeline;
