// Details / Sales, for the customer tab (NX-0027).
//
// Two toggle buttons with `aria-pressed`, the way StockModeTabs does it and for the same
// reason: a tablist promises arrow-key roving focus and a matching tabpanel, and the table
// below is not a panel of this control, it is the whole page body. The classes are
// StockModeTabs's, so the two switches read as one kind of control.

import React from 'react';

export type CustomerView = 'details' | 'sales';

const VIEWS: ReadonlyArray<{ id: CustomerView; label: string }> = [
  { id: 'details', label: 'Details' },
  { id: 'sales', label: 'Sales' },
];

const BASE =
  'touch-target-y relative -mb-px inline-flex flex-1 items-center justify-center py-2.5 ' +
  'text-sm transition-colors border-b-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark';

const ON = 'border-stone-900 text-stone-900 font-medium';
const OFF = 'border-transparent text-stone-500 hover:text-stone-800';

interface HoReCaViewToggleProps {
  view: CustomerView;
  onChange: (view: CustomerView) => void;
}

const HoReCaViewToggle: React.FC<HoReCaViewToggleProps> = ({ view, onChange }) => (
  <div role="group" aria-label="Customer view" className="flex border-b border-stone-200/70 sm:max-w-xs">
    {VIEWS.map(({ id, label }) => (
      <button
        key={id}
        type="button"
        aria-pressed={view === id}
        onClick={() => onChange(id)}
        className={`${BASE} ${view === id ? ON : OFF}`}
      >
        {label}
      </button>
    ))}
  </div>
);

export default HoReCaViewToggle;
