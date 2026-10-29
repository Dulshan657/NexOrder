import { BarChart, Bar, XAxis, YAxis, Cell, LabelList, ResponsiveContainer, Tooltip } from 'recharts';
import type { DispatchFunnelStage } from '@/services/inventoryDashboardService';

interface DispatchFunnelChartProps {
  data: DispatchFunnelStage[];
  /** Orders placed in the window and since cancelled: a line under the chart, never a stage. */
  cancelled?: number;
}

// Pipeline shading: cool blue early-stage → deeper blue as orders progress toward
// dispatch/delivery. Indexes line up with the FUNNEL_STAGES order from the service.
const STAGE_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'];

function CancelledLine({ count }: { count: number }) {
  if (count <= 0) return null;
  return <p className="mt-2 text-xs text-stone-600">{count} cancelled in this period</p>;
}

function DispatchFunnelChart({ data, cancelled = 0 }: DispatchFunnelChartProps) {
  const total = data.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div>
        <div className="flex h-[240px] items-center justify-center text-sm text-stone-600">
          No orders in this period
        </div>
        <CancelledLine count={cancelled} />
      </div>
    );
  }

  return (
    <div>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
            barCategoryGap="22%"
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={84}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#57534e' }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              formatter={(value: number) => [`${value} orders`, 'Orders']}
              contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12 }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((stage, i) => (
                <Cell key={stage.status} fill={STAGE_COLORS[i] ?? '#3b82f6'} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fontSize: 12, fontWeight: 600, fill: '#44403c' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <CancelledLine count={cancelled} />
    </div>
  );
}

export default DispatchFunnelChart;
