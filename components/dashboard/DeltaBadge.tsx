import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DeltaBadgeProps {
  value: number;
  suffix?: string;
}

const DeltaBadge: React.FC<DeltaBadgeProps> = ({ value, suffix = '%' }) => {
  const isPositive = value > 0;
  const isNeutral = value === 0;

  const colorClass = isNeutral
    ? 'bg-stone-100 text-stone-500'
    : isPositive
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-700';

  const Icon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${colorClass}`}>
      <Icon className="w-3 h-3" />
      {isPositive ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
};

export default DeltaBadge;
