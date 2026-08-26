import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Product, User, PutawayLineRecommendation } from '../../types';
import { UserRole } from '../../types';
import { useReceiveStock } from '../../hooks/queries/useReceiveStock';
import { useRecentReceipts } from '../../hooks/queries/useInventoryBalances';
import { useSuppliers } from '../../hooks/queries/useSuppliers';
import { useLevelRoles } from '@/hooks/queries/useLevelRoles';
import { useSettings } from '../../hooks/queries/useSettings';
import { palletSpecFromSettings } from '../../lib/palletUom';
import { roleLabel, rolesForHuType } from '@/lib/levelRoles';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import type { ReceiptHeader, ReceiptLine, ReceiptPlate } from '../../services/supabase/receivingService';
import { useToasts } from '../../hooks/useToasts';
import { receivableUoms, deriveDefaultUoms, baseUom } from '../../lib/uom';
import { productsForSupplier, supplierSkuFor, matchesProductQuery } from '../../lib/productSuppliers';
import { ScanField } from '../ui/ScanField';
import ReceiveLineCard, { RECEIVE_ROW_COLUMNS } from './receive/ReceiveLineCard';
import MixedPalletCard from './receive/MixedPalletCard';
import {
  newDraft,
  newMixedPlate,
  newPlate,
  plateLabel,
  type DraftLine,
  type DraftPlate,
} from './receive/receiveDraft';
import { buildScanIndex, normalizeScan } from '../../lib/scan/resolveScan';
import { describeReceiveRefusal, resolveReceiveScan } from '../../lib/scan/receiveScan';
import { useScanFlash } from '../../lib/scan/useScanFlash';
import { useWedgeScanner } from '../../lib/scan/useWedgeScanner';
import { PutawayPanel } from './PutawayPanel';
import {
  PackagePlus, Plus, Trash2, Search, X, Boxes, History, Clock,
  Truck, FileText, CalendarDays, UserRound, Check, ChevronDown, Warehouse, ArrowRight,
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
  /** Navigate to the Putaway tab pre-selected to a warehouse — wired to the
   *  post-receipt "Go to putaway" CTA. Undefined when the host doesn't support
   *  cross-tab navigation (keeps this view mountable standalone/in tests). */
  onOpenPutaway?: (warehouseId: number) => void;
}

// `DraftLine`, `DraftPlate`, `newDraft`, `newPlate` and `plateLabel` moved to
// ./receive/receiveDraft.ts when the line row was extracted — both files need
// them, and importing them back from here would have made the cycle.
// Re-exported because `plateLabel` was part of this module's public surface.
export { plateLabel };

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Default destination warehouse for a goods receipt: the user's home site when
 * it is active, otherwise the first active warehouse, else null (no active
 * site — the server routes to the system default). Unlike the layout viewer's
 * resolver, receiving does not care whether a site is racked or published.
 */
export function resolveReceiveDestination(
  activeWarehouses: readonly { id: number }[],
  homeWarehouseId: number | undefined,
): number | null {
  if (activeWarehouses.length === 0) return null;
  if (homeWarehouseId != null && activeWarehouses.some((w) => w.id === homeWarehouseId)) {
    return homeWarehouseId;
  }
  return activeWarehouses[0].id;
}

const ReceiveStockView: React.FC<ReceiveStockViewProps> = ({ products, currentUser, onOpenPutaway }) => {
  const { addToast } = useToasts();
  const receive = useReceiveStock();
  const { data: supplierRows } = useSuppliers();
  const { data: warehouseRows } = useWarehouses();
  // Operator-managed role vocabulary (mig 00081). The plate-type dropdown tells
  // the receiver where each kind of unit will be steered, so it has to read the
  // routing rather than restate it.
  const { data: levelRoles = [] } = useLevelRoles();
  // The global pallet (mig 00125) — only so a Pallet unit can say whether its
  // quantity was measured or estimated, at the moment it becomes real stock.
  const { data: settingsRow } = useSettings();
  const palletSpec = useMemo(() => palletSpecFromSettings(settingsRow), [settingsRow]);

  // Phrased as a PREDICTION, not a destination. "Pallet → Reserve" read as a
  // storage commitment, and it is not one: putaway may place this anywhere, the
  // SKU's own rule outranks the plate preference, and the operator can break a
  // pallet down on the floor. What arrives and where it ends up are different
  // questions, and this control only answers the first.
  const plateDestinationLabel = (huType: 'pallet' | 'carton'): string => {
    const noun = huType === 'pallet' ? 'Pallet' : 'Carton';
    const dest = rolesForHuType(levelRoles, huType).map((k) => roleLabel(levelRoles, k));
    // No role claims this plate type: putaway falls back to the SKU's own rule,
    // so naming a destination here would be a lie rather than a guess.
    return dest.length > 0 ? `${noun} (usually → ${dest.join('/')})` : noun;
  };

  // Engine putaway recommendations for the most recent receipt (layout warehouses).
  const [putaway, setPutaway] = useState<{ warehouseId: number; recommendations: PutawayLineRecommendation[] } | null>(null);

  const suppliers = useMemo<SupplierOption[]>(
    () => (supplierRows ?? []).map((s) => ({ id: s.id, name: s.name })),
    [supplierRows],
  );

  // Destination warehouses — only active sites can receive stock.
  const activeWarehouses = useMemo(
    () => (warehouseRows ?? []).filter((w) => w.isActive),
    [warehouseRows],
  );
  // Warehouse-role staff with an assigned home site are pinned to it server-side.
  // We never send a location_id for them — the server defaults to their
  // home_warehouse_id — and show a read-only label instead of a picker (any other
  // destination is rejected). Warehouse staff with NO home site assigned
  // (home_warehouse_id NULL — true for every profile until one is set in Users
  // admin) get the same editable picker as an Admin, and location_id IS sent,
  // otherwise they would have no way to choose a destination at all.
  const isLocked = currentUser.role === UserRole.WAREHOUSE && currentUser.homeWarehouseId != null;

  // ── Receipt header ─────────────────────────────────────────────────────────
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [reference, setReference] = useState('');
  // Not submitted directly: ticking it writes `quarantine` onto every line
  // (see DraftLine.quarantine). Purely a bulk control over the grid below.
  const [quarantineAll, setQuarantineAll] = useState(false);
  const [receivedDate, setReceivedDate] = useState(todayIso());
  // Destination warehouse the goods land in. Defaults to the user's home site
  // (server applies the same fallback when omitted); null until warehouses load.
  const [destinationId, setDestinationId] = useState<number | null>(null);
  // "Received by" is always the signed-in user — the server stamps received_by
  // with the actor when the client omits it.

  // Seed the destination once the warehouse list arrives (prefer the home site,
  // else the first active site) and re-resolve if the chosen site later drops out
  // of the active list (e.g. deactivated in another tab). Locked users don't pick.
  useEffect(() => {
    if (isLocked || activeWarehouses.length === 0) return;
    const stillValid = destinationId != null && activeWarehouses.some((w) => w.id === destinationId);
    if (stillValid) return;
    setDestinationId(resolveReceiveDestination(activeWarehouses, currentUser.homeWarehouseId));
  }, [activeWarehouses, currentUser.homeWarehouseId, destinationId, isLocked]);

  const homeName = useMemo(
    () => activeWarehouses.find((w) => w.id === currentUser.homeWarehouseId)?.name,
    [activeWarehouses, currentUser.homeWarehouseId],
  );
  // Where the stock will actually land: the home site for locked users (server
  // routes there), otherwise the operator's selection.
  const destName = isLocked
    ? homeName
    : activeWarehouses.find((w) => w.id === destinationId)?.name;

  // ── Receipt lines ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<DraftLine[]>([]);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const { flash, signal: signalFlash } = useScanFlash();

  const productById = useMemo(() => {
    const m = new Map<number, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  // A delivery only ever contains the delivering supplier's items, so once an
  // EXISTING supplier is picked the picker narrows to their catalogue (mig
  // 00070). The narrowing is soft: `showAllProducts` widens it back, because a
  // product whose supplier link hasn't been set up yet must never block a
  // receipt. supplierId is null both before a pick and for a typed-but-not-yet-
  // created supplier — exactly the cases that should still show everything.
  const [showAllProducts, setShowAllProducts] = useState(false);
  const isFiltered = supplierId != null && !showAllProducts;

  // Reset the widening whenever the supplier changes — "show all" is a
  // per-delivery escape hatch, not a sticky preference.
  useEffect(() => { setShowAllProducts(false); }, [supplierId]);

  const supplierProducts = useMemo(
    () => (supplierId != null ? productsForSupplier(products, supplierId) : products),
    [products, supplierId],
  );

  const searchPool = isFiltered ? supplierProducts : products;

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return searchPool.filter(p => matchesProductQuery(p, q, supplierId)).slice(0, 8);
  }, [searchPool, search, supplierId]);

  // Only computed when the filtered search came up empty, to offer a one-click
  // widen instead of a dead end.
  const wouldMatchOutsideSupplier = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !isFiltered || searchResults.length > 0) return false;
    return products.some(p => matchesProductQuery(p, q, supplierId));
  }, [products, search, isFiltered, searchResults.length, supplierId]);

  // ── Plates (mig 00075) ─────────────────────────────────────────────────────
  // Every receipt line lands on a pallet or carton. The default is ONE PLATE
  // PER LINE, which is what a delivery of loose cartons actually looks like;
  // an operator building a mixed pallet reassigns lines onto a shared plate.
  const [plates, setPlates] = useState<DraftPlate[]>([]);

  // Which mixed pallet is capturing new lines, if any. Null is the ordinary
  // case: a new line gets a plate of its own, which is what a delivery of
  // separate units actually looks like.
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);

  // ScanField exposes no ref, so reach the input through the wrapper we own.
  // Only for pointer/keyboard "Add item" — a gun does not need focus at all,
  // because `useWedgeScanner` captures regardless of where it sits.
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const focusSearch = () => { searchWrapRef.current?.querySelector('input')?.focus(); };


  const addProduct = (product: Product) => {
    // A mixed pallet is open, so everything added rides on it — including dock
    // scans, since `handleDockScan` reaches here. That is the whole point of
    // the card on a gun: walk the pallet, scan, scan, scan, press Done.
    const openGroup = activeGroupKey != null && plates.some(p => p.key === activeGroupKey);
    if (openGroup) {
      setPicked(prev => [...prev, { ...newDraft(activeGroupKey as string, quarantineAll), productId: product.id }]);
      setSearch('');
      return;
    }
    // Functional update, NOT `setPlates([...plates, plate])`. Two scans landing
    // in one React batch both read the same `plates` from their own render
    // closure, so the second drops the first's plate and leaves its line
    // pointing at a plate_key that is never declared -- which `createPlates`
    // rejects, failing the WHOLE receipt. A dock gun is exactly how you get two
    // adds in one batch.
    const plate = newPlate();
    setPlates(prev => [...prev, plate]);
    setPicked(prev => [...prev, { ...newDraft(plate.key, quarantineAll), productId: product.id }]);
    setSearch('');
  };

  /** Start a mixed pallet and point everything that follows at it. */
  const addMixedPallet = () => {
    const plate = newMixedPlate();
    setPlates(prev => [...prev, plate]);
    setActiveGroupKey(plate.key);
    focusSearch();
  };

  /** Remove a mixed pallet and everything on it — the goods left together. */
  const removePlate = (plateKey: string) => {
    setPicked(prev => prev.filter(l => l.plateKey !== plateKey));
    setPlates(prev => prev.filter(p => p.key !== plateKey));
    setActiveGroupKey(k => (k === plateKey ? null : k));
  };

  // ── Scanning at the dock ───────────────────────────────────────────────────
  //
  // This screen had no scan affordance at all, which is odd for the one place
  // in the building where someone is definitely holding a barcode. Three things
  // are scannable and they resolve through one pure module, `receiveScan.ts`.
  //
  // The index is built over the FULL catalogue, never `searchPool`. The
  // supplier narrowing is a soft convenience (see showAllProducts above), and
  // refusing a scanned carton because a supplier link has not been configured
  // would block a real delivery for a data-entry reason.
  const scanIndex = useMemo(
    () => buildScanIndex({
      products: products.map(p => ({ id: p.id, sku: p.sku, name: p.name, barcode: p.barcode ?? null })),
    }),
    [products],
  );

  // Site roots only — this is what lets a warehouse be told from a bin without
  // a second query, since both are `locations` rows.
  const warehouseIdByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of activeWarehouses) m.set(normalizeScan(w.code), w.id);
    return m;
  }, [activeWarehouses]);

  const handleDockScan = (raw: string) => {
    const target = resolveReceiveScan(raw, scanIndex, warehouseIdByCode);

    if (target.kind === 'product') {
      const product = productById.get(target.product.id);
      if (product) {
        addProduct(product);
        setScanNote(null);
        signalFlash('ok');
        return;
      }
    }

    if (target.kind === 'warehouse' && !isLocked) {
      setDestinationId(target.warehouseId);
      setScanNote(null);
      signalFlash('ok');
      return;
    }

    setScanNote(describeReceiveRefusal(target));
    signalFlash('reject');
  };

  // The desktop safety net. Receiving is a long form full of quantity and date
  // boxes, so focus is rarely where the next scan needs it — this is the screen
  // the global capture was really written for.
  useWedgeScanner({ active: true, onScan: handleDockScan });

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setPicked(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setPicked(prev => prev.filter(l => l.key !== key));
  };

  // A normal line owns its plate one-for-one, so this can no longer retype a
  // sibling line's unit the way the old shared-plate dropdown could. The
  // `!p.mixed` guard is the remaining case: a mixed pallet is a pallet by
  // definition, and nothing on this screen may argue otherwise.
  const setPlateType = (plateKey: string, huType: 'pallet' | 'carton') => {
    setPlates(prev => prev.map(p => (p.key === plateKey && !p.mixed ? { ...p, huType } : p)));
  };

  // Plates with nothing on them are dropped before submit: the server rejects
  // an empty plate (it would be an orphan holding no stock), and a line can be
  // removed after its plate was created.
  const referencedPlates = useMemo(
    () => plates.filter(p => picked.some(l => l.plateKey === p.key)),
    [plates, picked],
  );

  // Mixed pallets render as their own cards; everything else is a plain line.
  const mixedPlates = useMemo(() => plates.filter(p => p.mixed), [plates]);
  const looseLines = useMemo(
    () => picked.filter(l => !mixedPlates.some(p => p.key === l.plateKey)),
    [picked, mixedPlates],
  );

  const validLines = useMemo(
    () => picked.filter(l => l.productId != null && Number(l.quantity) > 0),
    [picked],
  );

  const hasSupplier = supplierId != null || supplierName.trim() !== '';
  // Locked users always have a server-derived destination (their home site); for
  // everyone else a destination must be resolved unless no site is active (then
  // the server routes to the default site).
  const hasDestination = isLocked || destinationId != null || activeWarehouses.length === 0;
  const canSubmit = hasSupplier && hasDestination && validLines.length > 0 && !receive.isPending;

  const submit = async () => {
    if (!hasSupplier || !hasDestination || validLines.length === 0) return;
    const header: ReceiptHeader = {
      ...(supplierId != null
        ? { supplier_id: supplierId }
        : { supplier_name: supplierName.trim() }),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(receivedDate ? { received_date: receivedDate } : {}),
      // Locked users omit location_id so the server routes to their home site.
      ...(!isLocked && destinationId != null ? { location_id: destinationId } : {}),
    };
    const lines: ReceiptLine[] = validLines.map(l => ({
      product_id: l.productId as number,
      quantity: Number(l.quantity),
      ...(l.uomId != null ? { uom_id: l.uomId } : {}),
      ...(l.lotCode.trim() ? { lot_code: l.lotCode.trim() } : {}),
      ...(l.expiryDate ? { expiry_date: l.expiryDate } : {}),
      ...(l.barcode.trim() ? { barcode: l.barcode.trim() } : {}),
      plate_key: l.plateKey,
      ...(l.quarantine ? { quarantine: true } : {}),
    }));
    // Only plates carrying a VALID line: a plate whose only line was left
    // incomplete would arrive empty and be rejected server-side.
    const platePayload: ReceiptPlate[] = referencedPlates
      .filter(p => validLines.some(l => l.plateKey === p.key))
      .map(p => ({ key: p.key, hu_type: p.huType }));
    try {
      const result = await receive.mutateAsync({ header, lines, plates: platePayload });
      addToast(`Received ${result.lines_received} line${result.lines_received === 1 ? '' : 's'} into stock`, 'success');
      setPicked([]);
      setPlates([]);
      setActiveGroupKey(null);
      setReference('');
      setQuarantineAll(false);
      setSupplierId(null);
      setSupplierName('');

      // Putaway tasks are generated server-side by receive-stock (so the CSV
      // importer and every other arrival path get them too). Render the panel
      // straight from the receipt's response — no extra round-trip.
      setPutaway(null);
      if (result.location_id && result.putaway?.mode === 'engine' && result.putaway.recommendations.length > 0) {
        setPutaway({ warehouseId: result.location_id, recommendations: result.putaway.recommendations });
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to receive stock', 'error');
    }
  };

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 xl:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10">
          <PackagePlus className="w-5 h-5 text-nexgen-blue" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Receive Stock</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Record goods arriving into {destName ?? 'the selected warehouse'}. Choose the supplier, then add what arrived.
          </p>
        </div>
      </div>

      {/* Receipt header — who supplied this delivery */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-2">
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
            {/* Quarantine (mig 00101). Bulk control only: it writes the flag onto
                every line in the grid, so what is ticked below IS what is sent. */}
            <label className="mt-2 flex items-start gap-2 text-xs text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={quarantineAll}
                onChange={(e) => {
                  const next = e.target.checked;
                  setQuarantineAll(next);
                  setPicked(prev => prev.map(l => ({ ...l, quarantine: next })));
                }}
              />
              <span>
                <span className="font-semibold text-stone-700">Quarantine this delivery</span>
                <span className="block text-stone-400">
                  Goes to a quarantine bay. It cannot be sold until you release it by moving it out.
                </span>
              </span>
            </label>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
              <Warehouse className="w-3.5 h-3.5 text-stone-400" /> Destination
            </label>
            {isLocked ? (
              <>
                <div className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700">
                  {homeName ?? 'Your site'}
                </div>
                <p className="text-xs text-stone-400 mt-1">You can only receive at your site.</p>
              </>
            ) : activeWarehouses.length === 0 ? (
              <div className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-500">
                No active warehouse — stock lands at the default site.
              </div>
            ) : activeWarehouses.length === 1 ? (
              <div className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700">
                {activeWarehouses[0].name}
              </div>
            ) : (
              <select
                value={destinationId ?? ''}
                onChange={(e) => setDestinationId(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="Destination warehouse"
                className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
              >
                {activeWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 xl:col-span-1 xl:grid-cols-1 xl:gap-4">
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

      {/* Product search / dock scan */}
      {/* One box for both jobs, deliberately. Typing still drives the substring
          search and its dropdown exactly as before; a SCAN (camera, wedge gun,
          or Enter) goes through `handleDockScan` and adds the line outright.
          Splitting them into two inputs would mean the operator has to decide
          which one to aim at before they know what the label is. */}
      <div className="max-w-xl space-y-1.5">
        <div className="relative" ref={searchWrapRef}>
          <ScanField
            ariaLabel="Search products"
            value={search}
            onChange={(v) => { setSearch(v); if (scanNote) setScanNote(null); }}
            onScan={handleDockScan}
            flash={flash}
            error={scanNote ?? undefined}
            placeholder={
              isFiltered
                ? `Scan a carton, or search ${supplierName}’s products…`
                : 'Scan a carton, or search by name, SKU or barcode…'
            }
            cameraTitle="Scan a carton"
          />
          {/* 22px = half of ScanField's 44px input. NOT `top-1/2`: this wrapper
              also contains the error line, so a percentage drifts downward the
              moment a refusal message appears. Tied to the input height, so it
              moves if that does. */}
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-[22px] -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
          {searchResults.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-card overflow-hidden">
              {searchResults.map(p => {
                const theirSku = supplierSkuFor(p, supplierId);
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="flex items-center justify-between gap-3 w-full px-4 py-2.5 text-left hover:bg-stone-50 btn-press"
                  >
                    <span className="text-sm text-stone-800 truncate">{p.name}</span>
                    <span className="text-xs text-stone-400 font-mono shrink-0">
                      {theirSku ? `${theirSku} · ` : ''}{p.sku}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Scope hint — which catalogue is being searched, and how to widen it. */}
        {supplierId != null && (
          <p className="text-xs text-stone-400">
            {isFiltered ? (
              <>
                Showing {supplierProducts.length} product{supplierProducts.length === 1 ? '' : 's'} from{' '}
                <span className="text-stone-500">{supplierName}</span>.{' '}
                <button
                  type="button"
                  onClick={() => setShowAllProducts(true)}
                  className="text-nexgen-blue hover:underline cursor-pointer"
                >
                  Show all products
                </button>
              </>
            ) : (
              <>
                Showing all products.{' '}
                <button
                  type="button"
                  onClick={() => setShowAllProducts(false)}
                  className="text-nexgen-blue hover:underline cursor-pointer"
                >
                  Only {supplierName}’s products
                </button>
              </>
            )}
          </p>
        )}
        {wouldMatchOutsideSupplier && (
          <p className="text-xs text-amber-600">
            No match in {supplierName}’s products.{' '}
            <button
              type="button"
              onClick={() => setShowAllProducts(true)}
              className="font-medium hover:underline cursor-pointer"
            >
              Search all products
            </button>
          </p>
        )}
      </div>

      {/* Staged receipt lines */}
      {picked.length === 0 && mixedPlates.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-nexgen-blue/10 flex items-center justify-center mx-auto mb-3">
            <Search className="w-5 h-5 text-nexgen-blue" />
          </div>
          <p className="text-sm font-medium text-stone-700">Start a goods receipt</p>
          <p className="text-xs text-stone-400 mt-1 max-w-sm mx-auto">
            Pick the supplier above, then search a product to add a line, set the received quantity
            (and an optional lot code &amp; expiry), and receive it into {destName ?? 'the selected warehouse'}.
          </p>
          {/* The mixed-pallet affordance has to live here as well as in the
              footer. The footer only exists once something is staged, so
              without this a receipt could never START with a mixed pallet —
              which is exactly how a delivery of one arrives. */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={addMixedPallet}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press"
            >
              <Boxes className="w-4 h-4" /> Mixed pallet
            </button>
          </div>
        </div>
      ) : (
        /* `@container` is declared HERE, on the one element that wraps both the
           column headings and every row, so the two can never disagree about
           which layout is showing. The row needs 1180px of CONTAINER — see the
           measurement table in `ReceiveLineCard`, and note that a viewport
           breakpoint got this wrong by the width of the sidebar.

           A plain block comment rather than a JSX one: this sits directly
           inside a ternary branch, where a JSX expression container is not yet
           legal. */
        <div className="@container glass-card rounded-xl overflow-hidden">
          {/*
            Column headings. Hidden until the container can seat all eight
            columns, below which each control carries its own micro-label
            instead — see `ReceiveLineCard`. The template is imported rather
            than restated, so the headings can never drift out of alignment
            with the cells beneath them.
          */}
          <div
            className={`hidden border-b border-stone-200 px-4 py-3 @min-[1180px]:grid @min-[1180px]:gap-x-4 ${RECEIVE_ROW_COLUMNS}`}
          >
            {['Product', 'Qty', 'Lot code', 'Expiry', 'Barcode', 'Arrived on', 'Hold', ''].map(
              (heading, i) => (
                <span
                  key={heading || `spacer-${i}`}
                  className={`text-xs font-semibold uppercase tracking-wider text-stone-500 ${
                    heading === 'Qty' ? 'text-right' : heading === 'Hold' ? 'text-center' : 'text-left'
                  }`}
                >
                  {heading}
                </span>
              ),
            )}
          </div>

          {/* `divide-y` rather than a card per line: the lines already sit
              inside one `glass-card`, and boxing each of them again would be a
              second surface saying nothing the divider does not. */}
          <div className="divide-y divide-stone-100">
            {/* Mixed pallets first: they are containers, and a container that
                sorted itself in among its own contents would read as one more
                line. `plateLabel` is passed the FULL plate list so the numbering
                counts mixed pallets among themselves. */}
            {mixedPlates.map(plate => (
              <React.Fragment key={plate.key}>
                <MixedPalletCard
                  plate={plate}
                  label={plateLabel(plates, plate.key)}
                  lines={picked.filter(l => l.plateKey === plate.key)}
                  productById={productById}
                  supplierId={supplierId}
                  plateDestinationLabel={plateDestinationLabel}
                  palletSpec={palletSpec}
                  active={activeGroupKey === plate.key}
                  onAddItem={() => { setActiveGroupKey(plate.key); focusSearch(); }}
                  onDone={() => setActiveGroupKey(null)}
                  onRemove={() => removePlate(plate.key)}
                  onUpdateLine={updateLine}
                  onRemoveLine={removeLine}
                />
              </React.Fragment>
            ))}
            {looseLines.map(line => (
              // `key` on a typed local component is a type error here: with no
              // @types/react there is no global JSX namespace, so `key` is
              // checked against the component's own props. Fragment carries it
              // instead, and renders no DOM node — so the card's root stays a
              // direct child of `divide-y`. See CLAUDE.md, "Types gotcha".
              <React.Fragment key={line.key}>
              <ReceiveLineCard
                line={line}
                product={line.productId != null ? productById.get(line.productId) : undefined}
                supplierId={supplierId}
                plates={plates}
                plateDestinationLabel={plateDestinationLabel}
                palletSpec={palletSpec}
                onUpdate={patch => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
                onSetPlateType={huType => setPlateType(line.plateKey, huType)}
              />
              </React.Fragment>
            ))}
          </div>

          {/* Footer actions */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-stone-200 bg-stone-50/50">
            <button
              onClick={() => {
                const plate = newPlate();
                setPlates(prev => [...prev, plate]);
                setPicked(prev => [...prev, newDraft(plate.key, quarantineAll)]);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press"
            >
              <Plus className="w-4 h-4" /> Add blank line
            </button>
            {/* The container-first path. Declaring the pallet and then listing
                what is on it is how an operator describes one; the alternative
                was pointing three separate line dropdowns at the same entry. */}
            <button
              onClick={addMixedPallet}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press"
            >
              <Boxes className="w-4 h-4" /> Mixed pallet
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-3">
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
        <div className="space-y-3">
          {onOpenPutaway && (
            <div className="flex justify-end">
              <button
                onClick={() => onOpenPutaway(putaway.warehouseId)}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 bg-nexgen-blue text-white font-medium rounded-lg btn-press"
              >
                Go to putaway <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
          <PutawayPanel
            warehouseId={putaway.warehouseId}
            recommendations={putaway.recommendations}
            productNameById={new Map(products.map((p) => [p.id, p.name]))}
          />
        </div>
      )}

      {/* Recent receipts — gives the screen context and an audit trail */}
      <RecentReceiptsPanel />
    </div>
  );
};

export default ReceiveStockView;
