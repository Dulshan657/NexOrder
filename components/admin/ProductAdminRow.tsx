import React from 'react';
import type { Product } from '../../types';
import type { WarehouseScope } from '../../lib/warehouseScope';
import { classifyStock, lowStockThresholdFor, type StockStatus } from '../../lib/stockStatus';
import OptimizedImage from '../OptimizedImage';

interface ProductAdminRowProps {
  product: Product;
  supplierName: string;
  /** The active warehouse scope — 'all' reads `product.inventory` (the global
   * cache, byte-identical to pre-scoping behaviour); a numeric site id reads
   * `siteOnHand` instead. */
  scope: WarehouseScope;
  /** On-hand at the scoped site, from `useProductStockByWarehouse`. `undefined`
   * means the product has NO balance row in that site's subtree at all — NOT
   * the same as a real `0` balance — and renders as "Not stocked here". Only
   * meaningful when `scope !== 'all'`. */
  siteOnHand: number | undefined;
  globalThreshold: number;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  /** Bulk selection (mig 00114's brand assign). `undefined` for callers that
   *  do not offer selection, which keeps the checkbox column out of their DOM
   *  entirely rather than rendering a disabled one. */
  selected?: boolean;
  onToggleSelected?: (id: number, next: boolean) => void;
}

/** Extracted from ProductAdmin so the parent file stays under ~400 lines. */
export const ProductAdminRow: React.FC<ProductAdminRowProps> = ({
  product,
  supplierName,
  scope,
  siteOnHand,
  globalThreshold,
  onEdit,
  onDelete,
  selected,
  onToggleSelected,
}) => {
  const notStockedHere = scope !== 'all' && siteOnHand === undefined;
  const qty = scope === 'all' ? product.inventory : (siteOnHand ?? 0);
  const status: StockStatus | null = notStockedHere ? null : classifyStock(qty, lowStockThresholdFor(product, globalThreshold));

  const textClass = notStockedHere
    ? 'text-stone-500'
    : status === 'out_of_stock'
      ? 'text-red-600 font-semibold'
      : status === 'low_stock'
        ? 'text-amber-600 font-bold'
        : 'text-stone-500';

  const rowClass = notStockedHere
    ? 'opacity-50 hover:bg-stone-50 transition-colors'
    : status === 'low_stock'
      ? 'bg-amber-50/50'
      : 'hover:bg-stone-50 transition-colors';

  return (
    <tr className={rowClass}>
      {onToggleSelected && (
        <td className="pl-6 pr-2 py-4">
          <input
            type="checkbox"
            checked={selected === true}
            onChange={(e) => onToggleSelected(product.id, e.target.checked)}
            className="rounded border-stone-300 text-nexgen-blue focus:ring-nexgen-blue/30"
            aria-label={`Select ${product.name}`}
          />
        </td>
      )}
      <td className="px-6 py-4">
        <div className="w-12 h-12 bg-stone-100 rounded-lg flex items-center justify-center border border-stone-200 overflow-hidden">
          <OptimizedImage
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full"
            transformWidth={96}
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            }
          />
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">{product.name}</td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">{supplierName}</td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">{product.category}</td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">
        {product.brand || <span className="text-stone-300">—</span>}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">${product.price.toFixed(2)}</td>
      <td className={`px-6 py-4 whitespace-nowrap text-sm ${textClass}`}>
        {notStockedHere ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-stone-100 text-stone-500">Not stocked here</span>
        ) : (
          qty
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-xs text-stone-500">
        {product.cubicMetersUnit != null && (
          <div>
            <span className="font-medium text-stone-700">{product.cubicMetersUnit.toFixed(4)}</span>
            <span className="text-stone-500"> /unit</span>
          </div>
        )}
        {product.cubicMetersCarton != null && (
          <div>
            <span className="font-medium text-stone-700">{product.cubicMetersCarton.toFixed(4)}</span>
            <span className="text-stone-500"> /ctn</span>
          </div>
        )}
        {product.cubicMetersUnit == null && product.cubicMetersCarton == null && '—'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
        <button onClick={() => onEdit(product)} className="text-emerald-600 hover:text-emerald-900 transition-colors">Edit</button>
        <button onClick={() => onDelete(product)} className="text-red-600 hover:text-red-900 transition-colors">Delete</button>
      </td>
    </tr>
  );
};

export default ProductAdminRow;
