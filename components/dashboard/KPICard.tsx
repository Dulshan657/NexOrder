import React from 'react';
import type { LucideIcon } from 'lucide-react';
import DeltaBadge from './DeltaBadge';

interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: number;
  deltaSuffix?: string;
  subtitle?: string;
  onClick?: () => void;
}

const KPICard: React.FC<KPICardProps> = ({ icon: Icon, label, value, delta, deltaSuffix, subtitle, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-card gradient-card rounded-xl p-5 text-left w-full transition-all duration-200 hover:shadow-card-hover hover:border-nexgen-blue/20 btn-press ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10">
          <Icon className="w-5 h-5 text-nexgen-blue" />
        </div>
        {delta !== undefined && <DeltaBadge value={delta} suffix={deltaSuffix} />}
      </div>
      <p className="text-2xl md:text-3xl font-bold text-stone-900 tabular-nums tracking-tight">{value}</p>
      <p className="text-xs text-stone-500 mt-1 font-medium">{label}</p>
      {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
    </button>
  );
};

export default KPICard;
