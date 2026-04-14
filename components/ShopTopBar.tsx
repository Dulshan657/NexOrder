import React from 'react';
import type { HoReCa, User, Product } from '../types';
import { UserRole } from '../types';
import { ShoppingCart } from 'lucide-react';
import HoReCaSearchDropdown from './HoReCaSearchDropdown';
import SearchAutocomplete from './SearchAutocomplete';

export type SortOption = '' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc' | 'newest' | 'popularity';

interface ShopTopBarProps {
  currentUser: User;
  hoReCas: HoReCa[];
  selectedHoReCaId: number | null;
  onSelectHoReCa: (hoReCaId: number) => void;
  hoReCaError?: string;
  cartItemCount: number;
  cartTotal: number;
  isCartOpen: boolean;
  onToggleCart: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortOption: SortOption;
  onSortChange: (option: SortOption) => void;
  products: Product[];
  recentItems: Product[];
  selectedHoReCaName: string;
}

const ShopTopBar: React.FC<ShopTopBarProps> = ({
  currentUser,
  hoReCas,
  selectedHoReCaId,
  onSelectHoReCa,
  hoReCaError,
  cartItemCount,
  cartTotal,
  isCartOpen,
  onToggleCart,
  searchQuery,
  onSearchChange,
  sortOption,
  onSortChange,
  products,
  recentItems,
  selectedHoReCaName,
}) => {
  const isRep = currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP;
  const showHoReCaSelector = isRep || currentUser.role === UserRole.CUSTOMER;

  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-stone-200/60 shadow-card -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3">
      <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">
        {/* HoReCa selector */}
        {showHoReCaSelector && (
          <HoReCaSearchDropdown
            hoReCas={hoReCas}
            selectedHoReCaId={selectedHoReCaId}
            onSelectHoReCa={onSelectHoReCa}
            currentUser={currentUser}
            error={hoReCaError}
          />
        )}

        {/* Search with autocomplete */}
        <SearchAutocomplete
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          products={products}
          recentItems={recentItems}
          hoReCaName={selectedHoReCaName}
        />

        {/* Sort dropdown */}
        <select
          value={sortOption}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="rounded-lg border-0 bg-stone-50 py-2.5 px-3 pr-8 text-stone-700 ring-1 ring-inset ring-stone-200 text-sm focus:ring-2 focus:ring-nexgen-blue hover:ring-stone-300 transition-all cursor-pointer min-w-[140px]"
        >
          <option value="">Sort by...</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="name-asc">A - Z</option>
          <option value="name-desc">Z - A</option>
          <option value="newest">Newest</option>
          <option value="popularity">Popularity</option>
        </select>

        {/* Cart trigger button — desktop only */}
        <button
          onClick={onToggleCart}
          className={`hidden lg:flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium btn-press text-sm whitespace-nowrap transition-colors ${
            isCartOpen
              ? 'bg-stone-900 text-white hover:bg-stone-800'
              : 'bg-nexgen-blue text-white hover:bg-nexgen-blue-dark'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>{cartItemCount} items</span>
          <span className="opacity-60">|</span>
          <span className="tabular-nums">${cartTotal.toFixed(2)}</span>
        </button>
      </div>
    </div>
  );
};

export default ShopTopBar;
