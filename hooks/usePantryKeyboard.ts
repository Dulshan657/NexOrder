import { useEffect } from 'react';

interface PantryKeyboardOptions {
    enabled: boolean;
    productIds: number[];
    focusedProductId: number | null;
    setFocusedProductId: (id: number | null) => void;
    focusFilter: () => void;
    onSelectToggle: (productId: number) => void;
    onAddFocused: (productId: number) => void;
    onIncQty: (productId: number) => void;
    onDecQty: (productId: number) => void;
    onTogglePackSize: (productId: number) => void;
    onAddSelected: () => void;
    onAddAllVisible: (productIds: number[]) => void;
    onCloseAll: () => void;
}

function isTextInputTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
}

export function usePantryKeyboard(options: PantryKeyboardOptions): void {
    const {
        enabled,
        productIds,
        focusedProductId,
        setFocusedProductId,
        focusFilter,
        onSelectToggle,
        onAddFocused,
        onIncQty,
        onDecQty,
        onTogglePackSize,
        onAddSelected,
        onAddAllVisible,
        onCloseAll,
    } = options;

    useEffect(() => {
        if (!enabled) return;

        const handler = (e: KeyboardEvent) => {
            const inText = isTextInputTarget(e.target);

            // Focus the filter on '/' regardless of where focus is — except inside an input.
            if (e.key === '/' && !inText) {
                e.preventDefault();
                focusFilter();
                return;
            }

            // Esc always closes
            if (e.key === 'Escape') {
                onCloseAll();
                return;
            }

            if (inText) return;

            const idx = focusedProductId === null ? -1 : productIds.indexOf(focusedProductId);

            const moveFocus = (delta: 1 | -1) => {
                if (productIds.length === 0) return;
                const nextIdx = idx === -1
                    ? (delta === 1 ? 0 : productIds.length - 1)
                    : Math.max(0, Math.min(productIds.length - 1, idx + delta));
                const nextId = productIds[nextIdx];
                setFocusedProductId(nextId);
            };

            switch (e.key) {
                case 'ArrowDown':
                case 'j':
                    e.preventDefault();
                    moveFocus(1);
                    return;
                case 'ArrowUp':
                case 'k':
                    e.preventDefault();
                    moveFocus(-1);
                    return;
                case ' ':
                    if (focusedProductId !== null) {
                        e.preventDefault();
                        onSelectToggle(focusedProductId);
                    }
                    return;
                case 'Enter':
                    if (focusedProductId !== null) {
                        e.preventDefault();
                        onAddFocused(focusedProductId);
                    }
                    return;
                case '+':
                case '=':
                    if (focusedProductId !== null) {
                        e.preventDefault();
                        onIncQty(focusedProductId);
                    }
                    return;
                case '-':
                case '_':
                    if (focusedProductId !== null) {
                        e.preventDefault();
                        onDecQty(focusedProductId);
                    }
                    return;
                case 'c':
                case 'C':
                    if (focusedProductId !== null) {
                        e.preventDefault();
                        onTogglePackSize(focusedProductId);
                    }
                    return;
                case 'A':
                    if (e.shiftKey) {
                        e.preventDefault();
                        onAddAllVisible(productIds);
                    }
                    return;
                case 'S':
                    if (e.shiftKey) {
                        e.preventDefault();
                        onAddSelected();
                    }
                    return;
                default:
                    return;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [
        enabled,
        productIds,
        focusedProductId,
        setFocusedProductId,
        focusFilter,
        onSelectToggle,
        onAddFocused,
        onIncQty,
        onDecQty,
        onTogglePackSize,
        onAddSelected,
        onAddAllVisible,
        onCloseAll,
    ]);
}
