import React, { useState } from 'react';
import type { Route, HoReCa, RouteChangeRequestType } from '../../types';
import { addChangeRequest } from '../../services/routeService';
import { X, ArrowUpDown, Plus, Minus, GripVertical, MapPin } from 'lucide-react';

interface ChangeRequestModalProps {
  route: Route;
  hoReCas: HoReCa[];
  userId: number;
  onSave: (updated: Route) => void;
  onClose: () => void;
}

const ChangeRequestModal: React.FC<ChangeRequestModalProps> = ({ route, hoReCas, userId, onSave, onClose }) => {
  const [type, setType] = useState<RouteChangeRequestType>('reorder');
  const [description, setDescription] = useState('');

  // Reorder state
  const [reorderedIds, setReorderedIds] = useState<number[]>(route.stops.map(s => s.hoReCaId));
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Add stop state
  const [addHoReCaId, setAddHoReCaId] = useState<number | ''>('');

  // Remove stop state
  const [removeHoReCaId, setRemoveHoReCaId] = useState<number | ''>('');

  const hoReCaMap = new Map(hoReCas.map(c => [c.id, c]));
  const existingIds = new Set(route.stops.map(s => s.hoReCaId));
  const availableToAdd = hoReCas.filter(c => !existingIds.has(c.id));

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const newIds = [...reorderedIds];
    const [moved] = newIds.splice(dragIndex, 1);
    newIds.splice(index, 0, moved);
    setReorderedIds(newIds);
    setDragIndex(index);
  };
  const handleDragEnd = () => setDragIndex(null);

  const handleSubmit = () => {
    if (!description.trim()) return;

    let payload: Record<string, unknown>;
    if (type === 'reorder') {
      payload = { newStopOrder: reorderedIds };
    } else if (type === 'add_stop') {
      if (addHoReCaId === '') return;
      payload = { hoReCaId: addHoReCaId };
    } else {
      if (removeHoReCaId === '') return;
      payload = { hoReCaId: removeHoReCaId };
    }

    const updated = addChangeRequest(route, {
      routeId: route.id,
      requestedBy: userId,
      type,
      description: description.trim(),
      payload: payload as any,
    });
    onSave(updated);
  };

  const types: Array<{ key: RouteChangeRequestType; label: string; icon: React.ReactNode }> = [
    { key: 'reorder', label: 'Reorder Stops', icon: <ArrowUpDown className="w-4 h-4" /> },
    { key: 'add_stop', label: 'Add Stop', icon: <Plus className="w-4 h-4" /> },
    { key: 'remove_stop', label: 'Remove Stop', icon: <Minus className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-bold text-stone-800">Request Route Change</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>

        {/* Type selector */}
        <div className="flex gap-2 mb-5">
          {types.map(t => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border transition-colors ${
                type === t.key ? 'bg-nexgen-blue text-white border-nexgen-blue' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Type-specific content */}
        {type === 'reorder' && (
          <div className="space-y-2 mb-5">
            <label className="block text-sm font-medium text-stone-700 mb-1">Drag to reorder:</label>
            {reorderedIds.map((hoReCaId, index) => {
              const customer = hoReCaMap.get(hoReCaId);
              if (!customer) return null;
              return (
                <div
                  key={hoReCaId}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={e => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    dragIndex === index ? 'border-blue-300 bg-blue-50' : 'border-stone-200 bg-stone-50'
                  } cursor-grab active:cursor-grabbing`}
                >
                  <GripVertical className="w-4 h-4 text-stone-300" />
                  <div className="w-6 h-6 rounded-full bg-nexgen-blue text-white flex items-center justify-center text-xs font-bold">{index + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{customer.name}</p>
                    <p className="text-xs text-stone-400 truncate"><MapPin className="w-3 h-3 inline mr-0.5" />{customer.address}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {type === 'add_stop' && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-stone-700 mb-1">Select HoReCa to add:</label>
            {availableToAdd.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                {availableToAdd.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setAddHoReCaId(c.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors ${
                      addHoReCaId === c.id ? 'border-blue-400 bg-blue-50' : 'border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <Plus className="w-4 h-4 text-blue-500" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{c.name}</p>
                      <p className="text-xs text-stone-400 truncate">{c.address}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400 italic">All HoReCas are already on this route.</p>
            )}
          </div>
        )}

        {type === 'remove_stop' && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-stone-700 mb-1">Select stop to remove:</label>
            <div className="space-y-2">
              {route.stops.map(s => {
                const customer = hoReCaMap.get(s.hoReCaId);
                if (!customer) return null;
                return (
                  <button
                    key={s.hoReCaId}
                    onClick={() => setRemoveHoReCaId(s.hoReCaId)}
                    className={`flex items-center gap-2 w-full p-2.5 rounded-lg border text-left transition-colors ${
                      removeHoReCaId === s.hoReCaId ? 'border-red-400 bg-red-50' : 'border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <Minus className="w-4 h-4 text-red-500" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{customer.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Reason */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-stone-700 mb-1">Reason for change</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Explain why this change is needed..."
            rows={3}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent resize-none"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!description.trim() || (type === 'add_stop' && addHoReCaId === '') || (type === 'remove_stop' && removeHoReCaId === '')}
            className="px-5 py-2 text-sm font-medium text-white bg-nexgen-blue rounded-lg hover:bg-nexgen-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit Request
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangeRequestModal;
