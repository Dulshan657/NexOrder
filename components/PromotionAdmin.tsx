import React, { useState, useMemo } from 'react';
import type { Promotion, Product, HoReCa, User } from '../types';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Tag, Calendar } from 'lucide-react';
import PromotionForm from './PromotionForm';
import { isPromotionActive } from '../pricing';

interface PromotionAdminProps {
    promotions: Promotion[];
    products: Product[];
    hoReCas: HoReCa[];
    users: User[];
    onAdd: (promo: Promotion) => void;
    onUpdate: (promo: Promotion) => void;
    onDelete: (promoId: string) => void;
}

type FilterTab = 'all' | 'active' | 'scheduled' | 'expired' | 'disabled';

const TYPE_BADGES: Record<string, { bg: string; text: string }> = {
    percentage: { bg: 'bg-amber-100', text: 'text-amber-700' },
    fixed_price: { bg: 'bg-blue-100', text: 'text-blue-700' },
    bogo: { bg: 'bg-purple-100', text: 'text-purple-700' },
    bundle: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
    clearance: { bg: 'bg-red-100', text: 'text-red-700' },
};

const TYPE_LABELS: Record<string, string> = {
    percentage: 'Percentage',
    fixed_price: 'Fixed Price',
    bogo: 'BOGO',
    bundle: 'Bundle',
    clearance: 'Clearance',
};

function getPromoStatus(promo: Promotion): 'active' | 'scheduled' | 'expired' | 'disabled' {
    if (!promo.isActive) return 'disabled';
    const now = new Date().toISOString().split('T')[0];
    if (promo.startDate && now < promo.startDate) return 'scheduled';
    if (promo.endDate && now > promo.endDate) return 'expired';
    return 'active';
}

const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
    active: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    scheduled: { bg: 'bg-blue-100', text: 'text-blue-700' },
    expired: { bg: 'bg-stone-100', text: 'text-stone-500' },
    disabled: { bg: 'bg-red-50', text: 'text-red-600' },
};

function formatScope(promo: Promotion, products: Product[]): string {
    if (promo.scope.kind === 'storewide') return 'Storewide';
    if (promo.scope.kind === 'categories') return promo.scope.categories.join(', ');
    if (promo.scope.kind === 'products') {
        const names = promo.scope.productIds.map(id => products.find(p => p.id === id)?.name ?? `#${id}`);
        return names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1} more`;
    }
    return '';
}

function formatTargeting(promo: Promotion, hoReCas: HoReCa[]): string {
    if (promo.targeting.kind === 'all') return 'All hoReCas';
    if (promo.targeting.kind === 'tier') return promo.targeting.tiers.join(', ') + ' tier';
    if (promo.targeting.kind === 'horecas') {
        const names = promo.targeting.hoReCaIds.map(id => hoReCas.find(c => c.id === id)?.name ?? `#${id}`);
        return names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1} more`;
    }
    if (promo.targeting.kind === 'rep') return 'Sales rep only';
    return '';
}

function formatValue(promo: Promotion): string {
    if (promo.type === 'percentage' && promo.percentOff) return `${promo.percentOff}% off`;
    if (promo.type === 'fixed_price' && promo.fixedPrice) return `$${promo.fixedPrice.toFixed(2)}`;
    if (promo.type === 'clearance' && promo.clearancePercent) return `${promo.clearancePercent}% off`;
    if (promo.type === 'bogo' && promo.bogoConfig) return `Buy ${promo.bogoConfig.buyQuantity} Get ${promo.bogoConfig.getQuantity}`;
    if (promo.type === 'bundle' && promo.bundleConfig) return `$${promo.bundleConfig.bundlePrice.toFixed(2)} bundle`;
    return '';
}

const PromotionAdmin: React.FC<PromotionAdminProps> = ({ promotions, products, hoReCas, users, onAdd, onUpdate, onDelete }) => {
    const [filter, setFilter] = useState<FilterTab>('all');
    const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);
    const [showForm, setShowForm] = useState(false);

    const filtered = useMemo(() => {
        if (filter === 'all') return promotions;
        return promotions.filter(p => getPromoStatus(p) === filter);
    }, [promotions, filter]);

    const counts = useMemo(() => ({
        all: promotions.length,
        active: promotions.filter(p => getPromoStatus(p) === 'active').length,
        scheduled: promotions.filter(p => getPromoStatus(p) === 'scheduled').length,
        expired: promotions.filter(p => getPromoStatus(p) === 'expired').length,
        disabled: promotions.filter(p => getPromoStatus(p) === 'disabled').length,
    }), [promotions]);

    const handleToggle = (promo: Promotion) => {
        onUpdate({ ...promo, isActive: !promo.isActive });
    };

    const handleSave = (promo: Promotion) => {
        if (editingPromo) {
            onUpdate(promo);
        } else {
            onAdd(promo);
        }
        setShowForm(false);
        setEditingPromo(null);
    };

    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Promotions</h2>
                    <p className="text-sm text-stone-500 mt-1">Manage discounts, deals, and clearance pricing</p>
                </div>
                <button onClick={() => { setEditingPromo(null); setShowForm(true); }}
                    className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-emerald-700 flex items-center gap-2 cursor-pointer shadow-sm">
                    <Plus className="w-4 h-4" /> Create Promotion
                </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1 mb-4 bg-stone-100 p-1 rounded-xl w-fit">
                {(['all', 'active', 'scheduled', 'expired', 'disabled'] as FilterTab[]).map(tab => (
                    <button key={tab} onClick={() => setFilter(tab)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize cursor-pointer transition-colors ${filter === tab ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}>
                        {tab} {counts[tab] > 0 && <span className="text-xs ml-1 opacity-60">({counts[tab]})</span>}
                    </button>
                ))}
            </div>

            {/* Table */}
            {filtered.length > 0 ? (
                <div className="border border-stone-200 rounded-xl overflow-hidden">
                    <table className="min-w-full divide-y divide-stone-200">
                        <thead className="bg-stone-50">
                            <tr>
                                <th className="px-5 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Promotion</th>
                                <th className="px-5 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Type</th>
                                <th className="px-5 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Value</th>
                                <th className="px-5 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Scope</th>
                                <th className="px-5 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Status</th>
                                <th className="px-5 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Dates</th>
                                <th className="px-5 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100 bg-white">
                            {filtered.map(promo => {
                                const status = getPromoStatus(promo);
                                const typeBadge = TYPE_BADGES[promo.type];
                                const statusBadge = STATUS_BADGES[status];
                                return (
                                    <tr key={promo.id} className="hover:bg-stone-50/50 transition-colors">
                                        <td className="px-5 py-3.5">
                                            <p className="text-sm font-medium text-stone-900">{promo.name}</p>
                                            <p className="text-xs text-stone-500 mt-0.5">{formatTargeting(promo, hoReCas)}</p>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.bg} ${typeBadge.text}`}>
                                                {TYPE_LABELS[promo.type]}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-sm font-medium text-stone-900">{formatValue(promo)}</td>
                                        <td className="px-5 py-3.5 text-sm text-stone-600 max-w-[160px] truncate">{formatScope(promo, products)}</td>
                                        <td className="px-5 py-3.5">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge.bg} ${statusBadge.text}`}>
                                                {status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-xs text-stone-500">
                                            {promo.startDate || promo.endDate ? (
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {promo.startDate && new Date(promo.startDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                    {promo.startDate && promo.endDate && ' – '}
                                                    {promo.endDate && new Date(promo.endDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                </div>
                                            ) : 'Manual'}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => handleToggle(promo)} title={promo.isActive ? 'Deactivate' : 'Activate'}
                                                    className={`p-1.5 rounded-lg cursor-pointer transition-colors ${promo.isActive ? 'text-emerald-600 hover:bg-emerald-50' : 'text-stone-400 hover:bg-stone-100'}`}>
                                                    {promo.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                                                </button>
                                                <button onClick={() => { setEditingPromo(promo); setShowForm(true); }}
                                                    className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer">
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => onDelete(promo.id)}
                                                    className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-center py-12 bg-stone-50 rounded-xl border border-stone-200">
                    <Tag className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-stone-700">No promotions found</h3>
                    <p className="text-stone-500 mt-1 text-sm">
                        {filter === 'all' ? 'Create your first promotion to get started.' : `No ${filter} promotions.`}
                    </p>
                </div>
            )}

            {showForm && (
                <PromotionForm
                    promotion={editingPromo ?? undefined}
                    products={products}
                    hoReCas={hoReCas}
                    users={users}
                    onSave={handleSave}
                    onClose={() => { setShowForm(false); setEditingPromo(null); }}
                />
            )}
        </div>
    );
};

export default PromotionAdmin;
