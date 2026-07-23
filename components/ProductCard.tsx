import React, { useMemo, useState } from 'react';
import type { Product, HoReCa, OrderingHint, Promotion, User, PromoBadgeType, ProductUom } from '../types';
import { Heart, RotateCcw, Clock, Plus } from 'lucide-react';
import { resolveHoReCaPrice, resolvePromotionPrice, getAllApplicablePromotions, resolveUomLinePrice } from '../pricing';
import { orderableUoms, deriveDefaultUoms } from '../lib/uom';
import OptimizedImage from './OptimizedImage';

interface ProductCardProps {
  product: Product;
  onAddItem: (product: Product, options: { packSize?: number; price: number; unit: string; uomId?: number }, quantity?: number) => void;
  selectedHoReCa: HoReCa | null;
  onTogglePantry?: (productId: number) => void;
  isPantryItem?: boolean;
  cartonDiscountPercent?: number;
  lowStockThreshold?: number;
  hints?: OrderingHint[];
  promotions?: Promotion[];
  currentUser?: User | null;
}

const getStockBadge = (inventory: number, threshold: number = 10) => {
  if (inventory <= 0) {
    return <span className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">Out of Stock</span>;
  }
  if (inventory < threshold) {
    return <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">Low Stock ({inventory})</span>;
  }
  return <span className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">In Stock</span>;
};

const DIETARY_BADGE_COLORS: Record<string, string> = {
  GF: 'bg-amber-100 text-amber-800 border-amber-200',
  VEGAN: 'bg-green-100 text-green-800 border-green-200',
  ORGANIC: 'bg-lime-100 text-lime-800 border-lime-200',
};

const PROMO_BADGE_STYLES: Record<PromoBadgeType, string> = {
  CLEARANCE: 'bg-red-500 text-white',
  SALE: 'bg-amber-500 text-white',
  PROMO: 'bg-amber-500 text-white',
  BOGO: 'bg-purple-500 text-white',
  BUNDLE: 'bg-blue-500 text-white',
};

const ProductCard: React.FC<ProductCardProps> = ({ product, onAddItem, selectedHoReCa, onTogglePantry, isPantryItem, cartonDiscountPercent = 5, lowStockThreshold = 10, hints = [], promotions = [], currentUser }) => {
  // Reservable stock (on-hand − allocated), not physical on-hand — this is what
  // the order can actually reserve, so the shop badges/gates must use it.
  const isOutOfStock = product.available <= 0;

  // Use promotion-aware pricing if promotions are available
  const priceRes = promotions.length > 0
    ? resolvePromotionPrice(product, selectedHoReCa, currentUser ?? null, promotions)
    : null;

  const unitPrice = priceRes ? priceRes.finalPrice : resolveHoReCaPrice(product, selectedHoReCa);
  const hasCustomPrice = unitPrice < product.price;
  const savingsPercent = priceRes ? priceRes.savingsPercent : (hasCustomPrice ? Math.round((1 - unitPrice / product.price) * 100) : 0);
  const promoBadge = priceRes?.badge ?? null;

  // Check for BOGO promo text
  const allApplicable = promotions.length > 0 ? getAllApplicablePromotions(product, selectedHoReCa, currentUser ?? null, promotions) : [];
  const bogoPromo = allApplicable.find(p => p.type === 'bogo' && p.bogoConfig);

  // Orderable UOMs (mig 00067): the product's own list, or a base+carton default
  // for rows read before the UOM backfill. The dropdown drives packSize + price.
  const uoms = useMemo(
    () => {
      const list = orderableUoms(product.uoms);
      return list.length > 0 ? list : orderableUoms(deriveDefaultUoms(product.unit, product.price, product.cartonSize, cartonDiscountPercent));
    },
    [product.uoms, product.unit, product.price, product.cartonSize, cartonDiscountPercent],
  );
  const [selectedUomId, setSelectedUomId] = useState<number | null>(null);
  const selectedUom: ProductUom | undefined =
    uoms.find(u => u.id === selectedUomId) ?? uoms.find(u => u.isBase) ?? uoms[0];
  const [qty, setQty] = useState(1);

  const linePrice = selectedUom
    ? resolveUomLinePrice(product, selectedUom, selectedHoReCa, currentUser ?? null, promotions)
    : unitPrice;

  const handleAdd = () => {
    if (!selectedUom) return;
    onAddItem(
      product,
      {
        packSize: selectedUom.isBase ? undefined : selectedUom.factorToBase,
        price: linePrice,
        unit: selectedUom.code,
        uomId: selectedUom.id > 0 ? selectedUom.id : undefined,
      },
      Math.max(1, Math.floor(qty) || 1),
    );
  };

  return (
    <div className={`group bg-white rounded-xl shadow-card border border-stone-200/60 overflow-hidden flex flex-col transition-all duration-300 ${isOutOfStock ? 'opacity-60' : 'hover:shadow-card-hover hover:border-stone-300'}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-stone-100">
        <OptimizedImage
          src={product.imageUrl}
          alt={product.name}
          className="w-full h-full"
          imgClassName="object-cover transition-transform duration-700 group-hover:scale-105"
          transformWidth={600}
          fallback={
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-center text-stone-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
            </div>
          }
        />
        <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm text-stone-800 text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">{product.category}</span>
        {promoBadge && (
          <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-1 rounded-full shadow-sm z-[5] ${PROMO_BADGE_STYLES[promoBadge]} ${isPantryItem ? 'right-14' : ''}`}>
            {promoBadge}
          </span>
        )}

        {/* Pantry Toggle */}
        {onTogglePantry && (
            <button
                onClick={(e) => { e.stopPropagation(); onTogglePantry(product.id); }}
                className={`absolute top-3 right-3 p-2.5 rounded-full shadow-sm backdrop-blur-sm transition-all duration-200 z-10 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 ${
                    isPantryItem
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                        : 'bg-white/90 text-stone-400 hover:text-emerald-500 hover:bg-white'
                }`}
                aria-label={isPantryItem ? `Remove ${product.name} from pantry` : `Add ${product.name} to pantry`}
            >
                <Heart className={`w-4 h-4 ${isPantryItem ? 'fill-current' : ''}`} />
            </button>
        )}

      </div>
      <div className="p-5 flex flex-col flex-grow">
        <h3 className="text-lg font-display font-semibold text-stone-900 leading-tight tracking-tight">{product.name}</h3>
        {/* Dietary Labels */}
        {product.dietaryLabels && product.dietaryLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {product.dietaryLabels.map(label => (
              <span key={label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${DIETARY_BADGE_COLORS[label] ?? 'bg-stone-100 text-stone-600 border-stone-200'}`}>
                {label}
              </span>
            ))}
          </div>
        )}
        {/* Buying Pattern Hints */}
        {hints.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {hints.filter(h => h.type === 'typical_quantity').slice(0, 1).map(h => (
              <span key={h.type} className="inline-flex items-center gap-1 text-[11px] text-stone-600 bg-stone-50 border border-stone-200 px-2 py-0.5 rounded-full">
                <RotateCcw className="w-3 h-3" />
                Usually orders {h.value}
              </span>
            ))}
            {hints.filter(h => h.type === 'reorder_due').slice(0, 1).map(h => (
              <span key={h.type} className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <Clock className="w-3 h-3" />
                Due for reorder
              </span>
            ))}
            {hints.filter(h => h.type === 'last_ordered').slice(0, 1).map(h => (
              <span key={h.type} className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                <Clock className="w-3 h-3" />
                {h.message}
              </span>
            ))}
          </div>
        )}
        <p className="text-sm text-stone-500 mt-2 flex-grow line-clamp-2">{product.description}</p>
        {product.cubicMetersUnit != null && (
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-stone-400">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8 15V8M8 8L2 4.5M8 8L14 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span>{product.cubicMetersUnit.toFixed(4)} m³/unit</span>
            {product.cubicMetersCarton != null && (
              <span className="text-stone-300">· {product.cubicMetersCarton.toFixed(3)} m³/ctn</span>
            )}
          </div>
        )}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-baseline gap-1.5 flex-wrap">
                 <p className="text-xl font-semibold text-stone-900 tracking-tight tabular-nums">
                    ${unitPrice.toFixed(2)}
                 </p>
                 <span className="text-sm text-stone-500">/ {product.unit}</span>
                 {hasCustomPrice && (
                     <>
                         <span className="text-sm text-stone-400 line-through ml-1">${product.price.toFixed(2)}</span>
                         <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full ml-1">
                             Save {savingsPercent}%
                         </span>
                     </>
                 )}
             </div>
            {getStockBadge(product.available, lowStockThreshold)}
          </div>
          {bogoPromo && bogoPromo.bogoConfig && (
            <p className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1 mb-2 text-center">
              Buy {bogoPromo.bogoConfig.buyQuantity}, Get {bogoPromo.bogoConfig.getQuantity} Free!
            </p>
          )}
          {!isOutOfStock && selectedUom && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <select
                  aria-label={`Unit of measure for ${product.name}`}
                  value={selectedUom.id}
                  onChange={e => setSelectedUomId(Number(e.target.value))}
                  className="flex-1 min-w-0 rounded-lg border-0 bg-stone-50 py-2 px-2.5 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-inset focus:ring-emerald-600 text-sm"
                >
                  {uoms.map(u => (
                    <option key={`${u.id}-${u.code}`} value={u.id}>
                      {u.code}{u.isBase ? '' : ` (×${u.factorToBase})`} — ${resolveUomLinePrice(product, u, selectedHoReCa, currentUser ?? null, promotions).toFixed(2)}
                    </option>
                  ))}
                </select>
                <input
                  type="number" min="1" step="1" value={qty}
                  onChange={e => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                  aria-label={`Quantity for ${product.name}`}
                  className="w-16 rounded-lg border-0 bg-stone-50 py-2 px-2 text-center text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-inset focus:ring-emerald-600 text-sm tabular-nums"
                />
              </div>
              <button
                onClick={handleAdd}
                className="w-full inline-flex items-center justify-center gap-1.5 bg-nexgen-blue text-white font-medium py-2 px-2 rounded-lg hover:bg-nexgen-blue-dark btn-press cursor-pointer text-sm"
              >
                <Plus className="h-4 w-4" /> Add <span className="text-blue-100 tabular-nums">(${(linePrice * Math.max(1, Math.floor(qty) || 1)).toFixed(2)})</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
