import React, { useState, useMemo } from 'react';
import type { Invoice } from '../types';
import { FileText, Search, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';

interface InvoiceAdminProps {
    invoices: Invoice[];
    onUpdateStatus: (invoiceId: string, status: Invoice['status']) => void;
}

const InvoiceAdmin: React.FC<InvoiceAdminProps> = ({ invoices, onUpdateStatus }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const filteredInvoices = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return invoices.filter(inv => {
            const matchesSearch = !q || inv.id.toLowerCase().includes(q) || inv.hoReCaName.toLowerCase().includes(q) || inv.orderId.toLowerCase().includes(q);
            const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [invoices, searchQuery, statusFilter]);

    const summary = useMemo(() => {
        const outstanding = invoices.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
        const overdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
        const collected = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
        return { outstanding, overdue, collected, total: invoices.length };
    }, [invoices]);

    const statusBadge = (status: Invoice['status']) => {
        const styles = {
            pending: 'bg-amber-50 text-amber-700 border-amber-200',
            overdue: 'bg-red-50 text-red-700 border-red-200',
            paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
        return (
            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };

    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Invoices</h2>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-stone-200 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-50 rounded-lg"><DollarSign className="w-5 h-5 text-amber-600" /></div>
                        <div>
                            <p className="text-xs text-stone-500 uppercase tracking-wider">Outstanding</p>
                            <p className="text-xl font-bold text-stone-900">${summary.outstanding.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-stone-200 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-50 rounded-lg"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
                        <div>
                            <p className="text-xs text-stone-500 uppercase tracking-wider">Overdue</p>
                            <p className="text-xl font-bold text-red-700">${summary.overdue.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-stone-200 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-50 rounded-lg"><CheckCircle className="w-5 h-5 text-emerald-600" /></div>
                        <div>
                            <p className="text-xs text-stone-500 uppercase tracking-wider">Collected</p>
                            <p className="text-xl font-bold text-emerald-700">${summary.collected.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="flex flex-wrap gap-4">
                    <div className="flex-1 min-w-[200px] relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search invoices..."
                            className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>
                    <div className="flex gap-2">
                        {['all', 'pending', 'overdue', 'paid'].map(status => (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                                    statusFilter === status
                                        ? 'bg-stone-900 text-white'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Invoice Table */}
            {filteredInvoices.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-stone-200 border-dashed">
                    <FileText className="w-12 h-12 text-stone-300 mx-auto mb-3" />
                    <p className="text-stone-500">No invoices found.</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 border-b border-stone-200">
                                <tr>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Invoice</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Order</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">HoReCa</th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Amount</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Due Date</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Status</th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {filteredInvoices.map(inv => (
                                    <tr key={inv.id} className="hover:bg-stone-50">
                                        <td className="px-4 py-3 font-medium text-stone-900">{inv.id}</td>
                                        <td className="px-4 py-3 text-stone-600">{inv.orderId}</td>
                                        <td className="px-4 py-3 text-stone-600">{inv.hoReCaName}</td>
                                        <td className="px-4 py-3 text-right font-medium text-stone-900">${inv.amount.toFixed(2)}</td>
                                        <td className="px-4 py-3 text-stone-600">{new Date(inv.dueDate).toLocaleDateString('en-AU')}</td>
                                        <td className="px-4 py-3">{statusBadge(inv.status)}</td>
                                        <td className="px-4 py-3 text-right">
                                            {inv.status !== 'paid' && (
                                                <button
                                                    onClick={() => onUpdateStatus(inv.id, 'paid')}
                                                    className="text-xs font-medium text-emerald-600 hover:text-emerald-800 transition-colors cursor-pointer"
                                                >
                                                    Mark Paid
                                                </button>
                                            )}
                                            {inv.status === 'paid' && inv.paidDate && (
                                                <span className="text-xs text-stone-500">Paid {new Date(inv.paidDate).toLocaleDateString('en-AU')}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InvoiceAdmin;
