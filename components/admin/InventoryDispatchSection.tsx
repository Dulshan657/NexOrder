import { useMemo, useState } from 'react';
import type { Order, Product } from '@/types';
import {
  computeStockHealth,
  computeDispatchFunnel,
  type DispatchWindow,
} from '@/services/inventoryDashboardService';
import { useWarehouseScope } from '@/context/WarehouseScopeContext';
import { useProductStockByWarehouse } from '@/hooks/queries/useInventoryBalances';
import StockHealthDonut from '@/components/charts/StockHealthDonut';
import DispatchFunnelChart from '@/components/charts/DispatchFunnelChart';
import DashCard from '@/components/dashboard/DashCard';
import SegmentedToggle from '@/components/dashboard/SegmentedToggle';
import { WarehousePicker } from '@/components/inventory/WarehousePicker';
import { orderImportTabForStatus, type OrderImportTab } from '@/lib/orderImportHandoff';

interface InventoryDispatchSectionProps {
  allOrders: Order[];
  products: Product[];
  lowStockThreshold?: number;
  /** Stock Health's "View stock". Omitted when the user cannot open Stock. */
  onOpenStock?: () => void;
  /** A pipeline stage opens Order Import on the tab holding its orders (NX-0042). */
  onOpenOrders?: (tab: OrderImportTab) => void;
}

// 'month' first and by default: it is the calendar month Nex means by "this month".
const WINDOWS: ReadonlyArray<{ value: DispatchWindow; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

function InventoryDispatchSection({
  allOrders,
  products,
  lowStockThreshold = 10,
  onOpenStock,
  onOpenOrders,
}: InventoryDispatchSectionProps) {
  const [window, setWindow] = useState<DispatchWindow>('month');

  // The card's picker writes the app-wide warehouse scope, the same one Stock,
  // Products and Warehouse read — so the site chosen here is the site those
  // screens open on. The Warehouse role sees its own site, locked.
  const { scope } = useWarehouseScope();
  const { data: stockByWarehouse } = useProductStockByWarehouse(scope === 'all' ? null : scope);

  const onHandBySite = useMemo(() => {
    const map = new Map<number, number>();
    (stockByWarehouse ?? []).forEach((row) => map.set(row.productId, row.onHand));
    return map;
  }, [stockByWarehouse]);

  // Absent from `onHandBySite` -> 0 is correct HERE: a product not stocked at
  // the scoped site genuinely has 0 on hand for health-bucketing purposes.
  // Pass nothing under 'all' so global behaviour stays as it was
  // (computeStockHealth's own default, `p => p.inventory`).
  const onHandOf = useMemo(
    () => (scope === 'all' ? undefined : (product: Product) => onHandBySite.get(product.id) ?? 0),
    [scope, onHandBySite],
  );

  const stockHealth = useMemo(
    () => computeStockHealth(products, lowStockThreshold, onHandOf),
    [products, lowStockThreshold, onHandOf],
  );

  const pipeline = useMemo(
    () => computeDispatchFunnel(allOrders, window, new Date()),
    [allOrders, window],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DashCard
        title="Stock Health"
        caption="Right now"
        headerExtra={<WarehousePicker className="text-xs py-1" />}
        action={onOpenStock ? { label: 'View stock', onClick: onOpenStock } : undefined}
      >
        <StockHealthDonut data={stockHealth} />
      </DashCard>

      <DashCard
        title="Order pipeline"
        caption="Where this period's orders are now"
        headerExtra={
          <SegmentedToggle
            label="Pipeline period"
            options={WINDOWS}
            value={window}
            onChange={setWindow}
          />
        }
      >
        <DispatchFunnelChart
          data={pipeline.stages}
          cancelled={pipeline.cancelled}
          onOpenStage={onOpenOrders ? (status) => onOpenOrders(orderImportTabForStatus(status)) : undefined}
        />
      </DashCard>
    </div>
  );
}

export default InventoryDispatchSection;
