import React, { useId, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMoneyCompact, formatShortDate } from '../../lib/dashboardFormat';

interface SalesLineChartProps {
  data: { date: string; revenue: number }[];
  /**
   * The previous period, day for day (index i lines up with data[i]). Drawn as a
   * faint dashed line so the comparison the KPI deltas make is visible.
   */
  previous?: { date: string; revenue: number }[];
  /** Fixed drawing height. The chart fills its width but never its height. */
  height?: number;
}

// Pixel values, not a viewBox: the old SVG scaled with its width, so on a wide
// screen the chart grew ~500px tall and its 10px labels rendered near 20px.
const AXIS_TICK = { fontSize: 11, fill: '#78716c' }; // stone-500
const LINE = '#2472C2'; // nexgen-blue-dark
const GHOST = '#d6d3d1'; // stone-300
const GRID = '#f5f5f4'; // stone-100

interface Point {
  date: string;
  revenue: number;
  previous?: number;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-sm text-xs">
      <p className="font-medium text-stone-600">{formatShortDate(point.date)}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-stone-900">{formatMoney(point.revenue)}</p>
      {point.previous !== undefined && (
        <p className="tabular-nums text-stone-500">prev. {formatMoney(point.previous)}</p>
      )}
    </div>
  );
}

const SalesLineChart: React.FC<SalesLineChartProps> = ({ data, previous, height = 220 }) => {
  const gradientId = `trend-fill-${useId().replace(/:/g, '')}`;

  const points = useMemo<Point[]>(
    () => data.map((d, i) => ({ ...d, previous: previous?.[i]?.revenue })),
    [data, previous],
  );

  if (data.length < 2) {
    return (
      <div
        data-chart="sales-trend"
        style={{ height: `${height}px` }}
        className="flex items-center justify-center text-sm text-stone-500"
      >
        Pick a longer period to see a trend
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.revenue, 0);

  return (
    <div data-chart="sales-trend" style={{ height: `${height}px` }} className="w-full">
      <p className="sr-only">
        Revenue by day, {formatShortDate(data[0].date)} to {formatShortDate(data[data.length - 1].date)}: {formatMoney(total)} in total.
      </p>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity={0.14} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={formatMoneyCompact}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#d6d3d1', strokeWidth: 1 }} />
          {previous && (
            <Line
              type="monotone"
              dataKey="previous"
              stroke={GHOST}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={LINE}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0, fill: LINE }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SalesLineChart;
