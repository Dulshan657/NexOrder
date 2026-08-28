import React, { useState } from 'react';
import type { HoReCa, User } from '../../types';
import { createScheduledVisit, createAssignedScheduledVisit } from '../../services/scheduledVisitService';
import { Plus, X, GripVertical, MapPin, Calendar, UserCheck } from 'lucide-react';

interface RouteFormProps {
  hoReCas: HoReCa[];
  userId: number;
  users?: User[];
  isAdminMode?: boolean;
  onSave: (route: ReturnType<typeof createScheduledVisit>) => void;
  onCancel: () => void;
}

const ScheduledVisitForm: React.FC<RouteFormProps> = ({ hoReCas, userId, users, isAdminMode, onSave, onCancel }) => {
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedHoReCaIds, setSelectedHoReCaIds] = useState<number[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [assignToUserId, setAssignToUserId] = useState<number | ''>('');

  const availableHoReCas = hoReCas.filter(c => !selectedHoReCaIds.includes(c.id));

  const handleAddCustomer = (hoReCaId: number) => {
    setSelectedHoReCaIds(prev => [...prev, hoReCaId]);
  };

  const handleRemoveCustomer = (hoReCaId: number) => {
    setSelectedHoReCaIds(prev => prev.filter(id => id !== hoReCaId));
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const newIds = [...selectedHoReCaIds];
    const [moved] = newIds.splice(dragIndex, 1);
    newIds.splice(index, 0, moved);
    setSelectedHoReCaIds(newIds);
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const handleSubmit = () => {
    if (!name.trim() || selectedHoReCaIds.length === 0) return;
    if (isAdminMode && assignToUserId !== '') {
      const route = createAssignedScheduledVisit(name.trim(), date, selectedHoReCaIds, assignToUserId, userId);
      onSave(route);
    } else {
      const route = createScheduledVisit(name.trim(), date, selectedHoReCaIds, userId);
      onSave(route);
    }
  };

  const customerMap = new Map<number, HoReCa>(hoReCas.map(c => [c.id, c]));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold text-stone-800">{isAdminMode ? 'Create & Assign ScheduledVisit' : 'New ScheduledVisit'}</h2>
        <button onClick={onCancel} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
          <X className="w-5 h-5 text-stone-500" />
        </button>
      </div>

      {/* Name, Date, and optional Assign To */}
      <div className={`grid grid-cols-1 ${isAdminMode ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4`}>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">ScheduledVisit Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Sydney CBD Run"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-stone-500" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
            />
          </div>
        </div>
        {isAdminMode && users && (
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Assign To</label>
            <div className="relative">
              <UserCheck className="absolute left-3 top-2.5 w-4 h-4 text-stone-500" />
              <select
                value={assignToUserId}
                onChange={e => setAssignToUserId(e.target.value ? Number(e.target.value) : '')}
                className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
              >
                <option value="">Select rep...</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Add HoReCa */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-2">Add HoReCa</label>
        {availableHoReCas.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {availableHoReCas.map(customer => (
              <button
                key={customer.id}
                onClick={() => handleAddCustomer(customer.id)}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-stone-200 hover:bg-blue-50 hover:border-blue-200 transition-colors text-left"
              >
                <Plus className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">{customer.name}</p>
                  <p className="text-xs text-stone-500 truncate">{customer.address}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-500 italic">All hoReCas added to route.</p>
        )}
      </div>

      {/* Ordered Stops (drag to reorder) */}
      {selectedHoReCaIds.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-2">
            ScheduledVisit Stops ({selectedHoReCaIds.length}) — drag to reorder
          </label>
          <div className="space-y-2">
            {selectedHoReCaIds.map((hoReCaId, index) => {
              const customer = customerMap.get(hoReCaId);
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
                  <GripVertical className="w-4 h-4 text-stone-300 flex-shrink-0" />
                  <div className="w-6 h-6 rounded-full bg-nexgen-blue text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{customer.name}</p>
                    <p className="text-xs text-stone-500 truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{customer.address}
                    </p>
                  </div>
                  <button onClick={() => handleRemoveCustomer(hoReCaId)} className="p-1 hover:bg-stone-200 rounded transition-colors">
                    <X className="w-4 h-4 text-stone-500" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
        <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || selectedHoReCaIds.length === 0}
          className="px-5 py-2 text-sm font-medium text-white bg-nexgen-blue rounded-lg hover:bg-nexgen-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create ScheduledVisit
        </button>
      </div>
    </div>
  );
};

export default ScheduledVisitForm;
