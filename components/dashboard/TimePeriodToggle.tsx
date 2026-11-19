import React from 'react';
import type { DashboardTimePeriod } from '../../types';

interface TimePeriodToggleProps {
  value: DashboardTimePeriod;
  onChange: (period: DashboardTimePeriod) => void;
}

const periods: { value: DashboardTimePeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'custom', label: 'Custom' },
];

const TimePeriodToggle: React.FC<TimePeriodToggleProps> = ({ value, onChange }) => {
  return (
    <div role="group" aria-label="Period" className="inline-flex rounded-lg bg-stone-100 border border-stone-200/80 p-0.5">
      {periods.map(period => (
        <button
          key={period.value}
          type="button"
          aria-pressed={value === period.value}
          onClick={() => onChange(period.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 cursor-pointer touch-target-y ${
            value === period.value
              ? 'bg-white text-stone-900 shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
};

export default TimePeriodToggle;
