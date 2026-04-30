import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { AppSettings, HoReCa, Product } from '../types';
import { Building2, FileText, Package, CreditCard, DollarSign, AlertTriangle, Tags, Loader2 } from 'lucide-react';
import { uploadToBucket, deleteFromBucketByUrl } from '../services/supabase/storageService';
import { useToasts } from '../hooks/useToasts';

interface SettingsPanelProps {
    settings: AppSettings;
    appLogo: string | null;
    hoReCas: HoReCa[];
    products: Product[];
    onSaveSettings: (settings: AppSettings) => void;
    onUpdateLogo: (logo: string | null) => void;
    onUpdateHoReCa: (customer: HoReCa, reason?: string) => void;
}

const CURRENCIES = ['AUD', 'USD', 'NZD', 'GBP', 'EUR', 'SGD', 'MYR'];

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, appLogo, hoReCas, products, onSaveSettings, onUpdateLogo, onUpdateHoReCa }) => {
    const [draft, setDraft] = useState<AppSettings>(settings);
    const [logoPreview, setLogoPreview] = useState<string | null>(appLogo);
    const [isUploadingLogo, setIsUploadingLogo] = useState(false);
    const { addToast } = useToasts();
    const [creditLimitEdits, setCreditLimitEdits] = useState<Record<number, string>>({});
    const [stockTabEdits, setStockTabEdits] = useState<Record<number, boolean | undefined>>({});
    const [saved, setSaved] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // HoReCa Pricing state
    const [selectedPricingCustomerId, setSelectedPricingCustomerId] = useState<number | null>(null);
    const [blanketDiscountEdit, setBlanketDiscountEdit] = useState<string>('');
    const [pricingEdits, setPricingEdits] = useState<Record<number, string>>({});
    const [pricingSearch, setPricingSearch] = useState('');
    const [pricingSaved, setPricingSaved] = useState(false);

    useEffect(() => {
        setDraft(settings);
    }, [settings]);

    useEffect(() => {
        setLogoPreview(appLogo);
    }, [appLogo]);

    const selectedPricingCustomer = hoReCas.find(c => c.id === selectedPricingCustomerId) ?? null;

    const filteredPricingProducts = useMemo(() => {
        if (!pricingSearch.trim()) return products;
        const q = pricingSearch.toLowerCase();
        return products.filter(p => p.name.toLowerCase().includes(q));
    }, [products, pricingSearch]);

    useEffect(() => {
        if (selectedPricingCustomer) {
            setBlanketDiscountEdit(
                selectedPricingCustomer.discountPercent != null
                    ? String(selectedPricingCustomer.discountPercent)
                    : ''
            );
            const initial: Record<number, string> = {};
            if (selectedPricingCustomer.pricing) {
                for (const pid in selectedPricingCustomer.pricing) {
                    initial[Number(pid)] = String(selectedPricingCustomer.pricing[Number(pid)]);
                }
            }
            setPricingEdits(initial);
        } else {
            setBlanketDiscountEdit('');
            setPricingEdits({});
        }
        setPricingSearch('');
        setPricingSaved(false);
    }, [selectedPricingCustomerId, hoReCas]);

    const handleSavePricing = () => {
        if (!selectedPricingCustomer) return;

        const newDiscount = blanketDiscountEdit.trim() === ''
            ? undefined
            : Math.min(100, Math.max(0, Number(blanketDiscountEdit)));

        const newPricing: { [productId: number]: number } = {};
        for (const pidStr of Object.keys(pricingEdits)) {
            const valStr = pricingEdits[Number(pidStr)];
            if (valStr == null) continue;
            const price = parseFloat(valStr);
            if (!isNaN(price) && valStr.trim() !== '') {
                newPricing[Number(pidStr)] = price;
            }
        }

        onUpdateHoReCa({
            ...selectedPricingCustomer,
            discountPercent: newDiscount,
            pricing: Object.keys(newPricing).length > 0 ? newPricing : undefined,
        });
        setPricingSaved(true);
        setTimeout(() => setPricingSaved(false), 2000);
    };

    const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setDraft(prev => ({ ...prev, [key]: value }));
        setSaved(false);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        setIsUploadingLogo(true);
        try {
            const url = await uploadToBucket('company-assets', file, { prefix: 'logos' });
            setLogoPreview(url);
            onUpdateLogo(url);
            addToast('Logo uploaded.', 'success');
        } catch (err) {
            addToast(err instanceof Error ? `Logo upload failed: ${err.message}` : 'Logo upload failed', 'error');
        } finally {
            setIsUploadingLogo(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveLogo = async () => {
        const previousUrl = logoPreview;
        setLogoPreview(null);
        onUpdateLogo(null);
        if (previousUrl) {
            try { await deleteFromBucketByUrl('company-assets', previousUrl); } catch { /* ignore */ }
        }
    };

    const handleSave = () => {
        onSaveSettings(draft);
        // Logo persistence happens inline via handleFileChange / handleRemoveLogo.

        // Save any edited credit limits
        for (const [idStr, valStr] of Object.entries(creditLimitEdits)) {
            const hoReCaId = Number(idStr);
            const customer = hoReCas.find(c => c.id === hoReCaId);
            if (customer) {
                const newLimit = valStr === '' ? undefined : Number(valStr);
                if (newLimit !== customer.creditLimit) {
                    onUpdateHoReCa({ ...customer, creditLimit: newLimit });
                }
            }
        }
        setCreditLimitEdits({});

        // Save any edited stock tab overrides
        for (const [idStr, val] of Object.entries(stockTabEdits)) {
            const hoReCaId = Number(idStr);
            const customer = hoReCas.find(c => c.id === hoReCaId);
            if (customer && val !== customer.showStockTab) {
                onUpdateHoReCa({ ...customer, showStockTab: val });
            }
        }
        setStockTabEdits({});

        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const getCreditValue = (customer: HoReCa): string => {
        if (creditLimitEdits[customer.id] !== undefined) return creditLimitEdits[customer.id];
        return customer.creditLimit !== undefined ? String(customer.creditLimit) : '';
    };

    return (
        <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Settings</h2>
                <button
                    onClick={handleSave}
                    className={`font-medium py-2.5 px-6 rounded-lg transition-colors shadow-sm ${
                        saved
                            ? 'bg-emerald-600 text-white'
                            : 'bg-stone-900 text-white hover:bg-stone-800'
                    }`}
                >
                    {saved ? 'Saved!' : 'Save All Settings'}
                </button>
            </div>

            <div className="space-y-6">
                {/* Company Info */}
                <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-4">
                        <Building2 className="w-5 h-5 text-stone-600" />
                        <h3 className="text-lg font-semibold text-stone-800">Company Information</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Company Name</label>
                            <input
                                type="text"
                                value={draft.companyName}
                                onChange={e => updateField('companyName', e.target.value)}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
                            <input
                                type="email"
                                value={draft.companyEmail}
                                onChange={e => updateField('companyEmail', e.target.value)}
                                placeholder="orders@company.com"
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Phone</label>
                            <input
                                type="text"
                                value={draft.companyPhone}
                                onChange={e => updateField('companyPhone', e.target.value)}
                                placeholder="+61 2 1234 5678"
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Address</label>
                            <input
                                type="text"
                                value={draft.companyAddress}
                                onChange={e => updateField('companyAddress', e.target.value)}
                                placeholder="123 Business St, Sydney NSW"
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                        </div>
                    </div>

                    {/* Logo */}
                    <div className="pt-4 border-t border-stone-200">
                        <label className="block text-sm font-medium text-stone-700 mb-1">Company Logo</label>
                        <p className="text-xs text-stone-500 mb-3">Displayed in the sidebar. Recommended: 200x50px.</p>
                        <div className="flex items-center gap-4">
                            <div className="w-40 h-20 bg-white border border-stone-200 rounded-lg flex items-center justify-center p-2 shadow-sm">
                                {isUploadingLogo ? (
                                    <Loader2 className="w-6 h-6 text-stone-400 animate-spin" />
                                ) : logoPreview ? (
                                    <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
                                ) : (
                                    <span className="text-stone-400 text-xs">No Logo</span>
                                )}
                            </div>
                            <div className="flex flex-col gap-2">
                                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" disabled={isUploadingLogo} />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingLogo}
                                    className="bg-white py-2 px-3 border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isUploadingLogo ? 'Uploading…' : 'Upload Logo'}
                                </button>
                                {logoPreview && !isUploadingLogo && (
                                    <button
                                        type="button"
                                        onClick={handleRemoveLogo}
                                        className="text-xs font-medium text-red-600 hover:text-red-800 self-start transition-colors duration-200 cursor-pointer rounded px-1 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Order Settings */}
                <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-4">
                        <FileText className="w-5 h-5 text-stone-600" />
                        <h3 className="text-lg font-semibold text-stone-800">Order Settings</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Order ID Prefix</label>
                            <input
                                type="text"
                                value={draft.orderIdPrefix}
                                onChange={e => updateField('orderIdPrefix', e.target.value.toUpperCase())}
                                maxLength={6}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                            <p className="text-xs text-stone-400 mt-1">e.g. {draft.orderIdPrefix}-1711817600000</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Minimum Order Value ($)</label>
                            <input
                                type="number"
                                value={draft.minimumOrderValue}
                                onChange={e => updateField('minimumOrderValue', Math.max(0, Number(e.target.value)))}
                                min={0}
                                step={1}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                            <p className="text-xs text-stone-400 mt-1">Set to 0 for no minimum</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Currency</label>
                            <select
                                value={draft.currency}
                                onChange={e => updateField('currency', e.target.value)}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            >
                                {CURRENCIES.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </section>

                {/* Pricing */}
                <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-4">
                        <DollarSign className="w-5 h-5 text-stone-600" />
                        <h3 className="text-lg font-semibold text-stone-800">Pricing</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Carton Discount (%)</label>
                            <input
                                type="number"
                                value={draft.cartonDiscountPercent}
                                onChange={e => updateField('cartonDiscountPercent', Math.min(50, Math.max(0, Number(e.target.value))))}
                                min={0}
                                max={50}
                                step={0.5}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                            <p className="text-xs text-stone-400 mt-1">Discount applied when ordering full cartons</p>
                        </div>
                    </div>
                </section>

                {/* Inventory */}
                <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-4">
                        <Package className="w-5 h-5 text-stone-600" />
                        <h3 className="text-lg font-semibold text-stone-800">Inventory</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">Low Stock Threshold</label>
                            <input
                                type="number"
                                value={draft.lowStockThreshold}
                                onChange={e => updateField('lowStockThreshold', Math.max(1, Number(e.target.value)))}
                                min={1}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                            <p className="text-xs text-stone-400 mt-1">Products below this quantity show a "Low Stock" warning</p>
                        </div>
                    </div>

                    <div className="mt-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={draft.showStockToHoReCa}
                                onChange={e => updateField('showStockToHoReCa', e.target.checked)}
                                className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div>
                                <span className="text-sm font-medium text-stone-700">Show Stock tab to Customers</span>
                                <p className="text-xs text-stone-400">When enabled, HoReCa users can see the Stock tab in the sidebar. Individual overrides can be set below in Credit Limits.</p>
                            </div>
                        </label>
                    </div>

                    {/* Low stock items preview */}
                    <div className="mt-4 pt-4 border-t border-stone-200">
                        <p className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-2">
                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                            Current low stock items (below {draft.lowStockThreshold} units)
                        </p>
                        {/* This is informational only — reads from threshold */}
                    </div>
                </section>

                {/* Credit Limits */}
                <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-1">
                        <CreditCard className="w-5 h-5 text-stone-600" />
                        <h3 className="text-lg font-semibold text-stone-800">Credit Limits</h3>
                    </div>
                    <p className="text-sm text-stone-500 mb-4">Set the default credit limit for new hoReCas, and adjust individual customer limits below.</p>

                    <div className="mb-5">
                        <label className="block text-sm font-medium text-stone-700 mb-1">Default Credit Limit ($)</label>
                        <input
                            type="number"
                            value={draft.defaultCreditLimit}
                            onChange={e => updateField('defaultCreditLimit', Math.max(0, Number(e.target.value)))}
                            min={0}
                            step={100}
                            className="w-full sm:w-64 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                        <p className="text-xs text-stone-400 mt-1">Applied to new hoReCas. Set to 0 for no credit.</p>
                    </div>

                    {/* Per-customer credit limits */}
                    <div className="border-t border-stone-200 pt-4">
                        <p className="text-sm font-medium text-stone-700 mb-3">HoReCa Credit Limits</p>
                        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-stone-50 border-b border-stone-200">
                                        <th className="text-left px-4 py-2.5 font-medium text-stone-600">HoReCa</th>
                                        <th className="text-left px-4 py-2.5 font-medium text-stone-600">Current Limit ($)</th>
                                        <th className="text-left px-4 py-2.5 font-medium text-stone-600">Tier</th>
                                        <th className="text-left px-4 py-2.5 font-medium text-stone-600">Stock Tab</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {hoReCas.map(customer => (
                                        <tr key={customer.id} className="hover:bg-stone-50">
                                            <td className="px-4 py-2.5 text-stone-900 font-medium">{customer.name}</td>
                                            <td className="px-4 py-2.5">
                                                <input
                                                    type="number"
                                                    value={getCreditValue(customer)}
                                                    onChange={e => {
                                                        setCreditLimitEdits(prev => ({ ...prev, [customer.id]: e.target.value }));
                                                        setSaved(false);
                                                    }}
                                                    placeholder="No limit"
                                                    min={0}
                                                    step={100}
                                                    className="w-36 px-2.5 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                                                />
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <select
                                                    value={customer?.tier ?? ''}
                                                    onChange={e => {
                                                        const tier = e.target.value || undefined;
                                                        onUpdateHoReCa({ ...customer, tier: tier as import('../types').HoReCaTier | undefined });
                                                        setSaved(false);
                                                    }}
                                                    className="w-28 px-2.5 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                                                >
                                                    <option value="">None</option>
                                                    <option value="Gold">Gold</option>
                                                    <option value="Silver">Silver</option>
                                                    <option value="Bronze">Bronze</option>
                                                </select>
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <select
                                                    value={
                                                        stockTabEdits[customer.id] !== undefined
                                                            ? String(stockTabEdits[customer.id])
                                                            : customer.showStockTab !== undefined
                                                                ? String(customer.showStockTab)
                                                                : 'default'
                                                    }
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setStockTabEdits(prev => ({
                                                            ...prev,
                                                            [customer.id]: val === 'default' ? undefined : val === 'true',
                                                        }));
                                                        setSaved(false);
                                                    }}
                                                    className="w-32 px-2.5 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                                                >
                                                    <option value="default">Default</option>
                                                    <option value="true">Show</option>
                                                    <option value="false">Hide</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* HoReCa Pricing */}
                <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-1">
                        <Tags className="w-5 h-5 text-stone-600" />
                        <h3 className="text-lg font-semibold text-stone-800">HoReCa Pricing</h3>
                    </div>
                    <p className="text-sm text-stone-500 mb-4">
                        Set blanket discounts and per-product price overrides for each customer. The better price (lower) wins.
                    </p>

                    <div className="mb-5">
                        <label className="block text-sm font-medium text-stone-700 mb-1">Select HoReCa</label>
                        <select
                            value={selectedPricingCustomerId ?? ''}
                            onChange={e => setSelectedPricingCustomerId(e.target.value ? Number(e.target.value) : null)}
                            className="w-full sm:w-64 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                        >
                            <option value="">Choose a customer...</option>
                            {hoReCas.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    {selectedPricingCustomer && (
                        <div className="border-t border-stone-200 pt-4 space-y-5">
                            {/* Blanket Discount */}
                            <div>
                                <label className="block text-sm font-medium text-stone-700 mb-1">
                                    Blanket Discount (%)
                                </label>
                                <input
                                    type="number"
                                    value={blanketDiscountEdit}
                                    onChange={e => { setBlanketDiscountEdit(e.target.value); setPricingSaved(false); }}
                                    min={0}
                                    max={100}
                                    step={0.5}
                                    placeholder="No blanket discount"
                                    className="w-full sm:w-64 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                                />
                                <p className="text-xs text-stone-400 mt-1">
                                    Applied to all products. Per-product overrides below may give a better price.
                                </p>
                            </div>

                            {/* Per-Product Pricing */}
                            <div>
                                <label className="block text-sm font-medium text-stone-700 mb-2">
                                    Per-Product Price Overrides
                                </label>
                                <input
                                    type="text"
                                    value={pricingSearch}
                                    onChange={e => setPricingSearch(e.target.value)}
                                    placeholder="Search products..."
                                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 max-h-80 overflow-y-auto pr-1">
                                    {filteredPricingProducts.map(product => (
                                        <div key={product.id} className="flex items-center gap-3">
                                            <div className="flex-grow min-w-0">
                                                <p className="text-sm font-medium text-stone-800 truncate">
                                                    {product.name}
                                                </p>
                                                <p className="text-xs text-stone-400">
                                                    Default: ${product.price.toFixed(2)}
                                                </p>
                                            </div>
                                            <input
                                                type="number"
                                                value={pricingEdits[product.id] ?? ''}
                                                onChange={e => {
                                                    setPricingEdits(prev => ({ ...prev, [product.id]: e.target.value }));
                                                    setPricingSaved(false);
                                                }}
                                                placeholder={product.price.toFixed(2)}
                                                min={0}
                                                step={0.01}
                                                className="w-28 flex-shrink-0 px-2.5 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500"
                                            />
                                        </div>
                                    ))}
                                </div>
                                {filteredPricingProducts.length === 0 && (
                                    <p className="text-center text-stone-500 py-4 text-sm">
                                        No products match your search.
                                    </p>
                                )}
                            </div>

                            {/* Save button */}
                            <div className="pt-3 border-t border-stone-200">
                                <button
                                    onClick={handleSavePricing}
                                    className={`font-medium py-2 px-5 rounded-lg transition-colors text-sm shadow-sm ${
                                        pricingSaved
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-stone-900 text-white hover:bg-stone-800'
                                    }`}
                                >
                                    {pricingSaved ? 'Saved!' : `Save Pricing for ${selectedPricingCustomer.name}`}
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default SettingsPanel;
