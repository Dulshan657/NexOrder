import React, { useEffect, useRef } from 'react';
import type { Product, HoReCa } from '../../types';
import { resolveHoReCaPrice } from '../../pricing';
import { ArrowRightLeft, AlertTriangle, ImageOff, X } from 'lucide-react';
import OptimizedImage from '../OptimizedImage';

interface PantrySubstitutePopoverProps {
    target: Product;
    suggestions: Product[];
    selectedHoReCa: HoReCa | null;
    onClose: () => void;
    onReplace: (substitute: Product, addToPantry: boolean) => void;
}

const PantrySubstitutePopover: React.FC<PantrySubstitutePopoverProps> = ({
    target,
    suggestions,
    selectedHoReCa,
    onClose,
    onReplace,
}) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onClick);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onClick);
        };
    }, [onClose]);

    return (
        <div
            ref={ref}
            role="dialog"
            aria-modal="false"
            aria-label={`Substitutes for ${target.name}`}
            className="absolute right-0 top-full mt-2 z-30 w-80 max-w-[calc(100vw-2rem)] bg-white border border-stone-200 rounded-xl shadow-card-hover overflow-hidden"
        >
            <header className="px-3 py-2.5 border-b border-stone-100 flex items-start justify-between gap-2">
                <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-amber-700">
                        Out of stock substitute
                    </p>
                    <p className="text-sm font-medium text-stone-900 truncate">{target.name}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1 -mt-1 -mr-1 rounded text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                    aria-label="Close"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </header>

            {suggestions.length === 0 ? (
                <div className="px-4 py-6 text-center">
                    <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-2" aria-hidden />
                    <p className="text-sm text-stone-700 font-medium">No in-stock alternatives</p>
                    <p className="text-[12px] text-stone-500 mt-1">
                        Nothing in <span className="font-medium">{target.category}</span> is available right now.
                        Consider keeping this item on backorder or removing it temporarily.
                    </p>
                </div>
            ) : (
                <ul className="py-1.5">
                    {suggestions.map(s => {
                        const price = resolveHoReCaPrice(s, selectedHoReCa);
                        return (
                            <li key={s.id}>
                                <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-50">
                                    <div className="w-9 h-9 rounded-md overflow-hidden bg-stone-100 ring-1 ring-stone-200/70 flex-shrink-0">
                                        <OptimizedImage
                                            src={s.imageUrl}
                                            alt=""
                                            className="w-full h-full"
                                            transformWidth={96}
                                            fallback={
                                                <div className="w-full h-full flex items-center justify-center text-stone-300">
                                                    <ImageOff className="w-3 h-3" aria-hidden />
                                                </div>
                                            }
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-stone-900 truncate">{s.name}</p>
                                        <p className="text-[11px] text-stone-500">
                                            <span className="font-mono tabular-nums">${price.toFixed(2)}</span>
                                            <span className="text-stone-300"> / </span>
                                            <span>{s.unit}</span>
                                            <span className="text-stone-300"> · </span>
                                            <span className="font-mono tabular-nums">{s.inventory} in stock</span>
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onReplace(s, false)}
                                        className="inline-flex items-center gap-1 text-[11px] font-medium text-nexgen-blue hover:text-nexgen-blue-dark transition-colors"
                                        title="Add this substitute to the order"
                                    >
                                        <ArrowRightLeft className="w-3 h-3" />
                                        Replace
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {suggestions.length > 0 && (
                <footer className="px-3 py-2 border-t border-stone-100 bg-stone-50/60 text-[10.5px] text-stone-500">
                    Tip: hold <kbd className="px-1 py-0.5 mx-0.5 rounded bg-white border border-stone-200 font-mono text-[9px]">Shift</kbd>
                    + Replace to also pin the substitute as a future favorite.
                </footer>
            )}
        </div>
    );
};

export default PantrySubstitutePopover;
