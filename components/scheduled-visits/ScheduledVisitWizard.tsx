import React, { useState, useMemo } from 'react';
import type { HoReCa, User } from '../../types';
import { createScheduledVisit, createAssignedScheduledVisit } from '../../services/scheduledVisitService';
import { Check, MapPin, Calendar, UserCheck, Search, ArrowRight, ArrowLeft } from 'lucide-react';
import DraggableStopList from './DraggableStopList';

interface RouteWizardProps {
  hoReCas: HoReCa[];
  userId: number;
  users?: User[];
  isAdminMode?: boolean;
  onSave: (route: ReturnType<typeof createScheduledVisit>) => void;
  onCancel: () => void;
}

const STEPS = [
  { num: 1, label: 'Details' },
  { num: 2, label: 'Stops' },
  { num: 3, label: 'Confirm' },
];

const ScheduledVisitWizard: React.FC<RouteWizardProps> = ({ hoReCas, userId, users, isAdminMode, onSave, onCancel }) => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedHoReCaIds, setSelectedHoReCaIds] = useState<number[]>([]);
  const [assignToUserId, setAssignToUserId] = useState<number | ''>('');
  const [searchQuery, setSearchQuery] = useState('');

  const hoReCaMap = useMemo(() => new Map(hoReCas.map(c => [c.id, c] as const)), [hoReCas]);

  const availableHoReCas = useMemo(() => {
    const filtered = hoReCas.filter(c => !selectedHoReCaIds.includes(c.id));
    if (!searchQuery.trim()) return filtered;
    const lower = searchQuery.toLowerCase();
    return filtered.filter(c => c.name.toLowerCase().includes(lower) || (c.address ?? '').toLowerCase().includes(lower));
  }, [hoReCas, selectedHoReCaIds, searchQuery]);

  const canNext = step === 1 ? name.trim().length > 0 : step === 2 ? selectedHoReCaIds.length > 0 : true;
  const totalSteps = STEPS.length;

  const handleSubmit = () => {
    if (!name.trim() || selectedHoReCaIds.length === 0) return;
    if (isAdminMode && assignToUserId !== '') {
      onSave(createAssignedScheduledVisit(name.trim(), date, selectedHoReCaIds, assignToUserId as number, userId));
    } else {
      onSave(createScheduledVisit(name.trim(), date, selectedHoReCaIds, userId));
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-card border border-stone-200/60 overflow-hidden">
      {/* Step indicator */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.num}>
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  step > s.num ? 'bg-emerald-500 text-white' :
                  step === s.num ? 'bg-nexgen-blue text-white' :
                  'bg-stone-200 text-stone-500'
                }`}>
                  {step > s.num ? <Check className="w-4 h-4" /> : s.num}
                </div>
                <span className={`text-xs font-medium ${step >= s.num ? 'text-stone-700' : 'text-stone-500'}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-5 ${step > s.num ? 'bg-emerald-500' : 'bg-stone-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="px-6 pb-6 min-h-[300px]">
        {/* Step 1: Name & Date */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">ScheduledVisit name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Monday CBD ScheduledVisit"
                className="w-full px-4 py-3 rounded-lg border-0 bg-stone-50 ring-1 ring-inset ring-stone-200 text-stone-900 focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-lg border-0 bg-stone-50 ring-1 ring-inset ring-stone-200 text-stone-900 focus:ring-2 focus:ring-nexgen-blue text-sm"
                />
              </div>
            </div>
            {isAdminMode && users && (
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><UserCheck className="w-4 h-4" /> Assign to rep</span>
                </label>
                <select
                  value={assignToUserId}
                  onChange={e => setAssignToUserId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-3 rounded-lg border-0 bg-stone-50 ring-1 ring-inset ring-stone-200 text-stone-900 focus:ring-2 focus:ring-nexgen-blue text-sm"
                >
                  <option value="">Self (no assignment)</option>
                  {users.filter(u => u.role === 'Field Rep').map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Add Stops & Reorder (combined) */}
        {step === 2 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left: search and add */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Search & add stops</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search HoReCa..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border-0 bg-stone-50 ring-1 ring-inset ring-stone-200 text-stone-900 focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400 text-sm"
                />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1 border border-stone-200 rounded-xl p-2">
                {availableHoReCas.length === 0 ? (
                  <p className="text-sm text-stone-500 text-center py-4">No matching HoReCa found</p>
                ) : (
                  availableHoReCas.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedHoReCaIds(prev => [...prev, c.id])}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{c.name}</p>
                        {c.address && <p className="text-xs text-stone-500 truncate">{c.address}</p>}
                      </div>
                      <span className="text-nexgen-blue text-xs font-medium flex-shrink-0 ml-2">Add</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: selected stops with drag reorder */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                ScheduledVisit order ({selectedHoReCaIds.length} stop{selectedHoReCaIds.length !== 1 ? 's' : ''}) — drag to reorder
              </p>
              <DraggableStopList
                hoReCaIds={selectedHoReCaIds}
                hoReCaMap={hoReCaMap}
                onReorder={setSelectedHoReCaIds}
                onRemove={(id) => setSelectedHoReCaIds(prev => prev.filter(i => i !== id))}
              />
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-stone-50 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-stone-500">ScheduledVisit name</span>
                <span className="text-sm font-semibold text-stone-900">{name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-stone-500">Date</span>
                <span className="text-sm font-medium text-stone-700">{new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-stone-500">Stops</span>
                <span className="text-sm font-medium text-stone-700">{selectedHoReCaIds.length}</span>
              </div>
              {isAdminMode && assignToUserId !== '' && users && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-500">Assigned to</span>
                  <span className="text-sm font-medium text-teal-700">{users.find(u => u.id === assignToUserId)?.name ?? 'Unknown'}</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Stop sequence</p>
              {selectedHoReCaIds.map((id, i) => {
                const c = hoReCaMap.get(id);
                return c ? (
                  <div key={id} className="flex items-center gap-2 text-sm py-1.5">
                    <span className="w-6 h-6 rounded-full bg-nexgen-blue text-white flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                    <span className="text-stone-700">{c.name}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-between bg-stone-50/30">
        <button
          onClick={step === 1 ? onCancel : () => setStep(s => s - 1)}
          className="flex items-center gap-1 text-sm font-medium text-stone-600 hover:text-stone-900 px-4 py-2 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < totalSteps ? (
          <button
            disabled={!canNext}
            onClick={() => setStep(s => s + 1)}
            className="flex items-center gap-1 text-sm font-medium text-white bg-nexgen-blue px-5 py-2 rounded-lg hover:bg-nexgen-blue-dark disabled:opacity-40 disabled:cursor-not-allowed btn-press cursor-pointer"
          >
            Next
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1 text-sm font-medium text-white bg-emerald-600 px-5 py-2 rounded-lg hover:bg-emerald-700 btn-press cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Create ScheduledVisit
          </button>
        )}
      </div>
    </div>
  );
};

export default ScheduledVisitWizard;
