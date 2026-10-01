import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { DataStatus } from '../lib/queryHealth';

/** "orders", "orders and products", "orders, products and invoices". */
function listOf(labels: string[]): string {
    if (labels.length <= 1) return labels.join('');
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * One strip above the page content saying the screen below may be missing
 * data. Without it, a failed query rendered as an ordinary empty state.
 */
const DataStatusBanner: React.FC<{ status: DataStatus; onRetry: () => void }> = ({ status, onRetry }) => {
    if (status.failed.length > 0) {
        return (
            <div
                role="alert"
                className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
            >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="flex-1 min-w-0">
                    Couldn't load {listOf(status.failed)}. What you see may be incomplete.
                </p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 touch-target focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
                >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Retry
                </button>
            </div>
        );
    }
    if (status.loading.length > 0) {
        return (
            <p role="status" className="border-b border-stone-200 bg-stone-50 px-4 py-1.5 text-xs text-stone-600">
                Loading {listOf(status.loading)}…
            </p>
        );
    }
    return null;
};

export default DataStatusBanner;
