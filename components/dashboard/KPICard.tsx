import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import DeltaBadge from './DeltaBadge';

interface KPICardProps {
  label: string;
  value: string;
  /** Kept small and quiet beside the label; colour lives in the numbers. */
  icon?: LucideIcon;
  delta?: number;
  deltaSuffix?: string;
  /** What the delta compares against. */
  deltaCaption?: string;
  subtitle?: string;
  /** Where the tile leads. Without one the tile is not a button (NX-0041). */
  onClick?: () => void;
}

/**
 * Splits `$12,345.67` so the whole dollars carry the weight and the symbol and
 * cents sit back. Anything that is not a currency string renders as given.
 */
function KpiValue({ value }: { value: string }) {
  const money = /^(-?)(\$)([\d,]+)(\.\d+)?$/.exec(value);
  if (!money) return <>{value}</>;
  const [, sign, symbol, whole, cents] = money;
  // The styled split is for the eye; a screen reader gets the figure whole.
  return (
    <>
      <span aria-hidden="true">
        <span className="text-stone-500 font-medium mr-0.5 text-[0.7em] align-[0.12em]">{sign}{symbol}</span>
        {whole}
        {cents && <span className="text-stone-500 font-medium text-[0.7em]">{cents}</span>}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}

const KPICard: React.FC<KPICardProps> = ({
  icon: Icon, label, value, delta, deltaSuffix, deltaCaption = 'vs prev. period', subtitle, onClick,
}) => {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600 min-w-0">
          {Icon && <Icon className="w-4 h-4 text-stone-400 shrink-0" aria-hidden="true" />}
          <span className="truncate">{label}</span>
        </span>
        {onClick && (
          <ChevronRight
            className="w-4 h-4 text-stone-400 opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
            aria-hidden="true"
          />
        )}
      </div>
      <p className="mt-2 font-display text-[1.75rem] sm:text-3xl font-semibold text-stone-900 tabular-nums tracking-tight leading-none">
        <KpiValue value={value} />
      </p>
      {(delta !== undefined || subtitle) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
          {delta !== undefined && (
            <>
              <DeltaBadge value={delta} suffix={deltaSuffix} />
              <span>{deltaCaption}</span>
            </>
          )}
          {subtitle && <span className="truncate">{subtitle}</span>}
        </div>
      )}
    </>
  );

  if (!onClick) {
    return <div className="dash-card p-4 sm:p-5 min-w-0">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group dash-card dash-card-interactive p-4 sm:p-5 min-w-0 w-full text-left cursor-pointer"
    >
      {body}
    </button>
  );
};

export default KPICard;
