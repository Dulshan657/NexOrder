import React, { useState } from 'react';
import type { Promotion, Product } from '../types';
import { X, Package2 } from 'lucide-react';
import { cartonPrice as calcCartonPrice } from '../pricing';

interface BundleSelectModalProps {
    promotion: Promotion;
    products: Product[];
    cartonDiscountPercent: number;
    onClose: () => void;
    onConfirm: (rows: Array<{ product: Product; quantity: number; packSize?: number; price: number; unit: string }>) => void;
}

const BundleSelectModal: React.FC<BundleSelectModalProps> = ({ promotion, products, cartonDiscountPercent, onClose, onConfirm }) => {
    const bundle = promotion.bundleConfig;
    const appliesTo = promotion.appliesTo ?? 'unit';

    const bundleProducts = (bundle?.productIds ?? [])
        .map(pid => products.find(p => p.id === pid))
        .filter((p): p is Product => !!p);

    const [quantities, setQuantities] = useState<Record<number, number>>(
        Object.fromEntries(bundleProducts.map(p => [p.id, 1]))
    );

    if (!bundle) return null;

    const handleSubmit = () => {
        const rows = bundleProducts
            .map(product => {
                const qty = quantities[product.id] ?? 0;
                if (qty <= 0) return null;
                const isCarton = appliesTo === 'carton';
                const packSize = isCarton ? product.cartonSize : undefined;
                const unit = isCarton ? `Carton (x${product.cartonSize})` : product.unit;
                const price = isCarton
                    ? calcCartonPrice(product.price, product.cartonSize, cartonDiscountPercent)
                    : product.price;
                return { product, quantity: qty, packSize, price, unit };
            })
            .filter((r): r is NonNullable<typeof r> => !!r);
        onConfirm(rows);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-5 border-b border-stone-200">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <Package2 className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-stone-900">{promotion.name}</h2>
                            <p className="text-xs text-stone-500">Bundle price: ${bundle.bundlePrice.toFixed(2)} • per {appliesTo}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5">
                    <p className="text-sm text-stone-600 mb-3">{promotion.description || 'Select quantities for each bundle product.'}</p>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-stone-500 border-b border-stone-200">
                                <th className="py-2">Product</th>
                                <th className="py-2">Unit</th>
                                <th className="py-2 text-right">Qty</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                            {bundleProducts.map(p => (
                                <tr key={p.id}>
                                    <td className="py-2 text-stone-800">{p.name}</td>
                                    <td className="py-2 text-stone-500 text-xs">
                                        {appliesTo === 'carton' ? `Carton (x${p.cartonSize})` : p.unit}
                                    </td>
                                    <td className="py-2 text-right">
                                        <input
                                            type="number"
                                            min={0}
                                            value={quantities[p.id] ?? 0}
                                            onChange={e => setQuantities(prev => ({ ...prev, [p.id]: Math.max(0, Number(e.target.value) || 0) }))}
                                            className="w-20 border border-stone-300 rounded-lg py-1 px-2 text-right focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex justify-end gap-3 p-5 border-t border-stone-200">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 font-medium cursor-pointer">Cancel</button>
                    <button onClick={handleSubmit} className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium cursor-pointer">Add to Order</button>
                </div>
            </div>
        </div>
    );
};

export default BundleSelectModal;
