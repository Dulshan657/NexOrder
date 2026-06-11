import React, { useState } from 'react';
import { Warehouse as WarehouseIcon, Plus, Pencil, Power, MapPin } from 'lucide-react';
import { useWarehouses, useDeactivateWarehouse } from '../../hooks/queries/useWarehouses';
import WarehouseForm from './WarehouseForm';
import type { Warehouse } from '../../types';

/** Admin warehouse management — create / edit / deactivate any number of
 * warehouses, each bulk or racked, with map-picked coordinates used for
 * closest-warehouse order routing. Rendered as a section in Settings. */
const WarehousesSettingsSection: React.FC = () => {
  const { data: warehouses, isLoading, isError } = useWarehouses();
  const deactivate = useDeactivateWarehouse();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (w: Warehouse) => { setEditing(w); setFormOpen(true); };

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
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
        >
          <Plus className="w-4 h-4" /> Add warehouse
        </button>
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
    </section>
  );
};

export default WarehousesSettingsSection;
