import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Product, User, PutawayLineRecommendation } from '../../types';
import { useReceiveStock } from '../../hooks/queries/useReceiveStock';
import { useRecentReceipts } from '../../hooks/queries/useInventoryBalances';
import { useSuppliers } from '../../hooks/queries/useSuppliers';
import { useRecommendPutaway } from '../../hooks/queries/usePutawayRecommendation';
import type { ReceiptHeader, ReceiptLine } from '../../services/supabase/receivingService';
import { useToasts } from '../../hooks/useToasts';
import { PutawayPanel } from './PutawayPanel';
import {
  PackagePlus, Plus, Trash2, Search, X, Boxes, History, Clock,
  Truck, FileText, CalendarDays, UserRound, Check, ChevronDown,
} from 'lucide-react';

/** Compact relative-time label ("just now", "3h ago", "2d ago"). */
const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  if (Number.isNaN(diffMs)) return '';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const RecentReceiptsPanel: React.FC = () => {
  const { data: receipts, isLoading } = useRecentReceipts(8);

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <History className="w-4 h-4 text-stone-400" />
        <h2 className="text-sm font-semibold text-stone-700">Recent receipts</h2>
      </div>
      {isLoading ? (
        <div className="divide-y divide-stone-100">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 h-3.5 rounded bg-stone-100 animate-pulse" />
              <div className="w-12 h-3.5 rounded bg-stone-100 animate-pulse" />
            </div>
          ))}
        </div>
      ) : !receipts || receipts.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Boxes className="w-8 h-8 text-stone-200 mx-auto mb-2" />
          <p className="text-sm text-stone-500">No goods received yet</p>
          <p className="text-xs text-stone-400 mt-1">Receipts you record will show up here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {receipts.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-800 truncate">{r.productName}</p>
                <p className="text-xs text-stone-400 font-mono">
                  {r.productSku}
                  {r.lotCode ? ` · lot ${r.lotCode}` : ''}
                  {r.expiryDate ? ` · exp ${r.expiryDate}` : ''}
                </p>
                {r.supplierName && (
                  <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                    <Truck className="w-3 h-3 text-stone-400" /> {r.supplierName}
                  </p>
                )}
              </div>
              <span className="font-mono text-sm text-emerald-600 shrink-0">+{r.qty}</span>
              <span className="flex items-center gap-1 text-xs text-stone-400 shrink-0 w-20 justify-end">
                <Clock className="w-3 h-3" /> {relativeTime(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface SupplierOption {
  id: number;
  name: string;
}

interface SupplierComboboxProps {
  suppliers: SupplierOption[];
  /** Currently selected supplier id (existing pick), or null for free-text/none. */
  valueId: number | null;
  /** Text shown in the field — an existing name or a free-text name. */
  valueName: string;
  onPickExisting: (supplier: SupplierOption) => void;
  /** User committed a name not in the list (create-on-the-fly). */
  onPickNew: (name: string) => void;
  onChangeText: (name: string) => void;
}

/**
 * Searchable supplier picker that also lets the operator type a supplier that
 * isn't in the list yet ("Create …"). A delivery always comes from one supplier,
 * so this is the required header field for a goods receipt.
 */
const SupplierCombobox: React.FC<SupplierComboboxProps> = ({
  suppliers, valueId, valueName, onPickExisting, onPickNew, onChangeText,
}) => {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const query = valueName.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return suppliers.slice(0, 8);
    return suppliers.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8);
  }, [suppliers, query]);

  const exactExists = useMemo(
    () => suppliers.some((s) => s.name.trim().toLowerCase() === query),
    [suppliers, query],
  );
  const showCreate = query.length > 0 && !exactExists;

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={valueName}
          onChange={(e) => { onChangeText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or type a supplier…"
          aria-label="Supplier"
          className="w-full pl-10 pr-9 py-2.5 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
        />
        {valueId != null ? (
          <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
        ) : (
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        )}
      </div>
      {open && (matches.length > 0 || showCreate) && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-card overflow-hidden">
          {matches.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { onPickExisting(s); setOpen(false); }}
              className="flex items-center justify-between w-full px-4 py-2.5 text-left hover:bg-stone-50 btn-press"
            >
              <span className="text-sm text-stone-800">{s.name}</span>
              {valueId === s.id && <Check className="w-4 h-4 text-emerald-500" />}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onClick={() => { onPickNew(valueName.trim()); setOpen(false); }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-left border-t border-stone-100 hover:bg-stone-50 btn-press"
            >
              <Plus className="w-4 h-4 text-nexgen-blue" />
              <span className="text-sm text-stone-700">
                Create “<span className="font-medium">{valueName.trim()}</span>”
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

interface ReceiveStockViewProps {
  products: Product[];
  currentUser: User;
}

interface DraftLine {
  key: string;
  productId: number | null;
  quantity: string;
  lotCode: string;
  expiryDate: string;
  barcode: string;
  supplierId: number | null; // per-line override; null = use the header supplier
}

let draftSeq = 0;
const newDraft = (): DraftLine => ({
  key: `d${draftSeq++}`,
  productId: null,
  quantity: '',
  lotCode: '',
  expiryDate: '',
  barcode: '',
  supplierId: null,
});

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const ReceiveStockView: React.FC<ReceiveStockViewProps> = ({ products, currentUser }) => {
  const { addToast } = useToasts();
  const receive = useReceiveStock();
  const recommend = useRecommendPutaway();
  const { data: supplierRows } = useSuppliers();

  // Engine putaway recommendations for the most recent receipt (layout warehouses).
  const [putaway, setPutaway] = useState<{ warehouseId: number; recommendations: PutawayLineRecommendation[] } | null>(null);

  const suppliers = useMemo<SupplierOption[]>(
    () => (supplierRows ?? []).map((s) => ({ id: s.id, name: s.name })),
    [supplierRows],
  );

  // ── Receipt header ─────────────────────────────────────────────────────────
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [reference, setReference] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayIso());
  // "Received by" is always the signed-in user — the server stamps received_by
  // with the actor when the client omits it.

  // ── Receipt lines ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<DraftLine[]>([]);

  const productById = useMemo(() => {
    const m = new Map<number, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [products, search]);

  const addProduct = (product: Product) => {
    setPicked(prev => [...prev, { ...newDraft(), productId: product.id }]);
    setSearch('');
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setPicked(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setPicked(prev => prev.filter(l => l.key !== key));
  };

  const validLines = useMemo(
    () => picked.filter(l => l.productId != null && Number(l.quantity) > 0),
    [picked],
  );

  const hasSupplier = supplierId != null || supplierName.trim() !== '';
  const canSubmit = hasSupplier && validLines.length > 0 && !receive.isPending;

  const submit = async () => {
    if (!hasSupplier || validLines.length === 0) return;
    const header: ReceiptHeader = {
      ...(supplierId != null
        ? { supplier_id: supplierId }
        : { supplier_name: supplierName.trim() }),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(receivedDate ? { received_date: receivedDate } : {}),
    };
    const lines: ReceiptLine[] = validLines.map(l => ({
      product_id: l.productId as number,
      quantity: Number(l.quantity),
      ...(l.lotCode.trim() ? { lot_code: l.lotCode.trim() } : {}),
      ...(l.expiryDate ? { expiry_date: l.expiryDate } : {}),
      ...(l.barcode.trim() ? { barcode: l.barcode.trim() } : {}),
      ...(l.supplierId != null ? { supplier_id: l.supplierId } : {}),
    }));
    try {
      const result = await receive.mutateAsync({ header, lines });
      addToast(`Received ${result.lines_received} line${result.lines_received === 1 ? '' : 's'} into stock`, 'success');
      setPicked([]);
      setReference('');
      setSupplierId(null);
      setSupplierName('');

      // If the destination warehouse has a published layout, fetch putaway
      // recommendations so the operator can slot the stock into bins.
      setPutaway(null);
      if (result.location_id) {
        try {
          const putawayLines = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
          const res = await recommend.mutateAsync({
            warehouseId: result.location_id,
            lines: putawayLines,
            goodsReceiptId: result.receipt_id,
          });
          if (res.mode === 'engine' && res.recommendations.length > 0) {
            setPutaway({ warehouseId: result.location_id, recommendations: res.recommendations });
          }
        } catch {
          // Putaway is advisory — a failure here must not break receiving.
          addToast('Stock received, but putaway suggestions could not be loaded.', 'info');
        }
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to receive stock', 'error');
    }
  };

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10">
          <PackagePlus className="w-5 h-5 text-nexgen-blue" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Receive Stock</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Record goods arriving into the Main Warehouse. Choose the supplier, then add what arrived.
          </p>
        </div>
      </div>

      {/* Receipt header — who supplied this delivery */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
              Supplier <span className="text-red-500">*</span>
            </label>
            <SupplierCombobox
              suppliers={suppliers}
              valueId={supplierId}
              valueName={supplierName}
              onChangeText={(name) => { setSupplierName(name); setSupplierId(null); }}
              onPickExisting={(s) => { setSupplierId(s.id); setSupplierName(s.name); }}
              onPickNew={(name) => { setSupplierId(null); setSupplierName(name); }}
            />
            {supplierId == null && supplierName.trim() !== '' && (
              <p className="text-xs text-stone-400 mt-1">New supplier — will be added to your supplier list.</p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
              <FileText className="w-3.5 h-3.5 text-stone-400" /> Reference
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Invoice / docket / PO no."
              className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:col-span-1 lg:grid-cols-1 lg:gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-stone-400" /> Received
              </label>
              <input
                type="date"
                value={receivedDate}
                max={todayIso()}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 max-w-xs">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
            <UserRound className="w-3.5 h-3.5 text-stone-400" /> Received by
          </label>
          <div className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700">
            {currentUser.name}
          </div>
        </div>
      </div>

      {/* Product search */}
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search a product by name, SKU, or barcode to add a line…"
          className="w-full pl-10 pr-9 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}
        {searchResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-card overflow-hidden">
            {searchResults.map(p => (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                className="flex items-center justify-between w-full px-4 py-2.5 text-left hover:bg-stone-50 btn-press"
              >
                <span className="text-sm text-stone-800">{p.name}</span>
                <span className="text-xs text-stone-400 font-mono">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Staged receipt lines */}
      {picked.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-nexgen-blue/10 flex items-center justify-center mx-auto mb-3">
            <Search className="w-5 h-5 text-nexgen-blue" />
          </div>
          <p className="text-sm font-medium text-stone-700">Start a goods receipt</p>
          <p className="text-xs text-stone-400 mt-1 max-w-sm mx-auto">
            Pick the supplier above, then search a product to add a line, set the received quantity
            (and an optional lot code &amp; expiry), and receive it into the Main Warehouse.
          </p>
        </div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200">
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Product</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider w-28">Qty</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider w-40">Lot code</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider w-40">Expiry</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider w-40">Barcode</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider w-44">Supplier</th>
                  <th scope="col" className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {picked.map(line => {
                  const product = line.productId != null ? productById.get(line.productId) : undefined;
                  return (
                    <tr key={line.key} className="hover:bg-stone-50/50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-stone-900">{product?.name ?? '—'}</p>
                        <p className="text-xs text-stone-400 font-mono">{product?.sku}</p>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={e => updateLine(line.key, { quantity: e.target.value })}
                          className="w-full px-2 py-1.5 text-right font-mono text-sm bg-stone-50 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={line.lotCode}
                          onChange={e => updateLine(line.key, { lotCode: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
                          placeholder="optional"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="date"
                          value={line.expiryDate}
                          onChange={e => updateLine(line.key, { expiryDate: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={line.barcode}
                          onChange={e => updateLine(line.key, { barcode: e.target.value })}
                          className="w-full px-2 py-1.5 font-mono text-sm bg-stone-50 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
                          placeholder="optional"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={line.supplierId ?? ''}
                          onChange={e =>
                            updateLine(line.key, {
                              supplierId: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          aria-label="Line supplier override"
                          className="w-full px-2 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
                        >
                          <option value="">Use header supplier</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeLine(line.key)}
                          className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-md btn-press"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-stone-200 bg-stone-50/50">
            <button
              onClick={() => setPicked(prev => [...prev, newDraft()])}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press"
            >
              <Plus className="w-4 h-4" /> Add blank line
            </button>
            <div className="flex items-center gap-3">
              {!hasSupplier && validLines.length > 0 && (
                <span className="text-xs text-amber-600">Choose a supplier to receive</span>
              )}
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 px-4 py-2 bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PackagePlus className="w-4 h-4" />
                {receive.isPending
                  ? 'Receiving…'
                  : `Receive ${validLines.length} line${validLines.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Putaway recommendations — appears after receiving into a layout warehouse */}
      {putaway && (
        <PutawayPanel
          warehouseId={putaway.warehouseId}
          recommendations={putaway.recommendations}
          productNameById={new Map(products.map((p) => [p.id, p.name]))}
        />
      )}

      {/* Recent receipts — gives the screen context and an audit trail */}
      <RecentReceiptsPanel />
    </div>
  );
};

export default ReceiveStockView;
