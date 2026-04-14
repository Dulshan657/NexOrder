import React from 'react';
import type { HoReCaSegment } from '../types';
import { Crown, TrendingUp, TrendingDown, AlertTriangle, UserPlus } from 'lucide-react';

const SEGMENT_CONFIG: Record<HoReCaSegment, { label: string; color: string; icon: React.ReactNode }> = {
  high_value: { label: 'High Value', color: 'bg-amber-50 text-amber-800 border-amber-200', icon: <Crown className="w-3 h-3" /> },
  growing: { label: 'Growing', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: <TrendingUp className="w-3 h-3" /> },
  declining: { label: 'Declining', color: 'bg-orange-50 text-orange-800 border-orange-200', icon: <TrendingDown className="w-3 h-3" /> },
  at_risk: { label: 'At Risk', color: 'bg-red-50 text-red-800 border-red-200', icon: <AlertTriangle className="w-3 h-3" /> },
  new: { label: 'New', color: 'bg-blue-50 text-blue-800 border-blue-200', icon: <UserPlus className="w-3 h-3" /> },
};

interface SegmentBadgeProps {
  segment: HoReCaSegment;
  size?: 'sm' | 'md';
}

const SegmentBadge: React.FC<SegmentBadgeProps> = ({ segment, size = 'sm' }) => {
  const config = SEGMENT_CONFIG[segment];
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';

  return (
    <span className={`inline-flex items-center gap-1 font-medium border rounded-full ${config.color} ${sizeClass}`}>
      {config.icon}
      {config.label}
    </span>
  );
};

export default SegmentBadge;
