import React, { useMemo, useState } from 'react';
import type { Promotion, Product } from '../types';
import { Package2 } from 'lucide-react';
import { cartonPrice as calcCartonPrice } from '../pricing';
import { Button, Modal, NumberInput } from './ui';

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

    // Captured once, so the dirty guard compares against the quantities the modal opened with.
    const [initialQuantities] = useState<Record<number, number>>(
        () => Object.fromEntries(bundleProducts.map(p => [p.id, 1]))
    );
    const [quantities, setQuantities] = useState<Record<number, number>>(initialQuantities);

    const isDirty = useMemo(
        () => Object.entries(initialQuantities).some(([id, qty]) => quantities[Number(id)] !== qty),
        [quantities, initialQuantities],
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
        <Modal
            open
            onClose={onClose}
            size="xl"
            dirty={isDirty}
            icon={<Package2 className="w-4 h-4 text-nexgen-blue" />}
            title={promotion.name}
            description={`Bundle price: $${bundle.bundlePrice.toFixed(2)} • per ${appliesTo}`}
            footer={({ requestClose }) => (
                <>
                    <Button variant="secondary" onClick={requestClose}>Cancel</Button>
                    <Button onClick={handleSubmit}>Add to Order</Button>
                </>
            )}
        >
            <p className="text-sm text-stone-600 mb-3">{promotion.description || 'Select quantities for each bundle product.'}</p>
            <div className="overflow-x-auto">
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
                              <td className="py-2">
                                  {/* Inputs are always w-full, so the width is constrained by the wrapper. */}
                                  <div className="w-20 ml-auto">
                                      <NumberInput
                                          dense
                                          min={0}
                                          aria-label={`Quantity for ${p.name}`}
                                          value={quantities[p.id] ?? 0}
                                          onChange={e => setQuantities(prev => ({ ...prev, [p.id]: Math.max(0, Number(e.target.value) || 0) }))}
                                          className="text-right"
                                      />
                                  </div>
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
            </div>
        </Modal>
    );
};

export default BundleSelectModal;
