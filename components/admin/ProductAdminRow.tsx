import React, { useId, useState } from 'react';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import type { Product } from '../../types';
import type { WarehouseScope } from '../../lib/warehouseScope';
import { classifyStock, lowStockThresholdFor, type StockStatus } from '../../lib/stockStatus';
import OptimizedImage from '../OptimizedImage';
import { PRODUCT_ROW_COLUMNS, ProductMicroLabel } from './productAdminColumns';

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

/** One product, as a single-render container-query grid: a two-tier card at
 *  360px, the same ten columns it has always been on a desk.
 *
 *  ── ONE RENDER, NOT TWO TREES ──────────────────────────────────────────────
 *
 *  Every control appears exactly once; only the grid template changes. Two
 *  parallel trees would mean every later edit to a cell has to be made twice,
 *  and the second is the one that gets forgotten.
 *
 *  ── WHAT MAY COLLAPSE, AND WHAT MAY NOT ────────────────────────────────────
 *
 *  Identity, stock and the selection checkbox stay visible at every width.
 *  Stock is the number this screen is most often opened to check, and the
 *  checkbox is how the bulk brand flow starts — hiding either behind a
 *  disclosure would be a worse defect than the horizontal scroll this replaces.
 *  Supplier, category, brand, price and m³ collapse, and the collapsed tier
 *  still states each of them by name when it is open. */
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
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  // The collapsed tier is two elements (see the note on DOM order below), so
  // the toggle controls both. `aria-controls` takes a space-separated list.
  const detailsTailId = useId();

  const notStockedHere = scope !== 'all' && siteOnHand === undefined;
  const qty = scope === 'all' ? product.inventory : (siteOnHand ?? 0);
  const status: StockStatus | null = notStockedHere ? null : classifyStock(qty, lowStockThresholdFor(product, globalThreshold));

  // `stone-600`, never `stone-500`. Tailwind v4 is OKLCH and `stone-500`
  // renders 4.41:1 on a `stone-100` tint and 3.83:1 on `stone-200` — below AA,
  // and the low-stock row below carries a resting amber tint that only makes it
  // worse. Neither the jsdom axe tier nor eslint can measure contrast, so this
  // is a rule to follow rather than a check to lean on.
  const qtyClass = notStockedHere
    ? 'text-stone-600'
    : status === 'out_of_stock'
      ? 'text-red-600 font-semibold'
      : status === 'low_stock'
        ? 'text-amber-700 font-bold'
        : 'text-stone-700';

  const rowTint = notStockedHere
    ? 'opacity-60 hover:bg-stone-50'
    : status === 'low_stock'
      ? 'bg-amber-50/50'
      : 'hover:bg-stone-50/50';

  return (
    <li className={`transition-colors ${rowTint}`}>
      <div
        className={
          'grid grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-3 ' +
          `@min-[1000px]:items-center @min-[1000px]:gap-y-0 ${PRODUCT_ROW_COLUMNS}`
        }
      >
        {/* Selection. The 44px box is on the LABEL, not the 16px input — a bare
            checkbox is a quarter of the touch floor at a rack face. */}
        {onToggleSelected ? (
          <label className="touch-target -m-1 flex cursor-pointer items-center justify-center p-1">
            <input
              type="checkbox"
              checked={selected === true}
              onChange={(e) => onToggleSelected(product.id, e.target.checked)}
              className="rounded border-stone-300 text-nexgen-blue focus:ring-2 focus:ring-nexgen-blue-dark"
              aria-label={`Select ${product.name}`}
            />
          </label>
        ) : <span />}

        <div className="h-12 w-12 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
          <OptimizedImage
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full"
            transformWidth={96}
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            }
          />
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{product.name}</p>
          <p className="truncate font-mono text-xs text-stone-600 @min-[1000px]:hidden">{product.sku}</p>
        </div>

        {/* ── DOM ORDER IS THE COLUMN ORDER, AND THAT IS WHY THE COLLAPSED TIER
            IS IN TWO PIECES ────────────────────────────────────────────────
            A shared `@container` fixes the WIDTHS and says nothing about the
            ORDER. Stock has to sit beside the name at 360px but in the
            INVENTORY column — 8th of 10 — on a desk, and it must stay visible
            while the rest collapses. With one collapsible group ahead of it,
            stock auto-placed into the 4th cell and rendered under "Supplier",
            shifting every later column one to the right; forcing it to cell 8
            instead pushed the auto-flow onto a second row. Both were the same
            mistake: fighting auto-placement rather than feeding it the right
            order. So the tier is split around stock, DOM order now reads
            supplier · category · brand · price · STOCK · m³ · actions exactly
            as the heading strip does, and nothing needs explicit placement
            above 1000px. */}
        <div
          id={detailsId}
          className={`${open ? 'grid' : 'hidden'} col-span-4 grid-cols-2 gap-x-3 gap-y-2 @min-[1000px]:contents`}
        >
          <div className="min-w-0">
            <ProductMicroLabel>Supplier</ProductMicroLabel>
            <span className="block truncate text-sm text-stone-600">{supplierName}</span>
          </div>
          <div className="min-w-0">
            <ProductMicroLabel>Category</ProductMicroLabel>
            <span className="block truncate text-sm text-stone-600">{product.category}</span>
          </div>
          <div className="min-w-0">
            <ProductMicroLabel>Brand</ProductMicroLabel>
            <span className="block truncate text-sm text-stone-600">{product.brand || '—'}</span>
          </div>
          <div className="min-w-0">
            <ProductMicroLabel>Price</ProductMicroLabel>
            <span className="block font-mono text-sm tabular-nums text-stone-700">${product.price.toFixed(2)}</span>
          </div>
        </div>

        {/* Stock: explicitly placed at 360px only (column 4 of 4, beside the
            name), auto above 1000px where DOM order already lands it under
            INVENTORY. */}
        <div className="col-start-4 row-start-1 text-right @min-[1000px]:col-start-auto @min-[1000px]:row-start-auto @min-[1000px]:text-left">
          <ProductMicroLabel>Stock</ProductMicroLabel>
          {notStockedHere ? (
            <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
              Not stocked here
            </span>
          ) : (
            <span className={`block font-mono text-sm tabular-nums ${qtyClass}`}>{qty}</span>
          )}
        </div>

        <div
          id={detailsTailId}
          className={`${open ? 'grid' : 'hidden'} col-span-4 grid-cols-2 gap-x-3 gap-y-2 @min-[1000px]:contents`}
        >
          <div className="min-w-0">
            <ProductMicroLabel>m³</ProductMicroLabel>
            <span className="block text-xs text-stone-600">
              {product.cubicMetersUnit != null && (
                <span className="block"><span className="font-medium text-stone-700 tabular-nums">{product.cubicMetersUnit.toFixed(4)}</span> /unit</span>
              )}
              {product.cubicMetersCarton != null && (
                <span className="block"><span className="font-medium text-stone-700 tabular-nums">{product.cubicMetersCarton.toFixed(4)}</span> /ctn</span>
              )}
              {product.cubicMetersUnit == null && product.cubicMetersCarton == null && '—'}
            </span>
          </div>

          {/* Full-height buttons, not the 14px text links this replaced — on a
              360px screen a gloved thumb misses a 14px "Delete" and hits "Edit",
              or the row. */}
          <div className="col-span-2 flex items-center gap-2 @min-[1000px]:col-span-1 @min-[1000px]:justify-end">
            <button
              type="button"
              onClick={() => onEdit(product)}
              aria-label={`Edit ${product.name}`}
              className="touch-target-y inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 btn-press @min-[1000px]:flex-none @min-[1000px]:border-0 @min-[1000px]:px-2"
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="@min-[1000px]:sr-only">Edit</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(product)}
              aria-label={`Delete ${product.name}`}
              className="touch-target-y inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 btn-press @min-[1000px]:flex-none @min-[1000px]:border-0 @min-[1000px]:px-2"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="@min-[1000px]:sr-only">Delete</span>
            </button>
          </div>
        </div>

        {/* The toggle exists only on the narrow layout — above 1000px every
            field is already a cell of the row. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${detailsId} ${detailsTailId}`}
          className="touch-target-y col-span-4 -mx-1 flex items-center gap-1.5 rounded-lg px-1 text-left text-xs text-stone-600 hover:bg-stone-100 btn-press @min-[1000px]:hidden"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          {open ? 'Fewer details' : `Supplier, price, m³ · ${product.category}`}
        </button>
      </div>
    </li>
  );
};

export default ProductAdminRow;
