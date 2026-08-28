import React, { useState } from 'react';

interface SalesLineChartProps {
  data: { date: string; revenue: number }[];
  lineColor?: string;
  fillColor?: string;
  axisColor?: string;
  labelColor?: string;
  tooltipBg?: string;
  tooltipText?: string;
  dark?: boolean;
}

const SalesLineChart: React.FC<SalesLineChartProps> = ({
  data,
  lineColor = '#007BFF',
  fillColor = '#6F7EFF',
  axisColor,
  labelColor,
  tooltipBg,
  tooltipText = 'white',
  dark = false,
}) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; revenue: number } | null>(null);
  const width = 500;
  const height = 250;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };

  const resolvedAxisColor = axisColor ?? (dark ? 'rgba(255,255,255,0.15)' : '#e7e5e4');
  const resolvedLabelColor = labelColor ?? (dark ? 'rgba(255,255,255,0.5)' : '#78716c');
  const resolvedTooltipBg = tooltipBg ?? (dark ? 'rgba(255,255,255,0.12)' : '#1c1917');

  const maxRevenue = Math.max(...data.map(d => d.revenue), 0);
  const yMax = maxRevenue > 0 ? maxRevenue * 1.1 : 100;

  const getX = (index: number) => padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
  const getY = (revenue: number) => height - padding.bottom - (revenue / yMax) * (height - padding.top - padding.bottom);

  if (data.length < 2) {
    return (
      <div style={{ height: `${height}px` }} className={`flex items-center justify-center ${dark ? 'text-stone-500' : 'text-stone-500'}`}>
        Not enough data to display trend.
      </div>
    );
  }

  const gradientId = `salesGradient-${dark ? 'dark' : 'light'}`;
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.revenue)}`).join(' ');
  const areaPath = linePath + ` L ${getX(data.length - 1)} ${height - padding.bottom} L ${getX(0)} ${height - padding.bottom} Z`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity={0.4} />
            <stop offset="100%" stopColor={fillColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Y-axis */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke={resolvedAxisColor} />
        <text x={padding.left - 8} y={padding.top} textAnchor="end" fontSize="10" fill={resolvedLabelColor}>${yMax.toFixed(0)}</text>
        <text x={padding.left - 8} y={height - padding.bottom} textAnchor="end" fontSize="10" fill={resolvedLabelColor}>$0</text>

        {/* X-axis */}
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke={resolvedAxisColor} />
        <text x={padding.left} y={height - padding.bottom + 15} textAnchor="start" fontSize="10" fill={resolvedLabelColor}>
          {new Date(data[0].date).toLocaleDateString()}
        </text>
        <text x={width - padding.right} y={height - padding.bottom + 15} textAnchor="end" fontSize="10" fill={resolvedLabelColor}>
          {new Date(data[data.length - 1].date).toLocaleDateString()}
        </text>

        {/* Area and Line */}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" />

        {/* Hover targets and points */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={getX(i)} cy={getY(d.revenue)} r="3" fill={lineColor} />
            <rect
              x={getX(i) - 10} y={0} width={20} height={height} fill="transparent"
              onMouseMove={() => setTooltip({ x: getX(i), y: getY(d.revenue), date: d.date, revenue: d.revenue })}
              onMouseLeave={() => setTooltip(null)}
            />
          </g>
        ))}

        {/* Tooltip */}
        {tooltip && (
          <g transform={`translate(${tooltip.x}, ${tooltip.y})`}>
            <circle r="5" fill={lineColor} stroke="white" strokeWidth="2" />
            <g transform={`translate(${tooltip.x > width / 2 ? -140 : 20}, -10)`}>
              <rect x="0" y="-22" width="120" height="40" fill={resolvedTooltipBg} fillOpacity="0.9" rx="4" />
              <text x="10" y="0" fill={tooltipText} fontSize="11">
                <tspan x="10" dy="-0.5em">{new Date(tooltip.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</tspan>
                <tspan x="10" dy="1.2em" fontWeight="bold">${tooltip.revenue.toFixed(2)}</tspan>
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
};

export default SalesLineChart;
