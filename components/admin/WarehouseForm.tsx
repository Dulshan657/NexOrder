import React, { useState } from 'react';
import { X, MapPin, Warehouse as WarehouseIcon } from 'lucide-react';
import WarehouseMapPicker from './WarehouseMapPicker';
import { useCreateWarehouse, useUpdateWarehouse } from '../../hooks/queries/useWarehouses';
import type { Warehouse, WarehouseType } from '../../types';

interface WarehouseFormProps {
  warehouse: Warehouse | null; // null = create
  onClose: () => void;
}

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue';

const WarehouseForm: React.FC<WarehouseFormProps> = ({ warehouse, onClose }) => {
  const isEdit = warehouse !== null;
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();

  const [code, setCode] = useState(warehouse?.code ?? '');
  const [name, setName] = useState(warehouse?.name ?? '');
  const [locationType, setLocationType] = useState<WarehouseType>(warehouse?.locationType ?? 'bulk');
  const [lat, setLat] = useState<number | undefined>(warehouse?.lat);
  const [lng, setLng] = useState<number | undefined>(warehouse?.lng);
  const [address, setAddress] = useState(warehouse?.address ?? '');
  const [contact, setContact] = useState(warehouse?.contact ?? '');
  const [hours, setHours] = useState(warehouse?.hours ?? '');
  const [notes, setNotes] = useState(warehouse?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const saving = create.isPending || update.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || (!isEdit && !code.trim())) {
      setError('Code and name are required.');
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: warehouse!.id,
          updates: {
            name: name.trim(),
            location_type: locationType,
            lat,
            lng,
            address: address.trim() || undefined,
            contact: contact.trim() || undefined,
            hours: hours.trim() || undefined,
            notes: notes.trim() || undefined,
          },
        });
      } else {
        await create.mutateAsync({
          code: code.trim(),
          name: name.trim(),
          location_type: locationType,
          lat,
          lng,
          address: address.trim() || undefined,
          contact: contact.trim() || undefined,
          hours: hours.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save warehouse.');
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-start sm:items-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-stone-200 my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-nexgen-blue/10">
              <WarehouseIcon className="w-4 h-4 text-nexgen-blue" />
            </div>
            <h2 className="text-base font-display font-bold text-stone-900">
              {isEdit ? `Edit ${warehouse!.name}` : 'New Warehouse'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100 btn-press" aria-label="Close">
            <X className="w-4 h-4 text-stone-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Code</label>
              <input
                className={inputCls}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={isEdit}
                placeholder="SYD"
                maxLength={32}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sydney DC" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Storage type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['bulk', 'racked'] as WarehouseType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setLocationType(t)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors btn-press ${
                    locationType === t
                      ? 'bg-nexgen-blue text-white border-nexgen-blue'
                      : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  {t === 'bulk' ? 'Bulk (piles, FIFO)' : 'Racked (bins/WMS)'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-400 mt-1">
              {locationType === 'bulk'
                ? 'Stock held in unorganised piles, depleted FIFO.'
                : 'Stock tracked in named bins (racked WMS features roll out in a later phase).'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> Location (click the map to set)
            </label>
            <WarehouseMapPicker lat={lat} lng={lng} onChange={(la, ln) => { setLat(la); setLng(ln); }} />
            <div className="grid grid-cols-2 gap-3 mt-2">
              <input
                className={inputCls}
                type="number"
                step="0.000001"
                value={lat ?? ''}
                onChange={(e) => setLat(e.target.value === '' ? undefined : Number(e.target.value))}
                placeholder="Latitude"
              />
              <input
                className={inputCls}
                type="number"
                step="0.000001"
                value={lng ?? ''}
                onChange={(e) => setLng(e.target.value === '' ? undefined : Number(e.target.value))}
                placeholder="Longitude"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Address</label>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Contact</label>
              <input className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Hours</label>
              <input className={inputCls} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Mon–Fri 7–4" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Notes</label>
            <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100 btn-press">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create warehouse'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WarehouseForm;
