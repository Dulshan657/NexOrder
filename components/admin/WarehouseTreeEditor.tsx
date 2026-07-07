import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Power, ChevronRight, ChevronDown, Boxes } from 'lucide-react';
import {
  useWarehouseLocations,
  useCreateWarehouseLocation,
  useDeactivateWarehouseLocation,
} from '../../hooks/queries/useWarehouseLocations';
import type { InventoryLocation, LocationKind, Warehouse } from '../../types';

// The classic tree editor only manages these three kinds; the WIE designer owns
// the richer hierarchy (AISLE/RACK/BAY/STAGING).
type NodeKind = 'ZONE' | 'BIN' | 'SHELF';

interface WarehouseTreeEditorProps {
  warehouse: Warehouse;
  onClose: () => void;
}

interface AddFormState {
  parentId: number;
  kind: NodeKind;
  code: string;
  name: string;
  capacity: string;
}

const KIND_LABEL: Record<NodeKind, string> = { ZONE: 'Zone', BIN: 'Bin', SHELF: 'Shelf' };

const WarehouseTreeEditor: React.FC<WarehouseTreeEditorProps> = ({ warehouse, onClose }) => {
  const { data: locations, isLoading } = useWarehouseLocations(warehouse.id);
  const create = useCreateWarehouseLocation(warehouse.id);
  const deactivate = useDeactivateWarehouseLocation(warehouse.id);

  const [expanded, setExpanded] = useState<Set<number>>(new Set([warehouse.id]));
  const [addForm, setAddForm] = useState<AddFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build adjacency: parentId -> children (active + inactive).
  const childrenByParent = useMemo(() => {
    const m = new Map<number, InventoryLocation[]>();
    for (const loc of locations ?? []) {
      const pid = loc.parentId ?? warehouse.id;
      const arr = m.get(pid) ?? [];
      arr.push(loc);
      m.set(pid, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [locations, warehouse.id]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const submitAdd = async () => {
    if (!addForm) return;
    setError(null);
    if (!addForm.code.trim() || !addForm.name.trim()) {
      setError('Code and name are required.');
      return;
    }
    try {
      await create.mutateAsync({
        parent_id: addForm.parentId,
        kind: addForm.kind,
        code: addForm.code.trim(),
        name: addForm.name.trim(),
        capacity_slots: addForm.capacity ? Number(addForm.capacity) : undefined,
      });
      setExpanded((p) => new Set(p).add(addForm.parentId));
      setAddForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add location.');
    }
  };

  const renderNode = (loc: InventoryLocation, depth: number): React.ReactNode => {
    const kids = childrenByParent.get(loc.id) ?? [];
    const isOpen = expanded.has(loc.id);
    return (
      <div key={loc.id}>
        <div
          className={`flex items-center gap-2 py-2 pr-2 rounded-lg hover:bg-stone-50 ${loc.isActive ? '' : 'opacity-50'}`}
          style={{ paddingLeft: `${depth * 18 + 4}px` }}
        >
          <button onClick={() => toggle(loc.id)} className="p-0.5 text-stone-400" aria-label="Toggle">
            {kids.length > 0 ? (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4 inline-block" />}
          </button>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{KIND_LABEL[loc.kind as NodeKind] ?? loc.kind}</span>
          <span className="text-sm text-stone-800 truncate">{loc.name}</span>
          <span className="text-[11px] font-mono text-stone-400">{loc.code}</span>
          {typeof loc.capacitySlots === 'number' && (
            <span className="text-[10px] text-stone-400">· cap {loc.capacitySlots}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setAddForm({ parentId: loc.id, kind: 'BIN', code: '', name: '', capacity: '' })}
              className="p-1 rounded hover:bg-stone-200 text-stone-500" aria-label="Add child"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {loc.isActive && (
              <button
                onClick={() => deactivate.mutate(loc.id)}
                className="p-1 rounded hover:bg-red-50 text-red-500" aria-label="Deactivate"
              >
                <Power className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {addForm?.parentId === loc.id && (
          <div className="flex flex-wrap items-center gap-2 py-2" style={{ paddingLeft: `${(depth + 1) * 18 + 8}px` }}>
            <select value={addForm.kind} onChange={(e) => setAddForm({ ...addForm, kind: e.target.value as NodeKind })} className="text-xs border border-stone-200 rounded px-2 py-1">
              {(['ZONE', 'BIN', 'SHELF'] as NodeKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <input value={addForm.code} onChange={(e) => setAddForm({ ...addForm, code: e.target.value.toUpperCase() })} placeholder="Code (A-12)" className="text-xs border border-stone-200 rounded px-2 py-1 w-24" />
            <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Name" className="text-xs border border-stone-200 rounded px-2 py-1 w-32" />
            <input value={addForm.capacity} onChange={(e) => setAddForm({ ...addForm, capacity: e.target.value })} placeholder="Cap." type="number" className="text-xs border border-stone-200 rounded px-2 py-1 w-16" />
            <button onClick={submitAdd} disabled={create.isPending} className="text-xs font-semibold px-2 py-1 rounded bg-nexgen-blue text-white">Add</button>
            <button onClick={() => setAddForm(null)} className="text-xs text-stone-500 px-1">Cancel</button>
          </div>
        )}
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const rootKids = childrenByParent.get(warehouse.id) ?? [];

  return createPortal(
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-start sm:items-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-stone-200 my-8 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-violet-50"><Boxes className="w-4 h-4 text-violet-600" /></div>
            <div>
              <h2 className="text-base font-display font-bold text-stone-900">{warehouse.name} — storage layout</h2>
              <p className="text-xs text-stone-500">Build zones, bins and shelves. Click + on a node to add a child.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100" aria-label="Close"><X className="w-4 h-4 text-stone-500" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-stone-700">Root</p>
            <button
              onClick={() => setAddForm({ parentId: warehouse.id, kind: 'ZONE', code: '', name: '', capacity: '' })}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-nexgen-blue text-white"
            >
              <Plus className="w-3.5 h-3.5" /> Add top-level
            </button>
          </div>

          {addForm?.parentId === warehouse.id && (
            <div className="flex flex-wrap items-center gap-2 py-2 mb-2 border-b border-stone-100">
              <select value={addForm.kind} onChange={(e) => setAddForm({ ...addForm, kind: e.target.value as NodeKind })} className="text-xs border border-stone-200 rounded px-2 py-1">
                {(['ZONE', 'BIN', 'SHELF'] as NodeKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <input value={addForm.code} onChange={(e) => setAddForm({ ...addForm, code: e.target.value.toUpperCase() })} placeholder="Code" className="text-xs border border-stone-200 rounded px-2 py-1 w-24" />
              <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Name" className="text-xs border border-stone-200 rounded px-2 py-1 w-32" />
              <input value={addForm.capacity} onChange={(e) => setAddForm({ ...addForm, capacity: e.target.value })} placeholder="Cap." type="number" className="text-xs border border-stone-200 rounded px-2 py-1 w-16" />
              <button onClick={submitAdd} disabled={create.isPending} className="text-xs font-semibold px-2 py-1 rounded bg-nexgen-blue text-white">Add</button>
              <button onClick={() => setAddForm(null)} className="text-xs text-stone-500 px-1">Cancel</button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-stone-100 animate-pulse" />)}</div>
          ) : rootKids.length === 0 ? (
            <p className="text-sm text-stone-500 py-6 text-center">No storage locations yet. Add a top-level zone or bin.</p>
          ) : (
            <div>{rootKids.map((k) => renderNode(k, 0))}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default WarehouseTreeEditor;
