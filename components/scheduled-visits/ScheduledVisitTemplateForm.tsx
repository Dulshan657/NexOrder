import React, { useState } from 'react';
import type { HoReCa, User, RecurrenceRule } from '../../types';
import { UserRole } from '../../types';
import { createScheduledVisitTemplate } from '../../services/scheduledVisitService';
import { Plus, X, GripVertical, MapPin, Repeat, UserCheck } from 'lucide-react';

interface RouteTemplateFormProps {
  hoReCas: HoReCa[];
  users: User[];
  currentUser: User;
  onSave: (template: ReturnType<typeof createScheduledVisitTemplate>) => void;
  onCancel: () => void;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ScheduledVisitTemplateForm: React.FC<RouteTemplateFormProps> = ({ hoReCas, users, currentUser, onSave, onCancel }) => {
  const [name, setName] = useState('');
  const [selectedHoReCaIds, setSelectedHoReCaIds] = useState<number[]>([]);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly'>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [assignedTo, setAssignedTo] = useState<number | ''>('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const reps = users.filter(u => u.role === UserRole.FIELD_REP);
  const availableHoReCas = hoReCas.filter(c => !selectedHoReCaIds.includes(c.id));
  const customerMap = new Map(hoReCas.map(c => [c.id, c]));

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const newIds = [...selectedHoReCaIds];
    const [moved] = newIds.splice(dragIndex, 1);
    newIds.splice(index, 0, moved);
    setSelectedHoReCaIds(newIds);
    setDragIndex(index);
  };
  const handleDragEnd = () => setDragIndex(null);

  const handleSubmit = () => {
    if (!name.trim() || selectedHoReCaIds.length === 0 || assignedTo === '') return;
    const recurrence: RecurrenceRule = { frequency, dayOfWeek };
    const template = createScheduledVisitTemplate(name.trim(), selectedHoReCaIds, recurrence, assignedTo, currentUser.id);
    onSave(template);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold text-stone-800">New ScheduledVisit Template</h2>
        <button onClick={onCancel} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
          <X className="w-5 h-5 text-stone-400" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Template Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Weekly Sydney CBD"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Assign To</label>
          <div className="relative">
            <UserCheck className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
            <select
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value ? Number(e.target.value) : '')}
              className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
            >
              <option value="">Select rep...</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Recurrence */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            <Repeat className="w-3.5 h-3.5 inline mr-1" />Frequency
          </label>
          <select
            value={frequency}
            onChange={e => setFrequency(e.target.value as 'weekly' | 'biweekly')}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-Weekly</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Day of Week</label>
          <select
            value={dayOfWeek}
            onChange={e => setDayOfWeek(Number(e.target.value))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
          >
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Add HoReCa */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-2">Add HoReCa</label>
        {availableHoReCas.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {availableHoReCas.map(customer => (
              <button
                key={customer.id}
                onClick={() => setSelectedHoReCaIds(prev => [...prev, customer.id])}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-stone-200 hover:bg-blue-50 hover:border-blue-200 transition-colors text-left"
              >
                <Plus className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">{customer.name}</p>
                  <p className="text-xs text-stone-400 truncate">{customer.address}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-400 italic">All hoReCas added.</p>
        )}
      </div>

      {/* Ordered Stops */}
      {selectedHoReCaIds.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-2">
            Template Stops ({selectedHoReCaIds.length}) — drag to reorder
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
                    <p className="text-xs text-stone-400 truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{customer.address}
                    </p>
                  </div>
                  <button onClick={() => setSelectedHoReCaIds(prev => prev.filter(id => id !== hoReCaId))} className="p-1 hover:bg-stone-200 rounded transition-colors">
                    <X className="w-4 h-4 text-stone-400" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
        <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || selectedHoReCaIds.length === 0 || assignedTo === ''}
          className="px-5 py-2 text-sm font-medium text-white bg-nexgen-blue rounded-lg hover:bg-nexgen-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Template
        </button>
      </div>
    </div>
  );
};

export default ScheduledVisitTemplateForm;
