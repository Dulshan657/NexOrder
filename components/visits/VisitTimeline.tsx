import React, { useState, useMemo } from 'react';
import type { Visit, HoReCa } from '../../types';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';

interface VisitTimelineProps {
  visits: Visit[];
  hoReCas: HoReCa[];
  onClickHoReCa?: (hoReCaId: number) => void;
}

const OUTCOME_COLORS: Record<string, { dot: string; badge: string; label: string }> = {
  order_placed: { dot: 'bg-emerald-500', badge: 'text-emerald-700 bg-emerald-50', label: 'Order Placed' },
  follow_up_needed: { dot: 'bg-amber-500', badge: 'text-amber-700 bg-amber-50', label: 'Follow Up' },
  not_available: { dot: 'bg-stone-400', badge: 'text-stone-600 bg-stone-100', label: 'Not Available' },
  no_interest: { dot: 'bg-red-400', badge: 'text-red-600 bg-red-50', label: 'No Interest' },
  stock_check_only: { dot: 'bg-blue-500', badge: 'text-blue-700 bg-blue-50', label: 'Stock Check' },
};

const VisitTimeline: React.FC<VisitTimelineProps> = ({ visits, hoReCas, onClickHoReCa }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const customerMap = useMemo(() => new Map(hoReCas.map(c => [c.id, c] as const)), [hoReCas]);

  const grouped = useMemo(() => {
    const map = new Map<string, Visit[]>();
    const sorted = [...visits].sort((a, b) => new Date(b.arrivalTime).getTime() - new Date(a.arrivalTime).getTime());
    for (const v of sorted) {
      const dateKey = new Date(v.arrivalTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(v);
    }
    return map;
  }, [visits]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (visits.length === 0) {
    return <p className="text-sm text-stone-500 italic py-4 text-center">No visits recorded yet.</p>;
  }

  return (
    <div className="relative pl-8">
      {/* Vertical timeline line */}
      <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-stone-200" />

      {Array.from(grouped.entries()).map(([dateLabel, dateVisits]) => (
        <div key={dateLabel} className="mb-6 last:mb-0">
          {/* Date header */}
          <div className="relative flex items-center gap-3 mb-3">
            <div className="absolute -left-8 w-8 h-8 rounded-full bg-white border-2 border-stone-300 flex items-center justify-center z-10">
              <span className="text-[10px] font-bold text-stone-500">{dateVisits.length}</span>
            </div>
            <span className="text-sm font-semibold text-stone-700 tracking-tight">{dateLabel}</span>
          </div>

          {/* Visit entries */}
          <div className="space-y-2">
            {dateVisits.map(visit => {
              const customer = customerMap.get(visit.hoReCaId);
              const outcome = visit.outcome ? OUTCOME_COLORS[visit.outcome] : null;
              const isExpanded = expandedIds.has(visit.id);
              const time = new Date(visit.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <div key={visit.id} className="relative">
                  {/* Timeline dot */}
                  <div className={`absolute -left-[21.5px] top-3.5 w-2.5 h-2.5 rounded-full border-2 border-white z-10 ${outcome?.dot ?? 'bg-stone-300'}`} style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }} />

                  {/* Entry card */}
                  <button
                    onClick={() => toggleExpand(visit.id)}
                    className="w-full text-left bg-white rounded-xl border border-stone-200/60 p-3 hover:shadow-card-hover transition-shadow cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {customer && (
                          <span
                            onClick={(e) => { if (onClickHoReCa) { e.stopPropagation(); onClickHoReCa(visit.hoReCaId); } }}
                            className={`text-sm font-semibold ${onClickHoReCa ? 'text-nexgen-blue hover:underline cursor-pointer' : 'text-stone-900'}`}
                          >
                            {customer.name}
                          </span>
                        )}
                        <span className="text-xs text-stone-400 tabular-nums ml-2">{time}</span>
                        {visit.notes && (
                          <p className="text-sm text-stone-600 line-clamp-2 mt-1">{visit.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {outcome && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${outcome.badge}`}>
                            {outcome.label}
                          </span>
                        )}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-stone-100 space-y-2 text-sm">
                        {visit.competitorNotes && (
                          <div>
                            <span className="text-xs font-medium text-stone-500">Competitor notes</span>
                            <p className="text-stone-600">{visit.competitorNotes}</p>
                          </div>
                        )}
                        {visit.stockCheckNotes && (
                          <div>
                            <span className="text-xs font-medium text-stone-500">Stock check</span>
                            <p className="text-stone-600">{visit.stockCheckNotes}</p>
                          </div>
                        )}
                        {visit.nextVisitRecommendation && (
                          <div className="flex items-center gap-1.5 text-stone-600">
                            <MapPin className="w-3 h-3 text-stone-400 flex-shrink-0" />
                            <span className="text-xs">Next: {visit.nextVisitRecommendation}</span>
                          </div>
                        )}
                        {visit.photos && visit.photos.length > 0 && (
                          <div className="flex gap-2 pt-1">
                            {visit.photos.slice(0, 3).map((p, i) => (
                              <img key={i} src={p} alt="" className="w-12 h-12 rounded-lg object-cover border border-stone-200" />
                            ))}
                            {visit.photos.length > 3 && (
                              <span className="w-12 h-12 rounded-lg bg-stone-100 flex items-center justify-center text-xs text-stone-500 font-medium">
                                +{visit.photos.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VisitTimeline;
