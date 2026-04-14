import React from 'react';

interface VelocityBarProps {
  value: number;
  maxValue: number;
}

const VelocityBar: React.FC<VelocityBarProps> = ({ value, maxValue }) => {
  const percent = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const color = percent >= 60 ? 'bg-emerald-400' : percent >= 30 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="h-1.5 w-20 bg-stone-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(percent, 3)}%` }} />
    </div>
  );
};

export default VelocityBar;
