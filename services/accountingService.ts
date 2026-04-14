import type { Invoice, HoReCa } from '../types';

export interface AgingBucket {
    label: string;
    key: 'current' | '30' | '60' | '90plus';
    invoices: Invoice[];
    total: number;
}

export interface HoReCaOutstanding {
    hoReCaId: number;
    hoReCaName: string;
    buckets: AgingBucket[];
    totalOutstanding: number;
    isBlocked: boolean; // true if 90+ bucket has any balance
}

const BUCKET_DEFS: { key: AgingBucket['key']; label: string; minDays: number; maxDays: number }[] = [
    { key: 'current', label: 'Current', minDays: -Infinity, maxDays: 30 },
    { key: '30', label: '30 Days', minDays: 31, maxDays: 60 },
    { key: '60', label: '60 Days', minDays: 61, maxDays: 90 },
    { key: '90plus', label: '90+ Days', minDays: 91, maxDays: Infinity },
];

function getDaysPastDue(invoice: Invoice): number {
    const dueDate = new Date(invoice.dueDate);
    const now = new Date();
    const diffMs = now.getTime() - dueDate.getTime();
    return Math.floor(diffMs / 86400000);
}

export function getHoReCaOutstanding(hoReCaId: number, hoReCaName: string, invoices: Invoice[]): HoReCaOutstanding {
    const unpaidInvoices = invoices.filter(
        inv => inv.hoReCaId === hoReCaId && inv.status !== 'paid'
    );

    const buckets: AgingBucket[] = BUCKET_DEFS.map(def => ({
        key: def.key,
        label: def.label,
        invoices: [],
        total: 0,
    }));

    for (const inv of unpaidInvoices) {
        const daysPast = getDaysPastDue(inv);
        const bucket = buckets.find((_, i) => {
            const def = BUCKET_DEFS[i];
            return daysPast >= def.minDays && daysPast <= def.maxDays;
        });
        if (bucket) {
            bucket.invoices.push(inv);
            bucket.total += inv.amount;
        }
    }

    const totalOutstanding = buckets.reduce((sum, b) => sum + b.total, 0);
    const isBlocked = buckets.find(b => b.key === '90plus')!.total > 0;

    return { hoReCaId, hoReCaName, buckets, totalOutstanding, isBlocked };
}

export function getOverduePaymentsSummary(invoices: Invoice[]): { count: number; totalAmount: number; criticalCount: number } {
    const overdueInvoices = invoices.filter(i => i.status === 'overdue');
    const totalAmount = overdueInvoices.reduce((sum, i) => sum + i.amount, 0);

    // Critical: overdue by 90+ days
    const criticalCount = overdueInvoices.filter(i => getDaysPastDue(i) > 90).length;

    return { count: overdueInvoices.length, totalAmount: Math.round(totalAmount * 100) / 100, criticalCount };
}

export function getAllOutstanding(invoices: Invoice[], hoReCas: HoReCa[]): HoReCaOutstanding[] {
    return hoReCas
        .map(c => getHoReCaOutstanding(c.id, c.name, invoices))
        .filter(co => co.totalOutstanding > 0)
        .sort((a, b) => {
            // Blocked first, then by total outstanding descending
            if (a.isBlocked !== b.isBlocked) return a.isBlocked ? -1 : 1;
            return b.totalOutstanding - a.totalOutstanding;
        });
}
