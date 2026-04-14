import React, { useState, useMemo } from 'react';
import type { Visit, HoReCa, VisitOutcome } from '../../types';
import VisitCard from './VisitCard';
import VisitTimeline from './VisitTimeline';
import { History, List, GitBranch } from 'lucide-react';

interface VisitHistoryProps {
  visits: Visit[];
  hoReCas: HoReCa[];
  filterHoReCaId?: number;
  showCustomerName?: boolean;
  onClickHoReCa?: (hoReCaId: number) => void;
}

const OUTCOME_FILTERS: Array<{ value: VisitOutcome | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'order_placed', label: 'Orders' },
  { value: 'follow_up_needed', label: 'Follow Ups' },
  { value: 'not_available', label: 'Not Available' },
  { value: 'stock_check_only', label: 'Stock Checks' },
  { value: 'no_interest', label: 'No Interest' },
];

const VisitHistory: React.FC<VisitHistoryProps> = ({ visits, hoReCas, filterHoReCaId, showCustomerName = true, onClickHoReCa }) => {
  const [outcomeFilter, setOutcomeFilter] = useState<VisitOutcome | 'all'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'cards'>('timeline');

  const customerMap = new Map(hoReCas.map(c => [c.id, c]));

  const filteredVisits = useMemo(() => {
    let result = filterHoReCaId !== undefined
      ? visits.filter(v => v.hoReCaId === filterHoReCaId)
      : visits;

    if (outcomeFilter !== 'all') {
      result = result.filter(v => v.outcome === outcomeFilter);
    }

    return result.sort((a, b) => new Date(b.arrivalTime).getTime() - new Date(a.arrivalTime).getTime());
  }, [visits, filterHoReCaId, outcomeFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-stone-500" />
          <h4 className="text-sm font-semibold text-stone-700">Visit History ({filteredVisits.length})</h4>
        </div>
        {/* View toggle */}
        <div className="flex bg-stone-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('timeline')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'timeline' ? 'bg-white shadow-sm' : 'hover:bg-stone-200'}`}
            title="Timeline view"
          >
            <GitBranch className="w-3.5 h-3.5 text-stone-600" />
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-white shadow-sm' : 'hover:bg-stone-200'}`}
            title="Card view"
          >
            <List className="w-3.5 h-3.5 text-stone-600" />
          </button>
        </div>
      </div>

      {/* Outcome Filter */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
        {OUTCOME_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setOutcomeFilter(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors btn-press ${
              outcomeFilter === f.value
                ? 'bg-nexgen-blue text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filteredVisits.length > 0 ? (
        viewMode === 'timeline' ? (
          <VisitTimeline visits={filteredVisits} hoReCas={hoReCas} onClickHoReCa={onClickHoReCa} />
        ) : (
          <div className="space-y-2">
            {filteredVisits.map(visit => (
              <VisitCard
                key={visit.id}
                visit={visit}
                customer={customerMap.get(visit.hoReCaId)}
                showCustomerName={showCustomerName}
              />
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-stone-500 italic py-4 text-center">No visits recorded yet.</p>
      )}
    </div>
  );
};

export default VisitHistory;
