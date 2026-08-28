import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronUp } from 'lucide-react';

type AlertSeverity = 'critical' | 'warning' | 'info' | 'success';

interface AlertBannerProps {
  icon: LucideIcon;
  label: string;
  count: number;
  severity: AlertSeverity;
  subtitle?: string;
  children?: React.ReactNode;
  onViewAll?: () => void;
}

const severityStyles: Record<AlertSeverity, { bg: string; border: string; text: string; countBg: string }> = {
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    countBg: 'bg-red-500',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    countBg: 'bg-amber-500',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    countBg: 'bg-nexgen-blue',
  },
  success: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    countBg: 'bg-emerald-500',
  },
};

const AlertBanner: React.FC<AlertBannerProps> = ({ icon: Icon, label, count, severity, subtitle, children, onViewAll }) => {
  const [expanded, setExpanded] = useState(false);
  const styles = severityStyles[severity];
  const hasContent = Boolean(children);

  return (
    <div className={`rounded-xl border ${styles.bg} ${styles.border} overflow-hidden transition-all duration-200`}>
      <button
        type="button"
        onClick={() => hasContent && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-4 py-3 min-h-[44px] ${hasContent ? 'cursor-pointer hover:bg-stone-50/50' : 'cursor-default'}`}
      >
        <Icon className={`w-5 h-5 ${styles.text} shrink-0`} />
        <span className={`text-sm font-semibold ${styles.text}`}>{label}</span>
        {count > 0 && (
          <span className={`${styles.countBg} text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[22px] text-center`}>
            {count}
          </span>
        )}
        {subtitle && <span className="text-xs text-stone-500 ml-auto mr-2 hidden sm:inline">{subtitle}</span>}
        {hasContent && (
          expanded
            ? <ChevronUp className="w-4 h-4 text-stone-500 ml-auto shrink-0" />
            : <ChevronDown className="w-4 h-4 text-stone-500 ml-auto shrink-0" />
        )}
      </button>
      {expanded && children && (
        <div className="px-4 pb-4 border-t border-stone-200/50">
          <div className="pt-3">{children}</div>
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="mt-3 text-xs text-nexgen-blue hover:text-nexgen-blue-dark font-semibold cursor-pointer"
            >
              View All &rarr;
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertBanner;
