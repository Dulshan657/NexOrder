import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Product } from '../types';
import { Search, Clock, X } from 'lucide-react';

interface SearchAutocompleteProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  products: Product[];
  recentItems: Product[];
  hoReCaName: string;
}

const SearchAutocomplete: React.FC<SearchAutocompleteProps> = ({
  searchQuery,
  onSearchChange,
  products,
  recentItems,
  hoReCaName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const lower = searchQuery.toLowerCase();
    return products
      .filter(p => p.name.toLowerCase().includes(lower))
      .slice(0, 6);
  }, [searchQuery, products]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showDropdown = isOpen && (suggestions.length > 0 || (recentItems.length > 0 && !searchQuery.trim()));

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setIsOpen(false); inputRef.current?.blur(); }
          }}
          placeholder="Search products..."
          className="w-full pl-9 pr-8 py-2.5 text-sm rounded-lg bg-stone-50 border-0 ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400 transition-all hover:ring-stone-300"
        />
        {searchQuery && (
          <button
            onClick={() => { onSearchChange(''); inputRef.current?.focus(); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-elevated z-50 overflow-hidden">
          {suggestions.length > 0 && (
            <div className="py-1">
              {suggestions.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSearchChange(p.name);
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors flex items-center gap-3"
                >
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-stone-400">{p.category} · ${p.price.toFixed(2)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {recentItems.length > 0 && !searchQuery.trim() && (
            <>
              <div className="px-3 py-2 border-t border-stone-100">
                <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                  Recently ordered by {hoReCaName}
                </p>
              </div>
              <div className="py-1">
                {recentItems.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSearchChange(p.name);
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors flex items-center gap-3"
                  >
                    <Clock className="w-4 h-4 text-stone-300 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block text-xs text-stone-400">{p.category}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchAutocomplete;
