import React, { useState } from 'react';
import type { Visit, VisitOutcome, HoReCa } from '../../types';
import PhotoUpload from './PhotoUpload';
import { X, Clock, CheckCircle2, AlertCircle, UserX, Search, ShoppingCart } from 'lucide-react';

interface VisitModalProps {
  hoReCaId: number;
  userId: number;
  routeId?: string;
  hoReCas: HoReCa[];
  onSave: (visit: Visit) => void;
  onClose: () => void;
}

const OUTCOMES: Array<{ value: VisitOutcome; label: string; icon: React.ReactNode; color: string }> = [
  { value: 'order_placed', label: 'Order Placed', icon: <ShoppingCart className="w-4 h-4" />, color: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
  { value: 'follow_up_needed', label: 'Follow Up Needed', icon: <AlertCircle className="w-4 h-4" />, color: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { value: 'not_available', label: 'Not Available', icon: <UserX className="w-4 h-4" />, color: 'border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100' },
  { value: 'no_interest', label: 'No Interest', icon: <X className="w-4 h-4" />, color: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' },
  { value: 'stock_check_only', label: 'Stock Check Only', icon: <Search className="w-4 h-4" />, color: 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100' },
];

const VisitModal: React.FC<VisitModalProps> = ({ hoReCaId, userId, routeId, hoReCas, onSave, onClose }) => {
  const [outcome, setOutcome] = useState<VisitOutcome | undefined>();
  const [notes, setNotes] = useState('');
  const [competitorNotes, setCompetitorNotes] = useState('');
  const [stockCheckNotes, setStockCheckNotes] = useState('');
  const [nextVisitRecommendation, setNextVisitRecommendation] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [arrivalTime] = useState(new Date().toISOString());

  const customer = hoReCas.find(c => c.id === hoReCaId);

  const handleSave = () => {
    const visit: Visit = {
      id: `VISIT-${Date.now()}`,
      hoReCaId,
      userId,
      routeId,
      arrivalTime,
      departureTime: new Date().toISOString(),
      outcome,
      notes: notes.trim() || undefined,
      competitorNotes: competitorNotes.trim() || undefined,
      stockCheckNotes: stockCheckNotes.trim() || undefined,
      nextVisitRecommendation: nextVisitRecommendation.trim() || undefined,
      photos,
      createdAt: new Date().toISOString(),
    };
    onSave(visit);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-elevated w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-stone-200 p-5 rounded-t-2xl flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-display font-bold text-stone-800">Visit Report</h2>
            {customer && <p className="text-sm text-stone-500">{customer.name}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Check-in time */}
          <div className="flex items-center gap-2 text-sm text-stone-600 bg-emerald-50/60 border border-emerald-100 p-3 rounded-lg">
            <Clock className="w-4 h-4 text-emerald-500" />
            <span>Checked in at {new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          {/* Outcome */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Visit Outcome</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {OUTCOMES.map(o => (
                <button
                  key={o.value}
                  onClick={() => setOutcome(o.value)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm font-medium btn-press cursor-pointer ${
                    outcome === o.value ? `ring-2 ring-offset-1 ring-stone-400 ${o.color}` : `border-stone-200 text-stone-600 hover:bg-stone-50`
                  }`}
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="General visit notes..."
              rows={3}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent resize-none"
            />
          </div>

          {/* Competitor Notes */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Competitor Observations</label>
            <textarea
              value={competitorNotes}
              onChange={e => setCompetitorNotes(e.target.value)}
              placeholder="Competitor products spotted, pricing info..."
              rows={2}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent resize-none"
            />
          </div>

          {/* Stock Check Notes */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Stock Check</label>
            <textarea
              value={stockCheckNotes}
              onChange={e => setStockCheckNotes(e.target.value)}
              placeholder="HoReCa stock levels, items running low..."
              rows={2}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent resize-none"
            />
          </div>

          {/* Next Visit */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Next Visit Recommendation</label>
            <input
              type="text"
              value={nextVisitRecommendation}
              onChange={e => setNextVisitRecommendation(e.target.value)}
              placeholder="e.g. Follow up in 1 week about new range"
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-nexgen-blue focus:border-transparent"
            />
          </div>

          {/* Photos */}
          <PhotoUpload photos={photos} onPhotosChange={setPhotos} />
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-stone-200 p-5 rounded-b-2xl flex justify-end gap-3" style={{ boxShadow: '0 -1px 3px rgba(0,0,0,0.05)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-5 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            Check Out & Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default VisitModal;
