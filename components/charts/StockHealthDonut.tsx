import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { StockHealth } from '@/services/inventoryDashboardService';

interface StockHealthDonutProps {
  data: StockHealth;
}

const SEGMENTS: { key: keyof Omit<StockHealth, 'total'>; label: string; color: string }[] = [
  { key: 'inStock', label: 'In stock', color: '#10b981' }, // emerald-500
  { key: 'lowStock', label: 'Low stock', color: '#f59e0b' }, // amber-500
  { key: 'outOfStock', label: 'Out of stock', color: '#ef4444' }, // red-500
];

function StockHealthDonut({ data }: StockHealthDonutProps) {
  if (data.total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-stone-400">
        No products to report
      </div>
    );
  }

  const chartData = SEGMENTS.map((s) => ({ name: s.label, value: data[s.key], color: s.color })).filter(
    (d) => d.value > 0,
  );

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-[220px] w-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value} SKUs`, name]}
              contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-bold text-stone-900">{data.total}</span>
          <span className="text-[10px] uppercase tracking-wider text-stone-400">SKUs</span>
        </div>
      </div>

      <ul className="w-full space-y-2 sm:w-1/2">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-stone-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="font-mono font-semibold text-stone-900">{data[s.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default StockHealthDonut;
