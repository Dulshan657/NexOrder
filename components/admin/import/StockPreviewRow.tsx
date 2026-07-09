// One editable row of the opening-stock-import preview grid. Memoized for the
// same reason as ProductPreviewRow — see that file's header comment.
import React, { useMemo } from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { TextInput, NumberInput } from '@/components/admin/settings/primitives';
import { validateStockRow, type StockImportContext } from '@/lib/stockImportRow';
import { stripRowId } from '@/components/admin/import/csvImportShared';

export interface StockRowProductInfo {
  name: string;
  cartonSize: number;
  currentOnHand: number;
}

interface StockPreviewRowProps {
  index: number;
  record: Record<string, string>;
  ctx: StockImportContext;
  /** Stable (memoized in the parent on `products`) SKU → display-info lookup,
   * so this row only recomputes its own product match when its own SKU cell
   * changes, not on every keystroke elsewhere in the grid. */
  resolveProduct: (sku: string) => StockRowProductInfo | undefined;
  onChange: (index: number, patch: Record<string, string>) => void;
  serverError?: string;
}

const cellClass = 'px-2 py-1.5 align-top';
const dateInputClass =
  'w-full px-2.5 py-1.5 rounded-md border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 focus:border-nexgen-blue border-stone-300';

function StockPreviewRowImpl({ index, record, ctx, resolveProduct, onChange, serverError }: StockPreviewRowProps) {
  const result = useMemo(() => validateStockRow(stripRowId(record), ctx), [record, ctx]);
  const productInfo = useMemo(() => resolveProduct(record.sku ?? ''), [resolveProduct, record.sku]);
  const ok = result.ok === true && !serverError;
  const errorMessage = serverError ?? (result.ok === false ? result.error : undefined);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(index, { [field]: e.target.value });

  return (
    <tr className={ok ? undefined : 'bg-red-50/40'}>
      <td className={`${cellClass} text-center w-8`}>
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 inline" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500 inline" />
        )}
      </td>
      <td className={`${cellClass} min-w-[120px] font-mono text-sm text-stone-700`}>{record.sku || '—'}</td>
      <td className={`${cellClass} min-w-[160px] text-sm text-stone-700`}>{productInfo?.name ?? '—'}</td>
      <td className={`${cellClass} min-w-[110px]`}>
        <NumberInput dense value={record.quantity ?? ''} onChange={set('quantity')} invalid={result.ok === false} />
      </td>
      <td className={`${cellClass} min-w-[110px] text-sm`}>
        {productInfo ? (
          <span className={productInfo.currentOnHand > 0 ? 'inline-flex items-center gap-1 text-amber-600 font-medium' : 'text-stone-500'}>
            {productInfo.currentOnHand > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
            {productInfo.currentOnHand}
          </span>
        ) : '—'}
      </td>
      <td className={`${cellClass} min-w-[80px] text-sm text-stone-500`}>{productInfo?.cartonSize ?? '—'}</td>
      <td className={`${cellClass} min-w-[130px]`}>
        <TextInput dense value={record.lot_code ?? ''} onChange={set('lot_code')} placeholder="optional" />
      </td>
      <td className={`${cellClass} min-w-[150px]`}>
        <input
          type="date"
          className={dateInputClass}
          value={record.expiry_date ?? ''}
          onChange={set('expiry_date')}
        />
      </td>
      <td className={`${cellClass} min-w-[130px]`}>
        <TextInput dense value={record.barcode ?? ''} onChange={set('barcode')} placeholder="optional" />
      </td>
      <td className={`${cellClass} min-w-[200px] text-xs text-red-600`}>{errorMessage}</td>
    </tr>
  );
}

export const StockPreviewRow = React.memo(StockPreviewRowImpl);
