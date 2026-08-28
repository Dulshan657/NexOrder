import React, { useState } from 'react';
import { Keyboard, ChevronDown, ChevronUp } from 'lucide-react';

const SHORTCUTS: { keys: string[]; label: string }[] = [
    { keys: ['/'], label: 'Focus filter' },
    { keys: ['↑', '↓'], label: 'Move row focus' },
    { keys: ['Space'], label: 'Toggle selection' },
    { keys: ['Enter'], label: 'Add focused row' },
    { keys: ['+', '−'], label: 'Adjust quantity' },
    { keys: ['C'], label: 'Toggle pack' },
    { keys: ['Shift', 'A'], label: 'Add all visible' },
    { keys: ['Shift', 'S'], label: 'Add selected' },
    { keys: ['⌘', 'K'], label: 'Open add drawer' },
    { keys: ['Esc'], label: 'Close popovers' },
];

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-white border border-stone-200 text-[10px] font-mono text-stone-600 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        {children}
    </kbd>
);

const PantryKeyboardHints: React.FC = () => {
    const [open, setOpen] = useState(false);

    return (
        <div className="hidden lg:block">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-stone-700 transition-colors"
                aria-expanded={open}
            >
                <Keyboard className="w-3.5 h-3.5" aria-hidden />
                Keyboard
                {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {open && (
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-stone-500 bg-stone-50/70 border border-stone-200/70 rounded-lg px-3 py-2.5">
                    {SHORTCUTS.map(({ keys, label }) => (
                        <div key={label} className="flex items-center justify-between gap-3">
                            <span>{label}</span>
                            <span className="flex items-center gap-1">
                                {keys.map((k, i) => (
                                    <React.Fragment key={i}>
                                        {i > 0 && <span className="text-stone-300">+</span>}
                                        <Kbd>{k}</Kbd>
                                    </React.Fragment>
                                ))}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PantryKeyboardHints;
