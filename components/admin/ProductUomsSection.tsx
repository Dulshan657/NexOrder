// Editor for a product's ADDITIONAL units of measure (mig 00067) — the packs
// above the base unit, e.g. carton, pallet, drum. The base unit is implied by
// the form's Unit + Price fields; this manages the higher tiers, each a whole-
// number multiple of the base with its own explicit price and optional volume
// (mig 00069). The parent assembles the full UOM list (base + these) at save time.
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CreatableSelect } from '../ui';
import { withCurrentValue } from '../../lib/productTaxonomy';

// A non-base UOM row as edited in the form (strings for controlled inputs).
export interface ExtraUomDraft {
    code: string;
    factorToBase: string;   // whole units of the base per 1 of this UOM (> 1)
    price: string;          // explicit price for 1 of this UOM
    cubicMeters?: string;   // m³ for 1 of this UOM; blank/absent = inherit factor × base volume
    isOrderable: boolean;
    isReceivable: boolean;
}

interface ProductUomsSectionProps {
    baseUnitLabel: string;
    basePrice: string;
    /** The form's per-unit m³, shown so the operator knows what a blank row inherits. */
    baseVolume?: string;
    /** Unit names offered by each row's dropdown (curated + already in the catalog). */
    unitOptions: readonly string[];
    extraUoms: ExtraUomDraft[];
    onChange: (next: ExtraUomDraft[]) => void;
}

export function newExtraUom(): ExtraUomDraft {
    return { code: '', factorToBase: '', price: '', cubicMeters: '', isOrderable: true, isReceivable: true };
}

const inputClasses = "block w-full rounded-lg border-0 bg-white py-2 px-2.5 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm";

const ProductUomsSection: React.FC<ProductUomsSectionProps> = ({
    baseUnitLabel, basePrice, baseVolume, unitOptions, extraUoms, onChange,
}) => {
    const update = (index: number, patch: Partial<ExtraUomDraft>) => {
        onChange(extraUoms.map((u, i) => (i === index ? { ...u, ...patch } : u)));
    };
    const remove = (index: number) => onChange(extraUoms.filter((_, i) => i !== index));
    const add = () => onChange([...extraUoms, newExtraUom()]);

    return (
        <div className="bg-stone-50 rounded-lg p-4 border border-stone-200 space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-stone-700">Units of measure</h3>
                <p className="text-[11px] text-stone-500 mt-0.5">
                    Base unit <span className="font-medium text-stone-600">{baseUnitLabel || 'each'}</span> @ ${basePrice || '0'} is
                    set above. Add larger packs (carton, pallet…) as whole multiples of the base, each with its own price.
                    Leave a volume blank to inherit {baseVolume ? `${baseVolume} m³` : 'the per-unit m³'} × its base units.
                </p>
            </div>

            {extraUoms.length > 0 && (
                <div className="space-y-2">
                    <div className="hidden sm:grid grid-cols-[1.4fr_1fr_1fr_1fr_auto_auto_auto] gap-2 text-[11px] font-medium text-stone-500 px-0.5">
                        <span>Name</span><span>Base units each</span><span>Price</span><span>Volume (m³)</span>
                        <span>Order</span><span>Receive</span><span></span>
                    </div>
                    {extraUoms.map((u, i) => (
                        <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto_auto_auto] gap-2 items-center">
                            <CreatableSelect
                                value={u.code}
                                onChange={code => update(i, { code })}
                                options={withCurrentValue(unitOptions, u.code)}
                                emptyLabel="Unit name…"
                                customLabel="Other unit…"
                                placeholder="carton"
                                ariaLabel="Unit name"
                                className={inputClasses}
                            />
                            <input
                                type="number" min="2" step="1" value={u.factorToBase}
                                onChange={e => update(i, { factorToBase: e.target.value })}
                                placeholder="12" aria-label="Base units per unit" className={inputClasses}
                            />
                            <input
                                type="number" min="0" step="0.01" value={u.price}
                                onChange={e => update(i, { price: e.target.value })}
                                placeholder="0.00" aria-label="Price" className={inputClasses}
                            />
                            <input
                                type="number" min="0" step="0.0001" value={u.cubicMeters ?? ''}
                                onChange={e => update(i, { cubicMeters: e.target.value })}
                                placeholder="inherit" aria-label="Volume in cubic meters" className={inputClasses}
                            />
                            <label className="flex items-center justify-center" title="Customers can order this unit">
                                <input type="checkbox" checked={u.isOrderable} onChange={e => update(i, { isOrderable: e.target.checked })}
                                    aria-label="Orderable" className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-600" />
                            </label>
                            <label className="flex items-center justify-center" title="Stock can be received in this unit">
                                <input type="checkbox" checked={u.isReceivable} onChange={e => update(i, { isReceivable: e.target.checked })}
                                    aria-label="Receivable" className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-600" />
                            </label>
                            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${u.code || 'unit'}`}
                                className="text-stone-500 hover:text-red-600 transition-colors flex items-center justify-center">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <button type="button" onClick={add}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-900 transition-colors">
                <Plus className="h-4 w-4" /> Add a unit
            </button>
        </div>
    );
};

export default ProductUomsSection;
