import React, { useState, useMemo } from 'react';
import type { Product, User, Category } from '../types';
import { UserRole } from '../types';
import { Package, AlertCircle, CheckCircle2, Search, X, TrendingDown } from 'lucide-react';
import { CATEGORIES } from '../constants';

interface StockViewProps {
  products: Product[];
  currentUser: User;
}

type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';

const getStockStatus = (inventory: number) => {
  if (inventory <= 0) return 'out_of_stock' as const;
  if (inventory <= 10) return 'low_stock' as const;
  return 'in_stock' as const;
};

const getMaxInventory = (products: Product[]) => {
  return Math.max(...products.map(p => p.inventory), 1);
};

const StockView: React.FC<StockViewProps> = ({ products, currentUser }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortBy, setSortBy] = useState<'name' | 'inventory_asc' | 'inventory_desc'>('name');

  const isCustomer = currentUser.role === UserRole.CUSTOMER;

  // KPI metrics
  const metrics = useMemo(() => {
    const total = products.length;
    const inStock = products.filter(p => p.inventory > 50).length;
    const lowStock = products.filter(p => p.inventory > 0 && p.inventory <= 10).length;
    const outOfStock = products.filter(p => p.inventory <= 0).length;
    return { total, inStock, lowStock, outOfStock };
  }, [products]);

  // Active categories (only show categories that have products)
  const activeCategories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return CATEGORIES.filter(c => cats.has(c));
  }, [products]);

  // Filtered + sorted products
  const filteredProducts = useMemo(() => {
    let filtered = [...products];

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }

    // Category
    if (categoryFilter !== 'All') {
      filtered = filtered.filter(p => p.category === categoryFilter);
    }

    // Stock status
    if (stockFilter !== 'all') {
      filtered = filtered.filter(p => getStockStatus(p.inventory) === stockFilter);
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'inventory_asc') return a.inventory - b.inventory;
      if (sortBy === 'inventory_desc') return b.inventory - a.inventory;
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [products, searchQuery, categoryFilter, stockFilter, sortBy]);

  const maxInventory = useMemo(() => getMaxInventory(products), [products]);

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Stock Levels</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {isCustomer ? 'Product availability overview' : `${products.length} products across ${activeCategories.length} categories`}
          </p>
        </div>
      </div>

      {/* KPI Summary — Reps only */}
      {!isCustomer && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-nexgen-blue/10">
              <Package className="w-4 h-4 text-nexgen-blue" />
            </div>
            <div>
              <p className="text-lg font-bold text-stone-900 leading-tight">{metrics.total}</p>
              <p className="text-xs text-stone-500 font-medium">Total Products</p>
            </div>
          </div>
          <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-50">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-stone-900 leading-tight">{metrics.inStock}</p>
              <p className="text-xs text-stone-500 font-medium">In Stock</p>
            </div>
          </div>
          <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-amber-50">
              <AlertCircle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-stone-900 leading-tight">{metrics.lowStock}</p>
              <p className="text-xs text-stone-500 font-medium">Low Stock</p>
            </div>
          </div>
          <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-red-50">
              <TrendingDown className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-stone-900 leading-tight">{metrics.outOfStock}</p>
              <p className="text-xs text-stone-500 font-medium">Out of Stock</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="space-y-3">
        {/* Search + Stock Filter + Sort */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder={isCustomer ? 'Search products...' : 'Search by name, SKU, or category...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={stockFilter}
              onChange={e => setStockFilter(e.target.value as StockFilter)}
              className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="in_stock">In Stock</option>
              <option value="low_stock">Low Stock</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
            {!isCustomer && (
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 cursor-pointer"
              >
                <option value="name">Sort: Name</option>
                <option value="inventory_asc">Sort: Stock (Low first)</option>
                <option value="inventory_desc">Sort: Stock (High first)</option>
              </select>
            )}
          </div>
        </div>

        {/* Category Chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setCategoryFilter('All')}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              categoryFilter === 'All'
                ? 'bg-nexgen-blue text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All
          </button>
          {activeCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-nexgen-blue text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-stone-400">
        {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
        {categoryFilter !== 'All' && ` in ${categoryFilter}`}
        {stockFilter !== 'all' && ` (${stockFilter.replace('_', ' ')})`}
      </p>

      {/* Customer View — Simplified card grid */}
      {isCustomer ? (
        filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map(product => {
              const status = getStockStatus(product.inventory);
              return (
                <div key={product.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-900 truncate">{product.name}</p>
                    <p className="text-xs text-stone-500 mt-0.5">{product.category} &middot; {product.unit}</p>
                  </div>
                  <div className="shrink-0">
                    {status === 'in_stock' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" /> Available
                      </span>
                    )}
                    {status === 'low_stock' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        <AlertCircle className="w-3 h-3" /> Limited
                      </span>
                    )}
                    {status === 'out_of_stock' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                        <AlertCircle className="w-3 h-3" /> Unavailable
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 text-center">
            <Package className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm text-stone-600">No products match your search</p>
            <p className="text-xs text-stone-400 mt-1">Try adjusting your filters</p>
          </div>
        )
      ) : (
        /* Rep View — Detailed table with progress bars */
        filteredProducts.length > 0 ? (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Product</th>
                    <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">SKU</th>
                    <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Category</th>
                    <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider min-w-[200px]">Stock Level</th>
                    <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product, idx) => {
                    const status = getStockStatus(product.inventory);
                    const fillPercent = Math.min((product.inventory / maxInventory) * 100, 100);
                    const barColor = status === 'out_of_stock' ? 'bg-red-400' : status === 'low_stock' ? 'bg-amber-400' : 'bg-emerald-400';

                    return (
                      <tr key={product.id} className={`transition-colors hover:bg-stone-50/50 ${idx < filteredProducts.length - 1 ? 'border-b border-stone-100' : ''}`}>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-stone-900">{product.name}</p>
                          <p className="text-xs text-stone-400 mt-0.5">{product.unit} &middot; {product.cartonSize} per carton</p>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-stone-500 font-mono">{product.sku}</td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-stone-100 text-stone-600">
                            {product.category}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-2 rounded-full ${barColor} transition-all duration-300`}
                                style={{ width: `${fillPercent}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-stone-900 tabular-nums w-12 text-right">{product.inventory}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {status === 'in_stock' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                              <CheckCircle2 className="w-3 h-3" /> In Stock
                            </span>
                          )}
                          {status === 'low_stock' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                              <AlertCircle className="w-3 h-3" /> Low Stock
                            </span>
                          )}
                          {status === 'out_of_stock' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                              <AlertCircle className="w-3 h-3" /> Out of Stock
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 text-center">
            <Package className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm text-stone-600">No products match your filters</p>
            <p className="text-xs text-stone-400 mt-1">Try adjusting your search or category filter</p>
          </div>
        )
      )}
    </div>
  );
};

export default StockView;
