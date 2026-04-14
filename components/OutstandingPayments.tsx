import React, { useState } from 'react';
import type { HoReCaOutstanding, AgingBucket } from '../services/accountingService';
import { AlertTriangle, ChevronDown, ChevronRight, Ban } from 'lucide-react';

interface OutstandingPaymentsProps {
    data: HoReCaOutstanding;
    compact?: boolean; // compact mode for OrderSummary sidebar
}

const BUCKET_COLORS: Record<string, { bg: string; text: string; border: string; bar: string }> = {
    current: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-400' },
    '30': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', bar: 'bg-amber-400' },
    '60': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', bar: 'bg-orange-400' },
    '90plus': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', bar: 'bg-red-500' },
};

const BucketSection: React.FC<{ bucket: AgingBucket; defaultOpen?: boolean }> = ({ bucket, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const colors = BUCKET_COLORS[bucket.key];

    if (bucket.invoices.length === 0) return null;

    return (
        <div className={`rounded-lg border ${colors.border} overflow-hidden`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between px-3 py-2 ${colors.bg} cursor-pointer`}
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span className={`text-sm font-medium ${colors.text}`}>{bucket.label}</span>
                    <span className={`text-xs ${colors.text} opacity-70`}>({bucket.invoices.length})</span>
                </div>
                <span className={`text-sm font-semibold ${colors.text}`}>${bucket.total.toFixed(2)}</span>
            </button>
            {isOpen && (
                <div className="divide-y divide-stone-100 bg-white">
                    {bucket.invoices.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div>
                                <span className="font-medium text-stone-700">{inv.id}</span>
                                <span className="text-stone-400 ml-2 text-xs">Due {new Date(inv.dueDate).toLocaleDateString()}</span>
                            </div>
                            <span className="font-semibold text-stone-900">${inv.amount.toFixed(2)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const OutstandingPayments: React.FC<OutstandingPaymentsProps> = ({ data, compact = false }) => {
    if (data.totalOutstanding === 0) return null;

    // Compact mode for OrderSummary
    if (compact) {
        return (
            <div className={`rounded-lg border p-3 ${data.isBlocked ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                    {data.isBlocked ? (
                        <Ban className="w-4 h-4 text-red-600 flex-shrink-0" />
                    ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    )}
                    <span className={`text-sm font-semibold ${data.isBlocked ? 'text-red-800' : 'text-amber-800'}`}>
                        {data.isBlocked ? 'Account Blocked' : 'Outstanding Balance'}
                    </span>
                </div>
                <p className={`text-xs ${data.isBlocked ? 'text-red-700' : 'text-amber-700'} mb-2`}>
                    {data.isBlocked
                        ? 'Payments overdue by 90+ days. Orders blocked until payment is received.'
                        : `$${data.totalOutstanding.toFixed(2)} outstanding across ${data.buckets.reduce((n, b) => n + b.invoices.length, 0)} invoice(s).`
                    }
                </p>
                {/* Compact bucket pills */}
                <div className="flex flex-wrap gap-1">
                    {data.buckets.filter(b => b.total > 0).map(b => {
                        const colors = BUCKET_COLORS[b.key];
                        return (
                            <span key={b.key} className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>
                                {b.label}: ${b.total.toFixed(0)}
                            </span>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Full mode for HoReCa detail / Accounts tab
    return (
        <div className="bg-white rounded-xl border border-stone-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-stone-900">Outstanding Payments</h4>
                    {data.isBlocked && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-200">
                            <Ban className="w-3 h-3" />
                            BLOCKED
                        </span>
                    )}
                </div>
                <span className="text-lg font-display font-bold text-stone-900">${data.totalOutstanding.toFixed(2)}</span>
            </div>

            {/* Aging bar visualization */}
            <div className="flex rounded-full h-2.5 overflow-hidden mb-4 bg-stone-100">
                {data.buckets.filter(b => b.total > 0).map(b => {
                    const colors = BUCKET_COLORS[b.key];
                    const widthPercent = (b.total / data.totalOutstanding) * 100;
                    return (
                        <div
                            key={b.key}
                            className={`${colors.bar} transition-all duration-300`}
                            style={{ width: `${widthPercent}%` }}
                            title={`${b.label}: $${b.total.toFixed(2)}`}
                        />
                    );
                })}
            </div>

            {/* Bucket breakdown */}
            <div className="space-y-2">
                {data.buckets.map(b => (
                    <BucketSection key={b.key} bucket={b} defaultOpen={b.key === '90plus' && b.invoices.length > 0} />
                ))}
            </div>
        </div>
    );
};

export default OutstandingPayments;
