import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DispatchFunnelStage } from '@/services/inventoryDashboardService';
import type { OrderStatus } from '@/types';

interface DispatchFunnelChartProps {
  data: DispatchFunnelStage[];
  /** Orders placed in the window and since cancelled: a line under the chart, never a stage. */
  cancelled?: number;
  /** NX-0042: each stage opens the orders it counts. Omitted -> plain rows. */
  onOpenStage?: (status: OrderStatus) => void;
}

// Light to deep blue as orders move toward delivery. Indexes line up with the
// service's stage order.
const STAGE_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'];

/**
 * The chart's numbers as text, for screen readers and for the end-to-end spec
 * that checks each stage against the database (tests/e2e/order-numbers.spec.ts).
 */
function StageList({ data }: { data: DispatchFunnelStage[] }) {
  return (
    <ul className="sr-only" aria-label="Order pipeline counts">
      {data.map((stage) => (
        <li key={stage.status} data-status={stage.status}>
          {stage.label}: {stage.count}
        </li>
      ))}
    </ul>
  );
}

function CancelledLine({ count }: { count: number }) {
  if (count <= 0) return null;
  return <p className="mt-3 text-xs text-stone-600">{count} cancelled in this period</p>;
}

function StageRow({ stage, color, max, onOpen }: {
  stage: DispatchFunnelStage;
  color: string;
  max: number;
  onOpen?: () => void;
}) {
  const width = max > 0 ? Math.max((stage.count / max) * 100, stage.count > 0 ? 2 : 0) : 0;
  const body = (
    <>
      <span className="w-20 shrink-0 text-[13px] text-stone-600">{stage.label}</span>
      <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </span>
      <span className="w-8 shrink-0 text-right text-[13px] font-semibold tabular-nums text-stone-900">{stage.count}</span>
    </>
  );

  if (!onOpen) {
    return <div className="flex items-center gap-3 px-2 py-1.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${stage.label}: ${stage.count} ${stage.count === 1 ? 'order' : 'orders'}, open the list`}
      className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-stone-50 transition-colors duration-150 cursor-pointer touch-target-y"
    >
      {body}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-stone-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}

function DispatchFunnelChart({ data, cancelled = 0, onOpenStage }: DispatchFunnelChartProps) {
  const total = data.reduce((sum, s) => sum + s.count, 0);
  const max = data.reduce((m, s) => Math.max(m, s.count), 0);

  if (total === 0) {
    return (
      <div>
        <div className="flex h-[180px] items-center justify-center text-sm text-stone-600">
          No orders in this period
        </div>
        <StageList data={data} />
        <CancelledLine count={cancelled} />
      </div>
    );
  }

  return (
    <div>
      <div className="-mx-2 space-y-0.5">
        {data.map((stage, i) => (
          <Fragment key={stage.status}>
            <StageRow
              stage={stage}
              color={STAGE_COLORS[i] ?? '#3b82f6'}
              max={max}
              onOpen={onOpenStage ? () => onOpenStage(stage.status as OrderStatus) : undefined}
            />
          </Fragment>
        ))}
      </div>
      <StageList data={data} />
      <CancelledLine count={cancelled} />
    </div>
  );
}

export default DispatchFunnelChart;
