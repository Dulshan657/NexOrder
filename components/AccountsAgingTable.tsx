import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Ban, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { Invoice, HoReCa, User } from '../types';
import { UserRole } from '../types';
import { getAllOutstanding, getHoReCaOutstanding } from '../services/accountingService';
import type { HoReCaOutstanding } from '../services/accountingService';

interface AccountsAgingTableProps {
    invoices: Invoice[];
    hoReCas: HoReCa[];
    currentUser: User;
}

type SortKey = 'customer' | '30' | '60' | '90plus' | 'total';
type SortDir = 'asc' | 'desc';

/** Merge current+30 into "30 Days", keep 60 and 90+ as-is */
function getThreeBuckets(co: HoReCaOutstanding) {
    const bucketMap = new Map(co.buckets.map(b => [b.key, b] as const));
    const currentBucket = bucketMap.get('current');
    const thirtyBucket = bucketMap.get('30');
    const sixtyBucket = bucketMap.get('60');
    const ninetyBucket = bucketMap.get('90plus');

    return {
        thirtyDays: (currentBucket?.total ?? 0) + (thirtyBucket?.total ?? 0),
        thirtyInvoices: [...(currentBucket?.invoices ?? []), ...(thirtyBucket?.invoices ?? [])],
        sixtyDays: sixtyBucket?.total ?? 0,
        sixtyInvoices: sixtyBucket?.invoices ?? [],
        ninetyPlus: ninetyBucket?.total ?? 0,
        ninetyInvoices: ninetyBucket?.invoices ?? [],
    };
}

const fmt = (n: number) => n === 0 ? '—' : `$${n.toFixed(2)}`;
const fmtTotal = (n: number) => `$${n.toFixed(2)}`;

const InvoiceRow: React.FC<{ inv: Invoice }> = ({ inv }) => (
    <tr className="bg-stone-50/50">
        <td className="pl-12 pr-6 py-1.5 text-xs text-stone-500">{inv.id}</td>
        <td className="px-6 py-1.5 text-xs text-stone-500">Due {new Date(inv.dueDate).toLocaleDateString()}</td>
        <td className="px-6 py-1.5 text-xs text-stone-500" />
        <td className="px-6 py-1.5 text-xs font-medium text-stone-600 text-right">${inv.amount.toFixed(2)}</td>
        <td />
    </tr>
);

const AccountsAgingTable: React.FC<AccountsAgingTableProps> = ({ invoices, hoReCas, currentUser }) => {
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const [sortKey, setSortKey] = useState<SortKey>('total');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const isHoReCaRole = currentUser.role === UserRole.CUSTOMER;

    const allOutstanding = useMemo(() => {
        if (isHoReCaRole) {
            const cust = hoReCas.find(c => c.id === currentUser.hoReCaId);
            if (!cust) return [];
            const co = getHoReCaOutstanding(cust.id, cust.name, invoices);
            return co.totalOutstanding > 0 ? [co] : [];
        }
        return getAllOutstanding(invoices, hoReCas);
    }, [invoices, hoReCas, currentUser, isHoReCaRole]);

    const rows = useMemo(() => {
        const mapped = allOutstanding.map(co => {
            const b = getThreeBuckets(co);
            return { ...co, ...b };
        });

        return [...mapped].sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            switch (sortKey) {
                case 'customer': return mul * a.hoReCaName.localeCompare(b.hoReCaName);
                case '30': return mul * (a.thirtyDays - b.thirtyDays);
                case '60': return mul * (a.sixtyDays - b.sixtyDays);
                case '90plus': return mul * (a.ninetyPlus - b.ninetyPlus);
                case 'total': return mul * (a.totalOutstanding - b.totalOutstanding);
                default: return 0;
            }
        });
    }, [allOutstanding, sortKey, sortDir]);

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, r) => ({
                thirtyDays: acc.thirtyDays + r.thirtyDays,
                sixtyDays: acc.sixtyDays + r.sixtyDays,
                ninetyPlus: acc.ninetyPlus + r.ninetyPlus,
                total: acc.total + r.totalOutstanding,
            }),
            { thirtyDays: 0, sixtyDays: 0, ninetyPlus: 0, total: 0 }
        );
    }, [rows]);

    const totalOutstanding = totals.total;
    const blockedCount = allOutstanding.filter(c => c.isBlocked).length;

    const toggleExpand = (hoReCaId: number) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(hoReCaId)) {
                next.delete(hoReCaId);
            } else {
                next.add(hoReCaId);
            }
            return next;
        });
    };

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'customer' ? 'asc' : 'desc');
        }
    };

    const SortIcon: React.FC<{ col: SortKey }> = ({ col }) => {
        if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
        return sortDir === 'asc'
            ? <ArrowUp className="w-3 h-3" />
            : <ArrowDown className="w-3 h-3" />;
    };

    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Accounts Receivable</h1>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                    <p className="text-sm text-stone-500 font-medium">Total Outstanding</p>
                    <p className="text-2xl font-display font-bold text-stone-900 mt-1">{fmtTotal(totalOutstanding)}</p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                    <p className="text-sm text-stone-500 font-medium">HoReCa with Balance</p>
                    <p className="text-2xl font-display font-bold text-stone-900 mt-1">{allOutstanding.length}</p>
                </div>
                <div className={`p-5 rounded-xl border shadow-sm ${blockedCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200'}`}>
                    <p className={`text-sm font-medium ${blockedCount > 0 ? 'text-red-700' : 'text-stone-500'}`}>Blocked Accounts</p>
                    <p className={`text-2xl font-display font-bold mt-1 ${blockedCount > 0 ? 'text-red-800' : 'text-stone-900'}`}>{blockedCount}</p>
                </div>
            </div>

            {/* Aging Table */}
            {allOutstanding.length > 0 ? (
                <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm">
                    <table className="min-w-full divide-y divide-stone-200">
                        <thead className="bg-stone-50">
                            <tr>
                                <th
                                    scope="col"
                                    className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:text-stone-700 transition-colors"
                                    onClick={() => handleSort('customer')}
                                >
                                    <div className="flex items-center gap-1.5">HoReCa <SortIcon col="customer" /></div>
                                </th>
                                <th
                                    scope="col"
                                    className="px-6 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:text-stone-700 transition-colors"
                                    onClick={() => handleSort('30')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">30 Days <SortIcon col="30" /></div>
                                </th>
                                <th
                                    scope="col"
                                    className="px-6 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:text-stone-700 transition-colors"
                                    onClick={() => handleSort('60')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">60 Days <SortIcon col="60" /></div>
                                </th>
                                <th
                                    scope="col"
                                    className="px-6 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:text-stone-700 transition-colors"
                                    onClick={() => handleSort('90plus')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">90+ Days <SortIcon col="90plus" /></div>
                                </th>
                                <th
                                    scope="col"
                                    className="px-6 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:text-stone-700 transition-colors"
                                    onClick={() => handleSort('total')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">Total <SortIcon col="total" /></div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-stone-200">
                            {rows.map(row => {
                                const isExpanded = expandedRows.has(row.hoReCaId);
                                return (
                                    <React.Fragment key={row.hoReCaId}>
                                        <tr
                                            className="hover:bg-stone-50 transition-colors cursor-pointer"
                                            onClick={() => toggleExpand(row.hoReCaId)}
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">
                                                <div className="flex items-center gap-2">
                                                    {isExpanded
                                                        ? <ChevronDown className="w-4 h-4 text-stone-500 flex-shrink-0" />
                                                        : <ChevronRight className="w-4 h-4 text-stone-500 flex-shrink-0" />
                                                    }
                                                    <span>{row.hoReCaName}</span>
                                                    {row.isBlocked && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full border border-red-200">
                                                            <Ban className="w-2.5 h-2.5" />
                                                            BLOCKED
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${row.thirtyDays > 0 ? 'text-stone-900 font-medium' : 'text-stone-500'}`}>
                                                {fmt(row.thirtyDays)}
                                            </td>
                                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${row.sixtyDays > 0 ? 'text-orange-700 font-medium' : 'text-stone-500'}`}>
                                                {fmt(row.sixtyDays)}
                                            </td>
                                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${row.ninetyPlus > 0 ? 'text-red-700 font-semibold' : 'text-stone-500'}`}>
                                                {fmt(row.ninetyPlus)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-stone-900">
                                                {fmtTotal(row.totalOutstanding)}
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <>
                                                {row.thirtyInvoices.length > 0 && (
                                                    <tr className="bg-stone-50/30">
                                                        <td colSpan={5} className="pl-12 py-1 text-[10px] font-semibold text-stone-500 uppercase tracking-wider">30 Days</td>
                                                    </tr>
                                                )}
                                                {row.thirtyInvoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
                                                {row.sixtyInvoices.length > 0 && (
                                                    <tr className="bg-orange-50/30">
                                                        <td colSpan={5} className="pl-12 py-1 text-[10px] font-semibold text-orange-400 uppercase tracking-wider">60 Days</td>
                                                    </tr>
                                                )}
                                                {row.sixtyInvoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
                                                {row.ninetyInvoices.length > 0 && (
                                                    <tr className="bg-red-50/30">
                                                        <td colSpan={5} className="pl-12 py-1 text-[10px] font-semibold text-red-400 uppercase tracking-wider">90+ Days</td>
                                                    </tr>
                                                )}
                                                {row.ninetyInvoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
                                            </>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="bg-stone-100 border-t-2 border-stone-300">
                                <td className="px-6 py-4 text-sm font-bold text-stone-900">Totals</td>
                                <td className="px-6 py-4 text-sm text-right font-bold text-stone-900">{fmtTotal(totals.thirtyDays)}</td>
                                <td className="px-6 py-4 text-sm text-right font-bold text-orange-700">{fmtTotal(totals.sixtyDays)}</td>
                                <td className="px-6 py-4 text-sm text-right font-bold text-red-700">{fmtTotal(totals.ninetyPlus)}</td>
                                <td className="px-6 py-4 text-sm text-right font-bold text-stone-900">{fmtTotal(totals.total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
                    <p className="text-stone-500">All accounts are clear. No outstanding balances.</p>
                </div>
            )}
        </div>
    );
};

export default AccountsAgingTable;
