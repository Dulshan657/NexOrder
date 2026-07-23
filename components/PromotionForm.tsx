import React, { useState } from 'react';
import type { Promotion, PromotionType, PromotionScope, PromotionTargeting, Product, HoReCa, User, Category, HoReCaTier } from '../types';
import { X, Tag } from 'lucide-react';
import { categoryOptions } from '../lib/productTaxonomy';

interface PromotionFormProps {
    promotion?: Promotion;
    products: Product[];
    hoReCas: HoReCa[];
    users: User[];
    onSave: (promo: Promotion) => void;
    onClose: () => void;
}

const PROMO_TYPE_LABELS: Record<PromotionType, string> = {
    percentage: 'Percentage Discount',
    fixed_price: 'Fixed Price',
    bogo: 'Buy X Get Y Free',
    bundle: 'Bundle Deal',
    clearance: 'Clearance',
};

const TIER_OPTIONS: HoReCaTier[] = ['Gold', 'Silver', 'Bronze'];

const PromotionForm: React.FC<PromotionFormProps> = ({ promotion, products, hoReCas, users, onSave, onClose }) => {
    const [name, setName] = useState(promotion?.name ?? '');
    const [description, setDescription] = useState(promotion?.description ?? '');
    const [type, setType] = useState<PromotionType>(promotion?.type ?? 'percentage');
    const [percentOff, setPercentOff] = useState(String(promotion?.percentOff ?? ''));
    const [fixedPrice, setFixedPrice] = useState(String(promotion?.fixedPrice ?? ''));
    const [clearancePercent, setClearancePercent] = useState(String(promotion?.clearancePercent ?? ''));
    const [bogoBuyProductId, setBogoBuyProductId] = useState(String(promotion?.bogoConfig?.buyProductId ?? ''));
    const [bogoBuyQty, setBogoBuyQty] = useState(String(promotion?.bogoConfig?.buyQuantity ?? '2'));
    const [bogoGetProductId, setBogoGetProductId] = useState(String(promotion?.bogoConfig?.getProductId ?? ''));
    const [bogoGetQty, setBogoGetQty] = useState(String(promotion?.bogoConfig?.getQuantity ?? '1'));
    const [bogoSameProduct, setBogoSameProduct] = useState(
        promotion?.bogoConfig ? promotion.bogoConfig.buyProductId === promotion.bogoConfig.getProductId : true
    );
    const [bundleProductIds, setBundleProductIds] = useState<number[]>(promotion?.bundleConfig?.productIds ?? []);
    const [bundlePrice, setBundlePrice] = useState(String(promotion?.bundleConfig?.bundlePrice ?? ''));
    const [appliesTo, setAppliesTo] = useState<'unit' | 'carton'>(promotion?.appliesTo ?? 'unit');
    const [scopeKind, setScopeKind] = useState<PromotionScope['kind']>(promotion?.scope.kind ?? 'storewide');
    const [scopeProductIds, setScopeProductIds] = useState<number[]>(
        promotion?.scope.kind === 'products' ? promotion.scope.productIds : []
    );
    const [scopeCategories, setScopeCategories] = useState<Category[]>(
        promotion?.scope.kind === 'categories' ? promotion.scope.categories : []
    );
    const [targetingKind, setTargetingKind] = useState<PromotionTargeting['kind']>(promotion?.targeting.kind ?? 'all');
    const [targetHoReCaIds, setTargetCustomerIds] = useState<number[]>(
        promotion?.targeting.kind === 'horecas' ? promotion.targeting.hoReCaIds : []
    );
    const [targetTiers, setTargetTiers] = useState<HoReCaTier[]>(
        promotion?.targeting.kind === 'tier' ? promotion.targeting.tiers : []
    );
    const [targetRepId, setTargetRepId] = useState(
        promotion?.targeting.kind === 'rep' ? String(promotion.targeting.repUserId) : ''
    );
    const [stackWithHoReCaPricing, setStackWithCustomerPricing] = useState(promotion?.stackWithHoReCaPricing ?? true);
    const [startDate, setStartDate] = useState(promotion?.startDate ?? '');
    const [endDate, setEndDate] = useState(promotion?.endDate ?? '');
    const [minOrderValue, setMinOrderValue] = useState(String(promotion?.minOrderValue ?? ''));
    const [priority, setPriority] = useState(String(promotion?.priority ?? '10'));
    const [productSearch, setProductSearch] = useState('');

    const reps = users.filter(u => u.role === 'Field Sales Rep' || u.role === 'Office Sales Rep');

    const handleSave = () => {
        if (!name.trim()) return;

        const scope: PromotionScope =
            scopeKind === 'products' ? { kind: 'products', productIds: type === 'bundle' ? bundleProductIds : (type === 'bogo' ? [Number(bogoBuyProductId)] : scopeProductIds) } :
            scopeKind === 'categories' ? { kind: 'categories', categories: scopeCategories } :
            { kind: 'storewide' };

        const targeting: PromotionTargeting =
            targetingKind === 'horecas' ? { kind: 'horecas', hoReCaIds: targetHoReCaIds } :
            targetingKind === 'tier' ? { kind: 'tier', tiers: targetTiers } :
            targetingKind === 'rep' ? { kind: 'rep', repUserId: Number(targetRepId) } :
            { kind: 'all' };

        const promo: Promotion = {
            id: promotion?.id ?? `PROMO-${Date.now()}`,
            name: name.trim(),
            description: description.trim(),
            type,
            scope,
            targeting,
            stackWithHoReCaPricing,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            isActive: promotion?.isActive ?? true,
            createdAt: promotion?.createdAt ?? new Date().toISOString(),
            createdBy: promotion?.createdBy ?? 1,
            priority: Number(priority) || 10,
            minOrderValue: minOrderValue ? Number(minOrderValue) : undefined,
            appliesTo: (type === 'bogo' || type === 'bundle') ? appliesTo : undefined,
        };

        if (type === 'percentage') promo.percentOff = Number(percentOff);
        if (type === 'fixed_price') promo.fixedPrice = Number(fixedPrice);
        if (type === 'clearance') promo.clearancePercent = Number(clearancePercent);
        if (type === 'bogo') {
            const buyPid = Number(bogoBuyProductId);
            promo.bogoConfig = {
                buyProductId: buyPid,
                buyQuantity: Number(bogoBuyQty) || 2,
                getProductId: bogoSameProduct ? buyPid : Number(bogoGetProductId),
                getQuantity: Number(bogoGetQty) || 1,
            };
        }
        if (type === 'bundle') {
            promo.bundleConfig = { productIds: bundleProductIds, bundlePrice: Number(bundlePrice) };
        }

        onSave(promo);
    };

    const filteredProducts = products.filter(p =>
        productSearch === '' || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase())
    );

    const toggleProductId = (id: number, list: number[], setter: (ids: number[]) => void) => {
        setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    };

    const inputClass = 'w-full border border-stone-300 rounded-lg py-2 px-3 text-stone-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm';
    const labelClass = 'block text-xs font-medium text-stone-500 mb-1';

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-6 border-b border-stone-200">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                            <Tag className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-bold text-stone-900">{promotion ? 'Edit Promotion' : 'Create Promotion'}</h2>
                    </div>
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Name & Description */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Promotion Name *</label>
                            <input value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="e.g. Summer Sale" />
                        </div>
                        <div>
                            <label className={labelClass}>Priority (lower = higher)</label>
                            <input type="number" min="1" value={priority} onChange={e => setPriority(e.target.value)} className={inputClass} />
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>Description</label>
                        <input value={description} onChange={e => setDescription(e.target.value)} className={inputClass} placeholder="Brief description shown to hoReCas" />
                    </div>

                    {/* Type */}
                    <div>
                        <label className={labelClass}>Promotion Type</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {(Object.keys(PROMO_TYPE_LABELS) as PromotionType[]).map(t => (
                                <button key={t} onClick={() => setType(t)}
                                    className={`py-2 px-3 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${type === t ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                                    {PROMO_TYPE_LABELS[t]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Type-specific config */}
                    <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                        <h4 className="text-sm font-semibold text-stone-700 mb-3">
                            {PROMO_TYPE_LABELS[type]} Configuration
                        </h4>

                        {type === 'percentage' && (
                            <div>
                                <label className={labelClass}>Discount Percentage</label>
                                <div className="relative w-40">
                                    <input type="number" min="1" max="100" value={percentOff} onChange={e => setPercentOff(e.target.value)} className={inputClass} placeholder="e.g. 15" />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400">%</span>
                                </div>
                            </div>
                        )}

                        {type === 'fixed_price' && (
                            <div>
                                <label className={labelClass}>Fixed Price</label>
                                <div className="relative w-40">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">$</span>
                                    <input type="number" min="0.01" step="0.01" value={fixedPrice} onChange={e => setFixedPrice(e.target.value)} className={`${inputClass} pl-7`} placeholder="e.g. 3.00" />
                                </div>
                            </div>
                        )}

                        {type === 'clearance' && (
                            <div>
                                <label className={labelClass}>Clearance Discount</label>
                                <div className="relative w-40">
                                    <input type="number" min="1" max="90" value={clearancePercent} onChange={e => setClearancePercent(e.target.value)} className={inputClass} placeholder="e.g. 40" />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400">% off</span>
                                </div>
                            </div>
                        )}

                        {(type === 'bogo' || type === 'bundle') && (
                            <div className="mb-3">
                                <label className={labelClass}>Quantities are per</label>
                                <div className="flex gap-2">
                                    {(['unit', 'carton'] as const).map(u => (
                                        <button key={u} onClick={() => setAppliesTo(u)}
                                            className={`py-1.5 px-4 rounded-lg border text-sm font-medium cursor-pointer capitalize ${appliesTo === u ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                                            {u}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {type === 'bogo' && (
                            <div className="space-y-3">
                                <div>
                                    <label className={labelClass}>Buy Product</label>
                                    <select value={bogoBuyProductId} onChange={e => { setBogoBuyProductId(e.target.value); if (bogoSameProduct) setBogoGetProductId(e.target.value); }} className={inputClass}>
                                        <option value="">Select product...</option>
                                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelClass}>Buy Quantity</label>
                                        <input type="number" min="1" value={bogoBuyQty} onChange={e => setBogoBuyQty(e.target.value)} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Get Free Quantity</label>
                                        <input type="number" min="1" value={bogoGetQty} onChange={e => setBogoGetQty(e.target.value)} className={inputClass} />
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={bogoSameProduct} onChange={e => { setBogoSameProduct(e.target.checked); if (e.target.checked) setBogoGetProductId(bogoBuyProductId); }}
                                        className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500" />
                                    <span className="text-sm text-stone-700">Same product (buy 2, get 1 free)</span>
                                </label>
                                {!bogoSameProduct && (
                                    <div>
                                        <label className={labelClass}>Free Product</label>
                                        <select value={bogoGetProductId} onChange={e => setBogoGetProductId(e.target.value)} className={inputClass}>
                                            <option value="">Select product...</option>
                                            {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}

                        {type === 'bundle' && (
                            <div className="space-y-3">
                                <div>
                                    <label className={labelClass}>Bundle Price</label>
                                    <div className="relative w-40">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">$</span>
                                        <input type="number" min="0.01" step="0.01" value={bundlePrice} onChange={e => setBundlePrice(e.target.value)} className={`${inputClass} pl-7`} placeholder="e.g. 9.50" />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelClass}>Bundle Products (select 2-5)</label>
                                    <input placeholder="Search products..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className={`${inputClass} mb-2`} />
                                    <div className="max-h-40 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100">
                                        {filteredProducts.slice(0, 30).map(p => (
                                            <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-stone-50 cursor-pointer">
                                                <input type="checkbox" checked={bundleProductIds.includes(p.id)}
                                                    onChange={() => toggleProductId(p.id, bundleProductIds, setBundleProductIds)}
                                                    className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500" />
                                                <span className="text-sm text-stone-700">{p.name}</span>
                                                <span className="text-xs text-stone-400 ml-auto">${p.price.toFixed(2)}</span>
                                            </label>
                                        ))}
                                    </div>
                                    {bundleProductIds.length > 0 && (
                                        <p className="text-xs text-stone-500 mt-1">{bundleProductIds.length} products selected</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Scope (skip for bogo/bundle — scope auto-set from config) */}
                    {type !== 'bogo' && type !== 'bundle' && (
                        <div>
                            <label className={labelClass}>Scope — what does this apply to?</label>
                            <div className="flex gap-2 mb-3">
                                {(['storewide', 'products', 'categories'] as const).map(k => (
                                    <button key={k} onClick={() => setScopeKind(k)}
                                        className={`py-1.5 px-3 rounded-lg border text-sm font-medium cursor-pointer ${scopeKind === k ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                                        {k === 'storewide' ? 'Storewide' : k === 'products' ? 'Specific Products' : 'Categories'}
                                    </button>
                                ))}
                            </div>
                            {scopeKind === 'products' && (
                                <div>
                                    <input placeholder="Search products..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className={`${inputClass} mb-2`} />
                                    <div className="max-h-40 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100">
                                        {filteredProducts.slice(0, 30).map(p => (
                                            <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-stone-50 cursor-pointer">
                                                <input type="checkbox" checked={scopeProductIds.includes(p.id)}
                                                    onChange={() => toggleProductId(p.id, scopeProductIds, setScopeProductIds)}
                                                    className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500" />
                                                <span className="text-sm text-stone-700">{p.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {scopeKind === 'categories' && (
                                <div className="flex flex-wrap gap-2">
                                    {categoryOptions(products).map(cat => (
                                        <button key={cat} onClick={() => setScopeCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])}
                                            className={`py-1 px-3 rounded-full text-sm font-medium cursor-pointer border ${scopeCategories.includes(cat) ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Targeting */}
                    <div>
                        <label className={labelClass}>Targeting — who sees this?</label>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {([['all', 'All HoReCa'], ['horecas', 'Specific Customers'], ['tier', 'By Tier'], ['rep', 'Per Sales Rep']] as const).map(([k, label]) => (
                                <button key={k} onClick={() => setTargetingKind(k)}
                                    className={`py-1.5 px-3 rounded-lg border text-sm font-medium cursor-pointer ${targetingKind === k ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        {targetingKind === 'horecas' && (
                            <div className="max-h-36 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100">
                                {hoReCas.map(c => (
                                    <label key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-stone-50 cursor-pointer">
                                        <input type="checkbox" checked={targetHoReCaIds.includes(c.id)}
                                            onChange={() => toggleProductId(c.id, targetHoReCaIds, setTargetCustomerIds)}
                                            className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500" />
                                        <span className="text-sm text-stone-700">{c.name}</span>
                                        {c.tier && <span className="text-xs text-stone-400 ml-auto">{c.tier}</span>}
                                    </label>
                                ))}
                            </div>
                        )}
                        {targetingKind === 'tier' && (
                            <div className="flex gap-2">
                                {TIER_OPTIONS.map(t => (
                                    <button key={t} onClick={() => setTargetTiers(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                                        className={`py-1.5 px-4 rounded-lg border text-sm font-medium cursor-pointer ${targetTiers.includes(t) ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
                                        {t}
                                    </button>
                                ))}
                            </div>
                        )}
                        {targetingKind === 'rep' && (
                            <select value={targetRepId} onChange={e => setTargetRepId(e.target.value)} className={inputClass}>
                                <option value="">Select sales rep...</option>
                                {reps.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                            </select>
                        )}
                    </div>

                    {/* Stacking, Min Order, Dates */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Start Date (optional)</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>End Date (optional)</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputClass} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Min Order Value (optional)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">$</span>
                                <input type="number" min="0" step="1" value={minOrderValue} onChange={e => setMinOrderValue(e.target.value)} className={`${inputClass} pl-7`} placeholder="No minimum" />
                            </div>
                        </div>
                        <div className="flex items-end pb-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={stackWithHoReCaPricing} onChange={e => setStackWithCustomerPricing(e.target.checked)}
                                    className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500" />
                                <span className="text-sm text-stone-700">Stack with HoReCa pricing</span>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 p-6 border-t border-stone-200">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 font-medium cursor-pointer">Cancel</button>
                    <button onClick={handleSave} disabled={!name.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        {promotion ? 'Update Promotion' : 'Create Promotion'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PromotionForm;
