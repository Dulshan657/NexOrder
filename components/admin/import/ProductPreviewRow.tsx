// One editable row of the catalog-import preview grid. Memoized so editing
// one field in one row (of up to MAX_IMPORT_ROWS) doesn't re-render the rest
// of the grid — see ProductImportModal's `updateRecord` for the immutable
// update that keeps sibling rows' object identity stable across edits.
import React, { useMemo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { TextInput, NumberInput } from '@/components/admin/settings/primitives';
import { validateCatalogRow, type CatalogImportContext } from '@/lib/productImportRow';
import { stripRowId } from '@/components/admin/import/csvImportShared';

export interface ProductServerError {
  error: string;
  code?: string;
}

/**
 * Id of the ONE `<datalist>` of known categories, rendered once by the modal
 * and pointed at by every row.
 *
 * Deliberately not a per-row `<select>`: the replenishment min/max grid proved
 * that 158 rows each rendering a few hundred `<option>`s froze Chrome hard
 * enough that the tab could not even be scripted, and the fix there was a
 * single shared `<datalist>`. This grid goes to MAX_IMPORT_ROWS (2000).
 *
 * A free-text input is also now required rather than merely cheaper — a
 * category the catalog has never seen is legal (see `resolveCategory`), and a
 * `<select>` cannot express one.
 */
export const CATEGORY_DATALIST_ID = 'product-import-categories';

interface ProductPreviewRowProps {
  index: number;
  record: Record<string, string>;
  ctx: CatalogImportContext;
  onChange: (index: number, patch: Record<string, string>) => void;
  serverError?: ProductServerError;
}

const cellClass = 'px-2 py-1.5 align-top';

function ProductPreviewRowImpl({ index, record, ctx, onChange, serverError }: ProductPreviewRowProps) {
  const result = useMemo(() => validateCatalogRow(stripRowId(record), ctx), [record, ctx]);
  const ok = result.ok === true && !serverError;
  const errorMessage = serverError ? serverError.error : result.ok === false ? result.error : undefined;
  const invalidField = result.ok === false ? result.field : undefined;

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
      <td className={`${cellClass} min-w-[120px]`}>
        <TextInput dense value={record.sku ?? ''} onChange={set('sku')} invalid={invalidField === 'sku'} />
      </td>
      <td className={`${cellClass} min-w-[160px]`}>
        <TextInput dense value={record.name ?? ''} onChange={set('name')} invalid={invalidField === 'name'} />
      </td>
      <td className={`${cellClass} min-w-[160px]`}>
        <TextInput dense value={record.description ?? ''} onChange={set('description')} />
      </td>
      <td className={`${cellClass} min-w-[90px]`}>
        <NumberInput dense value={record.price ?? ''} onChange={set('price')} invalid={invalidField === 'price'} />
      </td>
      <td className={`${cellClass} min-w-[140px]`}>
        <TextInput
          dense
          list={CATEGORY_DATALIST_ID}
          value={record.category ?? ''}
          onChange={set('category')}
          invalid={invalidField === 'category'}
        />
      </td>
      <td className={`${cellClass} min-w-[90px]`}>
        <TextInput dense value={record.unit ?? ''} onChange={set('unit')} invalid={invalidField === 'unit'} />
      </td>
      <td className={`${cellClass} min-w-[160px]`}>
        <TextInput
          dense
          value={record.supplier_name ?? ''}
          onChange={set('supplier_name')}
          invalid={invalidField === 'supplier_name'}
        />
      </td>
      <td className={`${cellClass} min-w-[90px]`}>
        <NumberInput dense value={record.carton_size ?? ''} onChange={set('carton_size')} invalid={invalidField === 'carton_size'} />
      </td>
      <td className={`${cellClass} min-w-[100px]`}>
        <NumberInput dense value={record.cubic_meters_unit ?? ''} onChange={set('cubic_meters_unit')} invalid={invalidField === 'cubic_meters_unit'} />
      </td>
      <td className={`${cellClass} min-w-[100px]`}>
        <NumberInput dense value={record.cubic_meters_carton ?? ''} onChange={set('cubic_meters_carton')} invalid={invalidField === 'cubic_meters_carton'} />
      </td>
      <td className={`${cellClass} min-w-[85px]`}>
        <NumberInput dense value={record.length_cm ?? ''} onChange={set('length_cm')} invalid={invalidField === 'length_cm'} />
      </td>
      <td className={`${cellClass} min-w-[85px]`}>
        <NumberInput dense value={record.width_cm ?? ''} onChange={set('width_cm')} invalid={invalidField === 'width_cm'} />
      </td>
      <td className={`${cellClass} min-w-[85px]`}>
        <NumberInput dense value={record.height_cm ?? ''} onChange={set('height_cm')} invalid={invalidField === 'height_cm'} />
      </td>
      <td className={`${cellClass} min-w-[85px]`}>
        <NumberInput dense value={record.size_factor ?? ''} onChange={set('size_factor')} invalid={invalidField === 'size_factor'} />
      </td>
      <td className={`${cellClass} min-w-[160px]`}>
        <TextInput dense value={record.image_url ?? ''} onChange={set('image_url')} invalid={invalidField === 'image_url'} />
      </td>
      <td className={`${cellClass} min-w-[180px] text-xs text-red-600`}>{errorMessage}</td>
    </tr>
  );
}

export const ProductPreviewRow = React.memo(ProductPreviewRowImpl);
