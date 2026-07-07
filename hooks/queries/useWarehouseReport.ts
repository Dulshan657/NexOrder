import { useQuery } from '@tanstack/react-query'
import { getWarehouseReport } from '@/services/supabase/warehouseReportService'

export const warehouseReportKeys = {
  byWarehouse: (warehouseId: number) => ['warehouse-report', warehouseId] as const,
}

export function useWarehouseReport(warehouseId: number | null) {
  return useQuery({
    queryKey: warehouseReportKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getWarehouseReport(warehouseId as number),
    enabled: warehouseId != null,
  })
}
