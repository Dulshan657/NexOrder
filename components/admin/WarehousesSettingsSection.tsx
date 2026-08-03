import React, { useEffect, useRef, useState } from 'react';
import { Warehouse as WarehouseIcon, Plus, Pencil, Power, MapPin, Boxes, LayoutGrid, Gauge } from 'lucide-react';
import { useWarehouses, useDeactivateWarehouse } from '../../hooks/queries/useWarehouses';
import { Modal } from '../ui';
import WarehouseForm from './WarehouseForm';
import WarehouseTreeEditor from './WarehouseTreeEditor';
import { LayoutDesignerView } from './layout/LayoutDesignerView';
import { WarehouseIntelligenceRulesView } from './rules/WarehouseIntelligenceRulesView';
import { ScoringWeightsSection } from './ScoringWeightsSection';
import { SlottingSuggestionsView } from './SlottingSuggestionsView';
import { WarehouseIntelligenceReport } from './WarehouseIntelligenceReport';
import type { Warehouse } from '../../types';
import { useFlagDeepLink } from '../../hooks/useFlagDeepLink';

/** Admin warehouse management — create / edit / deactivate any number of
 * warehouses, each bulk or racked, with map-picked coordinates used for
 * closest-warehouse order routing. Rendered as a section in Settings. */
const WarehousesSettingsSection: React.FC = () => {
  const { data: warehouses, isLoading, isError } = useWarehouses();
  const deactivate = useDeactivateWarehouse();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [treeFor, setTreeFor] = useState<Warehouse | null>(null);
  const [designerFor, setDesignerFor] = useState<Warehouse | null>(null);
  const [designerAutoImport, setDesignerAutoImport] = useState(false);
  const [optimizeFor, setOptimizeFor] = useState<Warehouse | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (w: Warehouse) => { setEditing(w); setFormOpen(true); };

  // Deep-link from the Warehouse viewer's empty-state CTA: ?designer=<id> opens
  // that warehouse's Layout Designer once the list loads. Runs once, then strips
  // the param so closing the modal doesn't reopen it. ?import=1 is consumed by
  // the designer itself (auto-opens the floor-plan import modal).
  const designerDeepLinkDone = useRef(false);
  useEffect(() => {
    if (designerDeepLinkDone.current || !warehouses) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('designer');
    if (!id) return;
    const match = warehouses.find((w) => String(w.id) === id);
    // Spent once the list has loaded and we have looked, MATCH OR NOT. This
    // used to return early on a miss, leaving ?designer= in the URL forever —
    // and because AdminView unmounts the tab on switch, the ref reset and the
    // dead link re-fired on every later visit to Settings.
    designerDeepLinkDone.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('designer');
    url.searchParams.delete('import');
    window.history.replaceState({}, '', url.toString());
    if (!match) return;
    setDesignerAutoImport(params.get('import') === '1');
    setDesignerFor(match);
  }, [warehouses]);

  // ?whrules=1 opens the optimizer-rules modal — the setup checklist's target
  // for "optimizer rules set for this site". No data dependency, so unlike the
  // designer link this need not wait for the warehouse list.
  useFlagDeepLink('whrules', () => setRulesOpen(true));

  const handleDeactivate = async (w: Warehouse) => {
    setActionError(null);
    try {
      await deactivate.mutateAsync(w.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to deactivate warehouse.');
    }
  };

  const list = warehouses ?? [];
  const active = list.filter((w) => w.isActive);
  const inactive = list.filter((w) => !w.isActive);

  return (
    <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <WarehouseIcon className="w-5 h-5 text-nexgen-blue" />
          <h3 className="text-base font-display font-bold text-stone-900">Warehouses</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRulesOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-stone-200 text-stone-700 hover:bg-stone-100 btn-press"
          >
            <LayoutGrid className="w-4 h-4 text-emerald-600" /> Optimizer rules
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
          >
            <Plus className="w-4 h-4" /> Add warehouse
          </button>
        </div>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        Distribution centres stock is held at. Orders auto-allocate from the warehouse closest to the
        customer and split across sites when the nearest is short.
      </p>

      {actionError && <p className="text-sm text-red-600 mb-3">{actionError}</p>}

      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-14 rounded-lg bg-stone-100 animate-pulse" />)}</div>
      ) : isError ? (
        <p className="text-sm text-red-600">Couldn't load warehouses.</p>
      ) : list.length === 0 ? (
        <div className="text-center py-8 text-sm text-stone-500">No warehouses yet. Add your first one.</div>
      ) : (
        <div className="space-y-2">
          {[...active, ...inactive].map((w) => (
            <div
              key={w.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border bg-white ${
                w.isActive ? 'border-stone-200' : 'border-stone-200 opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-display font-bold text-stone-900 truncate">{w.name}</p>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{w.code}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                    w.locationType === 'racked' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {w.locationType === 'racked' ? 'Racked' : 'Bulk'}
                  </span>
                  {!w.isActive && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">Inactive</span>}
                </div>
                <p className="text-xs text-stone-500 mt-0.5 truncate flex items-center gap-1">
                  {typeof w.lat === 'number' && typeof w.lng === 'number' ? (
                    <><MapPin className="w-3 h-3" /> {w.lat.toFixed(3)}, {w.lng.toFixed(3)}</>
                  ) : (
                    <span className="text-amber-600">No coordinates — uses default routing</span>
                  )}
                  {w.address ? ` · ${w.address}` : ''}
                </p>
              </div>
              <button onClick={() => { setDesignerAutoImport(false); setDesignerFor(w); }} className="p-2 rounded-lg hover:bg-emerald-50 btn-press" aria-label={`Layout designer for ${w.name}`} title="Layout designer">
                <LayoutGrid className="w-4 h-4 text-emerald-600" />
              </button>
              <button onClick={() => setOptimizeFor(w)} className="p-2 rounded-lg hover:bg-emerald-50 btn-press" aria-label={`Optimization for ${w.name}`} title="Optimization">
                <Gauge className="w-4 h-4 text-emerald-600" />
              </button>
              {w.locationType === 'racked' && (
                <button onClick={() => setTreeFor(w)} className="p-2 rounded-lg hover:bg-violet-50 btn-press" aria-label={`Storage layout for ${w.name}`} title="Storage tree">
                  <Boxes className="w-4 h-4 text-violet-600" />
                </button>
              )}
              <button onClick={() => openEdit(w)} className="p-2 rounded-lg hover:bg-stone-100 btn-press" aria-label={`Edit ${w.name}`}>
                <Pencil className="w-4 h-4 text-stone-500" />
              </button>
              {w.isActive && (
                <button
                  onClick={() => handleDeactivate(w)}
                  disabled={deactivate.isPending}
                  className="p-2 rounded-lg hover:bg-red-50 btn-press disabled:opacity-50"
                  aria-label={`Deactivate ${w.name}`}
                >
                  <Power className="w-4 h-4 text-red-500" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && <WarehouseForm warehouse={editing} onClose={() => setFormOpen(false)} />}
      {treeFor && <WarehouseTreeEditor warehouse={treeFor} onClose={() => setTreeFor(null)} />}
      {/* The `key` remounts the hosted view per warehouse — without it, opening a
        * second warehouse would reuse the first one's designer / optimizer state.
        * It sits on a Fragment because the repo has no @types/react, so `key` on a
        * typed component is a tsc error. */}
      {designerFor && (
        <React.Fragment key={designerFor.id}>
          <Modal
            open
            onClose={() => setDesignerFor(null)}
            size="full"
            title="Warehouse Intelligence — Layout Designer"
          >
            <LayoutDesignerView warehouse={designerFor} autoOpenImport={designerAutoImport} />
          </Modal>
        </React.Fragment>
      )}
      {optimizeFor && (
        <React.Fragment key={optimizeFor.id}>
          <Modal
            open
            onClose={() => setOptimizeFor(null)}
            size="3xl"
            title={`Warehouse Intelligence — Optimization · ${optimizeFor.name}`}
          >
            <div className="space-y-6">
              <ScoringWeightsSection warehouse={optimizeFor} />
              <div className="border-t border-stone-100" />
              <SlottingSuggestionsView warehouse={optimizeFor} />
              <div className="border-t border-stone-100" />
              <div>
                <h4 className="mb-3 text-sm font-semibold text-stone-700">Analytics</h4>
                <WarehouseIntelligenceReport warehouseId={optimizeFor.id} />
              </div>
            </div>
          </Modal>
        </React.Fragment>
      )}
      {rulesOpen && (
        <Modal
          open
          onClose={() => setRulesOpen(false)}
          size="full"
          title="Warehouse Intelligence — Optimizer Rules"
        >
          <WarehouseIntelligenceRulesView />
        </Modal>
      )}
    </section>
  );
};

export default WarehousesSettingsSection;
