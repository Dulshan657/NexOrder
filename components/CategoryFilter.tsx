import React from 'react';
import type { Category } from '../types';

interface CategoryFilterProps {
  categories: readonly Category[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  hasDeals?: boolean;
}

const CategoryFilter: React.FC<CategoryFilterProps> = ({ categories, selectedCategory, onSelectCategory, hasDeals }) => {
  const allCategories = ['All', ...(hasDeals ? ['Deals' as const] : []), ...categories];

  const getButtonClasses = (category: string) => {
    const baseClasses = "px-5 py-2 text-sm font-medium rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 whitespace-nowrap btn-press";
    if (category === selectedCategory) {
      if (category === 'Deals') return `${baseClasses} bg-amber-500 text-white shadow-sm`;
      return `${baseClasses} bg-stone-900 text-white shadow-sm`;
    }
    if (category === 'Deals') return `${baseClasses} bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200`;
    return `${baseClasses} bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-900 border border-stone-200`;
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wider mb-3">Filter by Category</h3>
      <div className="flex items-center space-x-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
        {allCategories.map((category) => (
          <button
            key={category}
            onClick={() => onSelectCategory(category)}
            className={getButtonClasses(category)}
          >
            {category}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CategoryFilter;