// Editor for the suppliers a product can be bought from (mig 00070). The same
// item is often sourced from several suppliers, each with their OWN part number
// and cost. Exactly one link is the primary one — the server mirrors it into
// products.supplier_id, so every legacy single-supplier read site keeps working.
//
// Receive Stock uses these links to narrow its product picker to the delivering
// supplier, and matches the part number typed off their docket.
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Supplier } from '../../types';

// One supplier link as edited in the form (strings for controlled inputs).
export interface SupplierLinkDraft {
    supplierId: string;
    supplierSku: string;  // the supplier's own code for this item
    costPrice: string;    // what they charge per BASE unit
    isPrimary: boolean;
}

interface ProductSuppliersSectionProps {
    suppliers: Supplier[];
    links: SupplierLinkDraft[];
    onChange: (next: SupplierLinkDraft[]) => void;
}

const inputClasses = "block w-full rounded-lg border-0 bg-white py-2 px-2.5 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-500 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm";

const ProductSuppliersSection: React.FC<ProductSuppliersSectionProps> = ({
    suppliers, links, onChange,
}) => {
    const update = (index: number, patch: Partial<SupplierLinkDraft>) => {
        onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    };

    // Primary is single-choice: setting one clears the rest. Modelled as radios
    // so the invariant is enforced by the control, not by validation after the fact.
    const setPrimary = (index: number) => {
        onChange(links.map((l, i) => ({ ...l, isPrimary: i === index })));
    };

    const remove = (index: number) => {
        const next = links.filter((_, i) => i !== index);
        // Removing the primary would leave the product with none — promote the
        // first survivor so products.supplier_id always resolves.
        if (next.length > 0 && !next.some(l => l.isPrimary)) next[0] = { ...next[0], isPrimary: true };
        onChange(next);
    };

    const add = () => onChange([
        ...links,
        { supplierId: '', supplierSku: '', costPrice: '', isPrimary: links.length === 0 },
    ]);

    return (
        <div className="bg-stone-50 rounded-lg p-4 border border-stone-200 space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-stone-700">Suppliers</h3>
                <p className="text-[11px] text-stone-500 mt-0.5">
                    Who this product can be bought from. Add their own part number so goods-in can
                    match it against a delivery docket. The primary supplier is the one shown
                    everywhere a single supplier is expected.
                </p>
            </div>

            {links.length > 0 && (
                <div className="space-y-2">
                    <div className="hidden sm:grid grid-cols-[1.6fr_1.2fr_1fr_auto_auto] gap-2 text-[11px] font-medium text-stone-500 px-0.5">
                        <span>Supplier</span><span>Their part no.</span><span>Cost / unit</span>
                        <span>Primary</span><span></span>
                    </div>
                    {links.map((l, i) => (
                        <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.6fr_1.2fr_1fr_auto_auto] gap-2 items-center">
                            <select
                                value={l.supplierId}
                                onChange={e => update(i, { supplierId: e.target.value })}
                                aria-label="Supplier"
                                className={inputClasses}
                            >
                                <option value="">Select a supplier…</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <input
                                type="text" value={l.supplierSku}
                                onChange={e => update(i, { supplierSku: e.target.value })}
                                placeholder="optional" aria-label="Supplier part number" className={inputClasses}
                            />
                            <input
                                type="number" min="0" step="0.01" value={l.costPrice}
                                onChange={e => update(i, { costPrice: e.target.value })}
                                placeholder="optional" aria-label="Cost price" className={inputClasses}
                            />
                            <label className="flex items-center justify-center" title="The product's main supplier">
                                <input
                                    type="radio" checked={l.isPrimary} onChange={() => setPrimary(i)}
                                    aria-label={`Primary supplier${l.supplierId ? '' : ' for this row'}`}
                                    className="h-4 w-4 border-stone-300 text-emerald-600 focus:ring-emerald-600"
                                />
                            </label>
                            <button
                                type="button" onClick={() => remove(i)}
                                aria-label="Remove supplier"
                                disabled={links.length === 1}
                                className="text-stone-500 hover:text-red-600 transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-stone-400"
                                title={links.length === 1 ? 'A product needs at least one supplier' : 'Remove supplier'}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <button type="button" onClick={add}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-900 transition-colors">
                <Plus className="h-4 w-4" /> Add a supplier
            </button>
        </div>
    );
};

export default ProductSuppliersSection;
