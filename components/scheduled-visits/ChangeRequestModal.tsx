import React, { useMemo, useState } from 'react';
import type { ScheduledVisit, HoReCa, ScheduledVisitChangeRequestType } from '../../types';
import { addChangeRequest } from '../../services/scheduledVisitService';
import { ArrowUpDown, Plus, Minus, GripVertical, MapPin } from 'lucide-react';
import { Button, Modal } from '../ui';

interface ChangeRequestModalProps {
  route: ScheduledVisit;
  hoReCas: HoReCa[];
  userId: number;
  onSave: (updated: ScheduledVisit) => void;
  onClose: () => void;
}

const ChangeRequestModal: React.FC<ChangeRequestModalProps> = ({ route, hoReCas, userId, onSave, onClose }) => {
  const [type, setType] = useState<ScheduledVisitChangeRequestType>('reorder');
  const [description, setDescription] = useState('');

  // Reorder state. `initialOrder` is the dirty-guard baseline: the list is only ever
  // permuted, never grown or shrunk, so an element-wise compare is enough.
  const [initialOrder] = useState<number[]>(() => route.stops.map(s => s.hoReCaId));
  const [reorderedIds, setReorderedIds] = useState<number[]>(initialOrder);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Add stop state
  const [addHoReCaId, setAddHoReCaId] = useState<number | ''>('');

  // Remove stop state
  const [removeHoReCaId, setRemoveHoReCaId] = useState<number | ''>('');

  const hoReCaMap = new Map<number, HoReCa>(hoReCas.map(c => [c.id, c]));
  const existingIds = new Set(route.stops.map(s => s.hoReCaId));
  const availableToAdd = hoReCas.filter(c => !existingIds.has(c.id));

  // Only entered data counts as unsaved work — switching request type or holding a
  // drag is navigation, and prompting on it would be noise.
  const isDirty = useMemo(
    () =>
      description.trim() !== '' ||
      addHoReCaId !== '' ||
      removeHoReCaId !== '' ||
      reorderedIds.some((id, index) => id !== initialOrder[index]),
    [description, addHoReCaId, removeHoReCaId, reorderedIds, initialOrder],
  );

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
      scheduledVisitId: route.id,
      requestedBy: userId,
      type,
      description: description.trim(),
      payload: payload as any,
    });
    onSave(updated);
  };

  const types: Array<{ key: ScheduledVisitChangeRequestType; label: string; icon: React.ReactNode }> = [
    { key: 'reorder', label: 'Reorder Stops', icon: <ArrowUpDown className="w-4 h-4" /> },
    { key: 'add_stop', label: 'Add Stop', icon: <Plus className="w-4 h-4" /> },
    { key: 'remove_stop', label: 'Remove Stop', icon: <Minus className="w-4 h-4" /> },
  ];

  const submitDisabled =
    !description.trim() || (type === 'add_stop' && addHoReCaId === '') || (type === 'remove_stop' && removeHoReCaId === '');

  return (
    <Modal
      open
      onClose={onClose}
      dirty={isDirty}
      title="Request ScheduledVisit Change"
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitDisabled}>
            Submit Request
          </Button>
        </>
      )}
    >
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
                  <p className="text-xs text-stone-500 truncate"><MapPin className="w-3 h-3 inline mr-0.5" />{customer.address}</p>
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
            // Kept as its own scroller: this is the whole customer book, and capping it
            // keeps the required reason box in view rather than pushing it off the panel.
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
                    <p className="text-xs text-stone-500 truncate">{c.address}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500 italic">All HoReCas are already on this route.</p>
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
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Reason for change</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Explain why this change is needed..."
          rows={3}
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent resize-none"
        />
      </div>
    </Modal>
  );
};

export default ChangeRequestModal;
