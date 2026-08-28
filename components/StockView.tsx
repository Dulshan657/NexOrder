import React, { useState, useMemo } from 'react';
import type { Product, User, Category } from '../types';
import { UserRole } from '../types';
import { Package, AlertCircle, CheckCircle2, Search, X, Repeat, FileUp } from 'lucide-react';
import { categoryOptions } from '../lib/productTaxonomy';
import { useSettings } from '../hooks/queries/useSettings';
import { classifyStock, lowStockThresholdFor } from '../lib/stockStatus';
import { useWarehouseScope } from '../context/WarehouseScopeContext';
import { WarehousePicker } from './inventory/WarehousePicker';
import { useScopedStock } from '../hooks/useScopedStock';
import { OpsStockRow, StatusPill } from './stock/OpsStockRow';
import { StockKpiTiles } from './stock/StockKpiTiles';
import TransferStockModal from './admin/TransferStockModal';
import StockImportModal from './admin/StockImportModal';
import { useFlagDeepLink } from '../hooks/useFlagDeepLink';

interface StockViewProps {
  products: Product[];
  currentUser: User;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';

const StockView: React.FC<StockViewProps> = ({ products, currentUser, addToast }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortBy, setSortBy] = useState<'name' | 'inventory_asc' | 'inventory_desc'>('name');

  const isCustomer = currentUser.role === UserRole.CUSTOMER;
  const isOps = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER || currentUser.role === UserRole.WAREHOUSE;
  const isAdminManager = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;
  const [transferOpen, setTransferOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ?stockimport=1 — the setup checklist's "import opening stock" step. Named
  // `stockimport` rather than `import`, which is already read globally as the
  // warehouse floor-plan import and would drag Settings to its Warehouse tab.
  useFlagDeepLink('stockimport', () => setImportOpen(true), isAdminManager);

  // Only the ops branch (Admin/Manager/Warehouse) scopes to a warehouse — the
  // rep and customer branches must keep reading the global aggregate exactly
  // as they do today.
  const { scope } = useWarehouseScope();
  const effectiveScope = isOps ? scope : 'all';

  // Ledger (scoped or global) is the source of truth for staff; customers see
  // the products cache.
  const { aggByProduct, isLoading: balancesLoading } = useScopedStock(effectiveScope);
  // Global low-stock fallback; each product may override via its reorderPoint.
  const { data: settings } = useSettings();
  const globalThreshold = settings?.low_stock_threshold ?? 10;

  const aggOf = (p: Product) => aggByProduct.get(p.id) ?? { onHand: 0, allocated: 0, available: 0 };
  // Customers can't read the ledger (balances RLS is staff-only), so they get
  // the products.available cache; staff get the live aggregated ledger available.
  const qtyOf = (p: Product): number => (isCustomer ? p.available : aggOf(p).available);

  const metrics = useMemo(() => {
    const total = products.length;
    let inStock = 0, lowStock = 0, outOfStock = 0;
    for (const p of products) {
      const status = classifyStock(qtyOf(p), lowStockThresholdFor(p, globalThreshold));
      if (status === 'out_of_stock') outOfStock++;
      else if (status === 'low_stock') lowStock++;
      else inStock++;
    }
    return { total, inStock, lowStock, outOfStock };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, aggByProduct, isCustomer, globalThreshold]);

  // Built-ins first, then any operator-created category — filtered to the ones
  // actually present so the chip row doesn't list empty categories.
  const activeCategories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return categoryOptions(products).filter(c => cats.has(c));
  }, [products]);

  const filteredProducts = useMemo(() => {
    let filtered = [...products];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'All') filtered = filtered.filter(p => p.category === categoryFilter);
    if (stockFilter !== 'all') filtered = filtered.filter(p => classifyStock(qtyOf(p), lowStockThresholdFor(p, globalThreshold)) === stockFilter);
    filtered.sort((a, b) => {
      if (sortBy === 'inventory_asc') return qtyOf(a) - qtyOf(b);
      if (sortBy === 'inventory_desc') return qtyOf(b) - qtyOf(a);
      return a.name.localeCompare(b.name);
    });
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, searchQuery, categoryFilter, stockFilter, sortBy, aggByProduct, isCustomer, globalThreshold]);

  const maxQty = useMemo(() => Math.max(...products.map(p => qtyOf(p)), 1), [products, aggByProduct, isCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Stock Levels</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {isCustomer
              ? 'Product availability overview'
              : `${products.length} products · live from the inventory ledger`}
          </p>
        </div>
        {isOps && (
          <div className="flex items-center gap-2 self-start">
            <WarehousePicker />
            {isAdminManager && (
              <>
                <button
                  onClick={() => setImportOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-stone-300 text-stone-700 hover:bg-stone-50 btn-press"
                >
                  <FileUp className="w-4 h-4" /> Import stock
                </button>
                <button
                  onClick={() => setTransferOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
                >
                  <Repeat className="w-4 h-4" /> Transfer stock
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {transferOpen && <TransferStockModal products={products} onClose={() => setTransferOpen(false)} />}
      {importOpen && (
        <StockImportModal products={products} addToast={addToast} onClose={() => setImportOpen(false)} />
      )}

      {/* KPI Summary — staff only */}
      {!isCustomer && <StockKpiTiles metrics={metrics} />}

      {/* Filters Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
            <input
              type="text"
              placeholder={isCustomer ? 'Search products...' : 'Search by name, SKU, or category...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-600 cursor-pointer"><X className="w-4 h-4" /></button>
            )}
          </div>
          <div className="flex gap-2">
            <select value={stockFilter} onChange={e => setStockFilter(e.target.value as StockFilter)} className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 cursor-pointer">
              <option value="all">All Status</option>
              <option value="in_stock">In Stock</option>
              <option value="low_stock">Low Stock</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
            {!isCustomer && (
              <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 cursor-pointer">
                <option value="name">Sort: Name</option>
                <option value="inventory_asc">Sort: Available (Low first)</option>
                <option value="inventory_desc">Sort: Available (High first)</option>
              </select>
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setCategoryFilter('All')} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${categoryFilter === 'All' ? 'bg-nexgen-blue text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>All</button>
          {activeCategories.map(cat => (
            <button key={cat} onClick={() => setCategoryFilter(cat)} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${categoryFilter === cat ? 'bg-nexgen-blue text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>{cat}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-stone-500">
        {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
        {categoryFilter !== 'All' && ` in ${categoryFilter}`}
        {stockFilter !== 'all' && ` (${stockFilter.replace('_', ' ')})`}
        {isOps && <span className="text-stone-500"> · click a row for batch detail</span>}
      </p>

      {/* Customer — simplified card grid (products cache) */}
      {isCustomer ? (
        filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map(product => {
              const status = classifyStock(qtyOf(product), lowStockThresholdFor(product, globalThreshold));
              return (
                <div key={product.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-900 truncate">{product.name}</p>
                    <p className="text-xs text-stone-500 mt-0.5">{product.category} &middot; {product.unit}</p>
                  </div>
                  <div className="shrink-0">
                    {status === 'in_stock' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 className="w-3 h-3" /> Available</span>}
                    {status === 'low_stock' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"><AlertCircle className="w-3 h-3" /> Limited</span>}
                    {status === 'out_of_stock' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"><AlertCircle className="w-3 h-3" /> Unavailable</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 text-center">
            <Package className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm text-stone-600">No products match your search</p>
          </div>
        )
      ) : balancesLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse bg-stone-100/60" />)}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <Package className="w-8 h-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-600">No products match your filters</p>
          <p className="text-xs text-stone-500 mt-1">Try adjusting your search or category filter</p>
        </div>
      ) : isOps ? (
        /* Ops — ledger table with expandable per-batch detail */
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Product</th>
                  <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider">On hand</th>
                  <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider">Allocated</th>
                  <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider min-w-[200px]">Available</th>
                  <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <OpsStockRow key={product.id} product={product} agg={aggOf(product)} maxQty={maxQty} canAdjust={isAdminManager} globalThreshold={globalThreshold} scope={effectiveScope} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Reps — aggregate available only (no batch/location detail) */
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Product</th>
                  <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">SKU</th>
                  <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Category</th>
                  <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider min-w-[200px]">Available</th>
                  <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product, idx) => {
                  const avail = aggOf(product).available;
                  const status = classifyStock(avail, lowStockThresholdFor(product, globalThreshold));
                  const fillPercent = Math.min((avail / maxQty) * 100, 100);
                  const barColor = status === 'out_of_stock' ? 'bg-red-400' : status === 'low_stock' ? 'bg-amber-400' : 'bg-emerald-400';
                  return (
                    <tr key={product.id} className={`transition-colors hover:bg-stone-50/50 ${idx < filteredProducts.length - 1 ? 'border-b border-stone-100' : ''}`}>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-stone-900">{product.name}</p>
                        <p className="text-xs text-stone-500 mt-0.5">{product.unit} &middot; {product.cartonSize} per carton</p>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-stone-500 font-mono">{product.sku}</td>
                      <td className="px-5 py-3.5"><span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-stone-100 text-stone-600">{product.category}</span></td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden"><div className={`h-2 rounded-full ${barColor} transition-all duration-300`} style={{ width: `${fillPercent}%` }} /></div>
                          <span className="font-mono text-sm font-semibold text-stone-900 tabular-nums w-12 text-right">{avail}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right"><StatusPill status={status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockView;
