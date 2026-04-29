import React from 'react';
import { ClipboardList, UserRound, Plus } from 'lucide-react';

interface PantryEmptyStateProps {
    variant: 'no-horeca' | 'no-items' | 'no-filter-match';
    horecaName?: string;
    onOpenAddDrawer?: () => void;
    onClearFilter?: () => void;
}

const PantryEmptyState: React.FC<PantryEmptyStateProps> = ({ variant, horecaName, onOpenAddDrawer, onClearFilter }) => {
    if (variant === 'no-horeca') {
        return (
            <div className="bg-white rounded-xl border border-dashed border-stone-200 p-12 text-center shadow-card">
                <UserRound className="w-12 h-12 text-stone-300 mx-auto mb-4" aria-hidden />
                <h3 className="font-display font-semibold text-stone-800 text-xl tracking-tight">No HoReCa selected</h3>
                <p className="text-stone-500 mt-2 max-w-md mx-auto text-sm">
                    Pick a venue from the order summary to load their pantry.
                </p>
            </div>
        );
    }

    if (variant === 'no-filter-match') {
        return (
            <div className="bg-white rounded-xl border border-stone-200/70 p-10 text-center shadow-card">
                <p className="font-display font-semibold text-stone-800 text-lg tracking-tight">No matching items in pantry</p>
                <p className="text-stone-500 mt-1.5 text-sm max-w-sm mx-auto">
                    Adjust your filter, switch the sort, or add new products from the catalogue.
                </p>
                {onClearFilter && (
                    <button
                        type="button"
                        onClick={onClearFilter}
                        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors btn-press"
                    >
                        Clear filter
                    </button>
                )}
            </div>
        );
    }

    // no-items
    return (
        <div className="bg-white rounded-xl border border-dashed border-stone-200 p-12 text-center shadow-card">
            <ClipboardList className="w-12 h-12 text-stone-300 mx-auto mb-4" aria-hidden />
            <h3 className="font-display font-semibold text-stone-800 text-xl tracking-tight">Empty pantry</h3>
            <p className="text-stone-500 mt-2 max-w-md mx-auto text-sm">
                {horecaName ? `${horecaName} hasn't pinned any go-to products yet.` : 'No pinned products yet.'}{' '}
                Add their regulars from the catalogue or open the add drawer to get started.
            </p>
            {onOpenAddDrawer && (
                <button
                    type="button"
                    onClick={onOpenAddDrawer}
                    className="mt-5 inline-flex items-center gap-2 bg-stone-900 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-stone-800 transition-colors btn-press"
                >
                    <Plus className="w-4 h-4" />
                    Add products
                </button>
            )}
        </div>
    );
};

export default PantryEmptyState;
