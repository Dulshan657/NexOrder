import React, { useMemo } from 'react';
import type { SalesTarget, Order } from '../../types';
import { computeTargetProjection, computeWeeklyPace } from '../../services/targetProjectionService';
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface TargetProjectionCardProps {
  target: SalesTarget;
  orders: Order[];
  userId: number;
}

const STATUS_CONFIG = {
  on_track: { label: 'On Track', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2, iconColor: 'text-emerald-500' },
  behind: { label: 'Behind', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-500' },
  at_risk: { label: 'At Risk', color: 'text-red-700 bg-red-50 border-red-200', icon: AlertTriangle, iconColor: 'text-red-500' },
};

const TargetProjectionCard: React.FC<TargetProjectionCardProps> = ({ target, orders, userId }) => {
  const projection = useMemo(() => computeTargetProjection(target, orders, userId), [target, orders, userId]);
  const weeklyPace = useMemo(() => computeWeeklyPace(target, orders, userId), [target, orders, userId]);

  const config = STATUS_CONFIG[projection.status];
  const StatusIcon = config.icon;

  // SVG chart dimensions
  const chartW = 280;
  const chartH = 60;
  const padding = 4;

  const maxVal = Math.max(target.targetValue, ...weeklyPace.map(p => Math.max(p.cumulative, p.idealPace)));

  const toX = (i: number) => padding + (i / Math.max(weeklyPace.length - 1, 1)) * (chartW - padding * 2);
  const toY = (val: number) => chartH - padding - (val / (maxVal || 1)) * (chartH - padding * 2);

  const actualPath = weeklyPace.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(p.cumulative)}`).join(' ');
  const idealPath = weeklyPace.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(p.idealPace)}`).join(' ');

  return (
    <div className="mt-2 p-3 rounded-lg bg-stone-50/50 border border-stone-100">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${config.iconColor}`} />
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${config.color}`}>
            {config.label}
          </span>
          <span className="text-xs text-stone-500">{projection.daysRemaining}d remaining</span>
        </div>
        <span className="text-sm font-bold text-stone-700">{projection.projectedPercent}%</span>
      </div>

      <p className="text-xs text-stone-600 mb-2">{projection.message}</p>

      {/* Weekly Pace Chart */}
      {weeklyPace.length >= 2 && (
        <div className="mt-2">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-16">
            {/* Ideal pace line (dashed) */}
            <path d={idealPath} fill="none" stroke="#d6d3d1" strokeWidth="1" strokeDasharray="4 2" />
            {/* Actual pace line */}
            <path d={actualPath} fill="none" stroke={projection.status === 'on_track' ? '#059669' : projection.status === 'behind' ? '#d97706' : '#dc2626'} strokeWidth="1.5" />
            {/* Target line */}
            <line x1={padding} y1={toY(target.targetValue)} x2={chartW - padding} y2={toY(target.targetValue)} stroke="#a8a29e" strokeWidth="0.5" strokeDasharray="2 2" />
          </svg>
          <div className="flex justify-between text-[9px] text-stone-500 mt-0.5 px-1">
            <span>Wk 1</span>
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-0.5 bg-stone-300" /> Ideal
              <span className="inline-block w-3 h-0.5 bg-emerald-500" /> Actual
            </span>
            <span>Wk {weeklyPace.length}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TargetProjectionCard;
