import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface DeltaBadgeProps {
  value: number;
  suffix?: string;
}

/** A soft pill: arrow + change. Colour only says direction; the sign says it too. */
const DeltaBadge: React.FC<DeltaBadgeProps> = ({ value, suffix = '%' }) => {
  const isPositive = value > 0;
  const isNeutral = value === 0 || !Number.isFinite(value);

  const colorClass = isNeutral
    ? 'bg-stone-100 text-stone-600'
    : isPositive
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-700';

  const Icon = isNeutral ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;
  const shown = isNeutral ? 0 : value;

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-semibold tabular-nums ${colorClass}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {isPositive ? '+' : ''}{shown.toFixed(1)}{suffix}
    </span>
  );
};

export default DeltaBadge;
