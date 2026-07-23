// A dropdown that can also accept a value it doesn't know about.
//
// Used for the product form's unit-of-measure and category fields: the options
// are a curated list merged with what's already in the catalog, so 99% of the
// time the operator picks. Choosing "Other…" swaps in a text input so an unusual
// value (a new category, a 'drum') is never blocked.
//
// Types gotcha: this repo has no @types/react and `strict` is off, so an
// `interface … extends React.SelectHTMLAttributes<…>` would contribute no
// members. Props are declared explicitly instead.
import React, { useEffect, useState } from 'react';
import { List } from 'lucide-react';

const CUSTOM = '__custom__';

export interface CreatableSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: readonly string[];
    id?: string;
    name?: string;
    required?: boolean;
    disabled?: boolean;
    /** Placeholder shown in the free-text input. */
    placeholder?: string;
    /** Label of the leading blank option when nothing is selected yet. */
    emptyLabel?: string;
    /** Label of the escape-hatch option. */
    customLabel?: string;
    /** Applied to both the select and the text input, so callers keep their own styling. */
    className?: string;
    ariaLabel?: string;
}

const CreatableSelect: React.FC<CreatableSelectProps> = ({
    value,
    onChange,
    options,
    id,
    name,
    required,
    disabled,
    placeholder,
    emptyLabel = 'Select…',
    customLabel = 'Other…',
    className = '',
    ariaLabel,
}) => {
    const inList = options.some(o => o === value);
    const [custom, setCustom] = useState(!!value && !inList);

    // A value set from outside (opening a product whose unit is off-list, or an
    // in-progress custom entry) must keep the text input showing.
    useEffect(() => {
        if (value && !inList) setCustom(true);
    }, [value, inList]);

    const handleSelect = (next: string) => {
        if (next === CUSTOM) {
            setCustom(true);
            onChange('');
            return;
        }
        onChange(next);
    };

    if (custom) {
        return (
            <div className="flex items-center gap-1.5">
                <input
                    type="text"
                    id={id}
                    name={name}
                    value={value}
                    required={required}
                    disabled={disabled}
                    placeholder={placeholder}
                    aria-label={ariaLabel}
                    onChange={e => onChange(e.target.value)}
                    className={className}
                    autoFocus
                />
                <button
                    type="button"
                    onClick={() => { setCustom(false); onChange(options[0] ?? ''); }}
                    title="Choose from the list instead"
                    aria-label="Choose from the list instead"
                    className="shrink-0 text-stone-400 hover:text-stone-700 transition-colors p-1"
                >
                    <List className="h-4 w-4" />
                </button>
            </div>
        );
    }

    return (
        <select
            id={id}
            name={name}
            value={value}
            required={required}
            disabled={disabled}
            aria-label={ariaLabel}
            onChange={e => handleSelect(e.target.value)}
            className={className}
        >
            {!value && <option value="" disabled>{emptyLabel}</option>}
            {options.map(option => <option key={option} value={option}>{option}</option>)}
            <option value={CUSTOM}>{customLabel}</option>
        </select>
    );
};

export default CreatableSelect;
