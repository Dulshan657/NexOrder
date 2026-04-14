import React from 'react';

interface HorizontalBarChartProps {
  title: string;
  data: { label: string; value: number; formattedValue: string }[];
  barColor?: string;
  valueColor?: string;
  labelColor?: string;
  titleColor?: string;
  dark?: boolean;
}

const HorizontalBarChart: React.FC<HorizontalBarChartProps> = ({
  title,
  data,
  barColor,
  valueColor,
  labelColor,
  titleColor,
  dark = false,
}) => {
  const resolvedBarColor = barColor ?? (dark ? '#6F7EFF' : '#34d399');
  const resolvedValueColor = valueColor ?? (dark ? '#9BBDFF' : '#064e3b');
  const resolvedLabelColor = labelColor ?? (dark ? 'rgba(255,255,255,0.7)' : '#44403c');
  const resolvedTitleColor = titleColor ?? (dark ? 'white' : '#1c1917');

  const width = 500;
  const barHeight = 30;
  const padding = { top: 20, right: 80, bottom: 20, left: 120 };
  const height = data.length * barHeight + padding.top + padding.bottom;

  const maxValue = Math.max(...data.map(d => d.value), 0);
  const xScale = (value: number) => maxValue > 0 ? (value / maxValue) * (width - padding.left - padding.right) : 0;

  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center h-48 ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
        <p>No data available for &quot;{title}&quot;</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className={`font-bold text-lg mb-2 ${dark ? '' : ''}`} style={{ color: resolvedTitleColor }}>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {data.map((d, i) => (
          <g key={d.label} transform={`translate(${padding.left}, ${padding.top + i * barHeight})`}>
            <text x="-10" y={barHeight / 2} dy=".35em" textAnchor="end" fontSize="12" fill={resolvedLabelColor} className="truncate">
              {d.label}
            </text>
            <rect y="2" width={xScale(d.value)} height={barHeight - 4} fill={resolvedBarColor} rx="3" />
            <text x={xScale(d.value) + 5} y={barHeight / 2} dy=".35em" fontSize="12" fontWeight="500" fill={resolvedValueColor}>
              {d.formattedValue}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export default HorizontalBarChart;
