import React from 'react';
import { ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react';

interface PantryGroupProps {
    category: string;
    itemCount: number;
    estTotal: number;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    onAddAll?: () => void;
    canAddAll: boolean;
    children: React.ReactNode;
}

const PantryGroup: React.FC<PantryGroupProps> = ({
    category,
    itemCount,
    estTotal,
    isCollapsed,
    onToggleCollapse,
    onAddAll,
    canAddAll,
    children,
}) => {
    return (
        <section className="border-b border-stone-100 last:border-b-0">
            <header className="sticky top-0 z-10 bg-stone-50/85 backdrop-blur-sm border-y border-stone-200/70 flex items-center gap-2 px-3 sm:px-4 py-2">
                <button
                    type="button"
                    onClick={onToggleCollapse}
                    className="p-1 -ml-1 rounded hover:bg-stone-200/50 text-stone-500"
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `Expand ${category}` : `Collapse ${category}`}
                >
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <h3 className="font-display font-semibold text-[11px] uppercase tracking-[0.18em] text-stone-700">
                    {category}
                </h3>
                <span className="text-[11px] text-stone-500 font-mono tabular-nums">
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </span>
                <span className="text-stone-300">·</span>
                <span className="text-[11px] text-stone-500 font-mono tabular-nums">
                    est ${estTotal.toFixed(2)}
                </span>
                {onAddAll && canAddAll && (
                    <button
                        type="button"
                        onClick={onAddAll}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-nexgen-blue transition-colors"
                        title={`Add all ${category} items to order`}
                    >
                        <ShoppingCart className="w-3 h-3" />
                        Add group
                    </button>
                )}
            </header>
            {!isCollapsed && (
                <div role="list" aria-label={`${category} pantry items`} className="divide-y divide-stone-100">
                    {children}
                </div>
            )}
        </section>
    );
};

export default PantryGroup;
