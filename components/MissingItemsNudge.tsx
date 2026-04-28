import React, { useState } from 'react';
import type { OrderingHint, Product } from '../types';
import { ChevronDown, ChevronUp, Plus, Lightbulb } from 'lucide-react';

interface MissingItemsNudgeProps {
  hints: OrderingHint[];
  products: Product[];
  onAddItem: (product: Product) => void;
}

const MissingItemsNudge: React.FC<MissingItemsNudgeProps> = ({ hints, products, onAddItem }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (hints.length === 0) return null;

  const productMap = new Map(products.map(p => [p.id, p] as const));

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-800">
            You usually order these too
          </span>
          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
            {hints.length} item{hints.length !== 1 ? 's' : ''}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-blue-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-blue-400" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {hints.map(hint => {
            const product = productMap.get(hint.productId);
            if (!product) return null;
            return (
              <div
                key={hint.productId}
                className="flex-shrink-0 bg-white rounded-lg border border-blue-100 p-3 w-48 shadow-sm"
              >
                <p className="text-sm font-medium text-stone-800 truncate mb-1">
                  {hint.productName}
                </p>
                <p className="text-xs text-stone-500 mb-2">{hint.message}</p>
                <button
                  onClick={() => onAddItem(product)}
                  className="w-full flex items-center justify-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg py-1.5 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add to Order
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MissingItemsNudge;
