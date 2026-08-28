import React, { forwardRef } from 'react';
import { Search, ShoppingCart, Plus, ArrowUpDown, AlertTriangle, Sparkles } from 'lucide-react';

export type PantrySortKey = 'frequency' | 'recency' | 'alphabetical' | 'priceDesc';

const SORT_LABELS: Record<PantrySortKey, string> = {
    frequency: 'Frequency',
    recency: 'Recently ordered',
    alphabetical: 'A → Z',
    priceDesc: 'Price (high → low)',
};

interface SummaryChip {
    label: string;
    value: string;
    tone: 'neutral' | 'success' | 'warning' | 'danger';
    active?: boolean;
    onClick?: () => void;
}

interface PantryToolbarProps {
    horecaName: string;
    itemCount: number;
    filterQuery: string;
    onFilterChange: (q: string) => void;
    sort: PantrySortKey;
    onSortChange: (sort: PantrySortKey) => void;
    chips: SummaryChip[];
    selectedCount: number;
    inStockCount: number;
    onAddSelected: () => void;
    onAddAll: () => void;
    onOpenAddDrawer: () => void;
}

const toneClasses: Record<SummaryChip['tone'], string> = {
    neutral: 'bg-stone-100 text-stone-700 border-stone-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
};

const PantryToolbar = forwardRef<HTMLInputElement, PantryToolbarProps>(({
    horecaName,
    itemCount,
    filterQuery,
    onFilterChange,
    sort,
    onSortChange,
    chips,
    selectedCount,
    inStockCount,
    onAddSelected,
    onAddAll,
    onOpenAddDrawer,
}, filterRef) => {
    const showAddSelected = selectedCount > 0;
    const showAddAll = !showAddSelected && inStockCount > 0;

    return (
        <div className="bg-white rounded-xl border border-stone-200/70 shadow-card overflow-hidden">
            {/* Title row */}
            <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-end gap-3 justify-between">
                <div>
                    <h2 className="font-display font-semibold text-stone-900 tracking-tight text-lg">
                        {horecaName}
                        <span className="ml-2 text-stone-500 font-normal text-sm">/ Pantry</span>
                    </h2>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mt-0.5">
                        {itemCount} {itemCount === 1 ? 'item' : 'items'} curated for this venue
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={onOpenAddDrawer}
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors btn-press"
                        title="Add products to this pantry (⌘K)"
                    >
                        <Plus className="w-4 h-4" />
                        Add
                        <kbd className="hidden lg:inline-flex ml-1 px-1.5 py-0.5 rounded bg-white border border-stone-200 text-[10px] font-mono text-stone-500">⌘K</kbd>
                    </button>
                    {showAddSelected && (
                        <button
                            type="button"
                            onClick={onAddSelected}
                            className="inline-flex items-center gap-1.5 bg-nexgen-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors btn-press"
                        >
                            <ShoppingCart className="w-4 h-4" />
                            Add selected ({selectedCount})
                        </button>
                    )}
                    {showAddAll && (
                        <button
                            type="button"
                            onClick={onAddAll}
                            className="inline-flex items-center gap-1.5 bg-nexgen-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors btn-press"
                        >
                            <ShoppingCart className="w-4 h-4" />
                            Add all ({inStockCount})
                        </button>
                    )}
                </div>
            </div>

            {/* Filter + sort row */}
            <div className="px-4 sm:px-5 pb-3 flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" aria-hidden />
                    <input
                        ref={filterRef}
                        type="text"
                        value={filterQuery}
                        onChange={e => onFilterChange(e.target.value)}
                        placeholder="Filter pantry…  (press / )"
                        className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue/60 transition-shadow"
                        aria-label="Filter pantry items"
                    />
                </div>
                <div className="relative">
                    <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" aria-hidden />
                    <select
                        value={sort}
                        onChange={e => onSortChange(e.target.value as PantrySortKey)}
                        className="appearance-none pl-9 pr-8 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 cursor-pointer"
                        aria-label="Sort pantry by"
                    >
                        {(Object.keys(SORT_LABELS) as PantrySortKey[]).map(key => (
                            <option key={key} value={key}>Sort: {SORT_LABELS[key]}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Summary chip row */}
            {chips.length > 0 && (
                <div className="px-4 sm:px-5 pb-4 pt-1 flex flex-wrap gap-1.5 border-t border-stone-100">
                    {chips.map((chip, i) => {
                        const cls = toneClasses[chip.tone];
                        const Icon = chip.tone === 'danger' ? AlertTriangle : chip.tone === 'success' ? Sparkles : null;
                        const Body = (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${cls} ${chip.active ? 'ring-2 ring-offset-1 ring-stone-300' : ''}`}>
                                {Icon && <Icon className="w-3 h-3" aria-hidden />}
                                <span className="text-stone-500 font-normal">{chip.label}</span>
                                <span className="font-mono tabular-nums">{chip.value}</span>
                            </span>
                        );
                        if (chip.onClick) {
                            return (
                                <button key={i} type="button" onClick={chip.onClick} className="focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 rounded-full">
                                    {Body}
                                </button>
                            );
                        }
                        return <React.Fragment key={i}>{Body}</React.Fragment>;
                    })}
                </div>
            )}
        </div>
    );
});

PantryToolbar.displayName = 'PantryToolbar';
export default PantryToolbar;
