import React, { useState, useMemo } from 'react';
import type { ScheduledVisit, HoReCa, User, Visit, MockRepPosition, VisitOutcome } from '../../types';
import { ArrowLeft, CheckCircle2, XCircle, Clock, MapPin, Activity, ChevronDown, ChevronUp, Navigation, Image } from 'lucide-react';
import VisitPhotoStrip from '../visits/VisitPhotoStrip';

interface RouteTrackingDetailProps {
  route: ScheduledVisit;
  hoReCas: HoReCa[];
  users: User[];
  visits: Visit[];
  repPosition: MockRepPosition | null;
  elapsedMinutes: number;
  onBack: () => void;
}

const TRAVEL_MIN = 15;
const DWELL_MIN = 10;

const OUTCOME_STYLES: Record<string, { label: string; color: string }> = {
  order_placed: { label: 'Order Placed', color: 'text-emerald-700 bg-emerald-50' },
  follow_up_needed: { label: 'Follow Up', color: 'text-amber-700 bg-amber-50' },
  not_available: { label: 'Not Available', color: 'text-stone-600 bg-stone-100' },
  no_interest: { label: 'No Interest', color: 'text-red-600 bg-red-50' },
  stock_check_only: { label: 'Stock Check', color: 'text-blue-700 bg-blue-50' },
};

interface ActivityEvent {
  id: string;
  minuteMark: number;
  type: 'travel' | 'arrive' | 'complete' | 'skip';
  message: string;
  dotColor: string;
}

const ScheduledVisitTrackingDetail: React.FC<RouteTrackingDetailProps> = ({ route, hoReCas, users, visits, repPosition, elapsedMinutes, onBack }) => {
  const [expandedStopIdx, setExpandedStopIdx] = useState<number | null>(null);

  const hoReCaMap = useMemo(() => new Map(hoReCas.map(h => [h.id, h] as const)), [hoReCas]);
  const visitMap = useMemo(() => new Map(visits.map(v => [v.id, v] as const)), [visits]);
  const rep = useMemo(() => users.find(u => u.id === (route.assignedTo ?? route.createdBy)), [users, route]);

  const completedStops = route.stops.filter(s => s.status !== 'pending').length;
  const totalStops = route.stops.length;

  const stopsWithContext = useMemo(() =>
    route.stops.map(stop => ({
      ...stop,
      hoReCa: hoReCaMap.get(stop.hoReCaId),
      visit: stop.visitId ? visitMap.get(stop.visitId) : undefined,
    })),
    [route.stops, hoReCaMap, visitMap]
  );

  // Generate activity feed events based on elapsed time simulation
  const activityEvents = useMemo(() => {
    const events: ActivityEvent[] = [];

    route.stops.forEach((stop, i) => {
      const hoReCa = hoReCaMap.get(stop.hoReCaId);
      const name = hoReCa?.name ?? `Stop ${i + 1}`;
      const arrivalMin = i * (TRAVEL_MIN + DWELL_MIN);

      // Traveling event
      if (i > 0 && elapsedMinutes >= (i - 1) * (TRAVEL_MIN + DWELL_MIN) + DWELL_MIN) {
        events.push({
          id: `travel-${i}`,
          minuteMark: (i - 1) * (TRAVEL_MIN + DWELL_MIN) + DWELL_MIN,
          type: 'travel',
          message: `Traveling to ${name}`,
          dotColor: 'bg-blue-400',
        });
      }

      // Arrival event
      if (elapsedMinutes >= arrivalMin) {
        events.push({
          id: `arrive-${i}`,
          minuteMark: arrivalMin,
          type: 'arrive',
          message: `Arrived at ${name}`,
          dotColor: 'bg-nexgen-blue',
        });
      }

      // Completion or skip
      if (stop.status === 'arrived') {
        const visit = stop.visitId ? visitMap.get(stop.visitId) : undefined;
        const outcome = visit?.outcome ? OUTCOME_STYLES[visit.outcome]?.label : 'Visit complete';
        events.push({
          id: `complete-${i}`,
          minuteMark: arrivalMin + DWELL_MIN,
          type: 'complete',
          message: `${name} — ${outcome}`,
          dotColor: 'bg-emerald-500',
        });
      } else if (stop.status === 'skipped') {
        events.push({
          id: `skip-${i}`,
          minuteMark: arrivalMin + 2,
          type: 'skip',
          message: `Skipped ${name}`,
          dotColor: 'bg-red-400',
        });
      }
    });

    return events
      .filter(e => e.minuteMark <= elapsedMinutes)
      .sort((a, b) => b.minuteMark - a.minuteMark)
      .slice(0, 20);
  }, [route.stops, elapsedMinutes, hoReCaMap, visitMap]);

  const formatRelativeTime = (minuteMark: number) => {
    const diff = elapsedMinutes - minuteMark;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.round(diff)}m ago`;
    return `${Math.round(diff / 60)}h ago`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-stone-200 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={onBack} className="p-1 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4 text-stone-500" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-stone-900 truncate">{route.name}</h3>
            <p className="text-xs text-stone-500">{rep?.name ?? 'Unknown'} · {new Date(route.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }} />
          </div>
          <span className="text-xs text-stone-500 tabular-nums">{completedStops}/{totalStops}</span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Stop Timeline */}
        <div className="p-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-3">Stops</h4>
          <div className="space-y-0">
            {stopsWithContext.map((stop, i) => {
              const isExpanded = expandedStopIdx === i;
              const statusColor = stop.status === 'arrived' ? 'bg-emerald-500' : stop.status === 'skipped' ? 'bg-red-400' : 'bg-stone-400';
              const isCurrentStop = repPosition?.currentStopIndex === i && stop.status === 'pending';

              return (
                <div key={i} className="flex gap-2.5">
                  {/* Timeline line + circle */}
                  <div className="flex flex-col items-center">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${statusColor} ${isCurrentStop ? 'ring-2 ring-blue-300 ring-offset-1' : ''}`}>
                      {stop.status === 'arrived' ? <CheckCircle2 className="w-3 h-3" /> : stop.status === 'skipped' ? <XCircle className="w-3 h-3" /> : stop.sequence}
                    </div>
                    {i < stopsWithContext.length - 1 && (
                      <div className="w-0.5 flex-1 bg-stone-200 my-1 min-h-[16px]" />
                    )}
                  </div>

                  {/* Stop info */}
                  <div className="flex-1 pb-3 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-medium text-stone-900 truncate">{stop.hoReCa?.name ?? 'Unknown'}</p>
                      {stop.status !== 'pending' && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          stop.status === 'arrived' ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'
                        }`}>
                          {stop.status === 'arrived' ? 'Visited' : 'Skipped'}
                        </span>
                      )}
                    </div>

                    {isCurrentStop && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Navigation className="w-3 h-3 text-blue-600" />
                        <span className="text-xs font-medium text-blue-600">Rep is here</span>
                      </div>
                    )}

                    {stop.visit && stop.visit.arrivalTime && (
                      <p className="text-xs text-stone-400 tabular-nums mt-0.5">
                        {new Date(stop.visit.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {stop.visit.departureTime && ` — ${new Date(stop.visit.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      </p>
                    )}

                    {/* Expandable visit details */}
                    {stop.status === 'arrived' && stop.visit && (
                      <>
                        <button
                          onClick={() => setExpandedStopIdx(isExpanded ? null : i)}
                          className="text-xs text-nexgen-blue hover:underline mt-1 cursor-pointer flex items-center gap-0.5"
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {isExpanded ? 'Hide' : 'View'} details
                        </button>
                        {isExpanded && (
                          <div className="mt-2 p-2.5 bg-stone-50 rounded-lg text-xs space-y-1.5">
                            {stop.visit.outcome && OUTCOME_STYLES[stop.visit.outcome] && (
                              <div>
                                <span className="text-stone-500">Outcome: </span>
                                <span className={`font-medium px-1.5 py-0.5 rounded ${OUTCOME_STYLES[stop.visit.outcome].color}`}>
                                  {OUTCOME_STYLES[stop.visit.outcome].label}
                                </span>
                              </div>
                            )}
                            {stop.visit.notes && <p><span className="text-stone-500">Notes:</span> {stop.visit.notes}</p>}
                            {stop.visit.competitorNotes && <p><span className="text-stone-500">Competitor:</span> {stop.visit.competitorNotes}</p>}
                            {stop.visit.stockCheckNotes && <p><span className="text-stone-500">Stock:</span> {stop.visit.stockCheckNotes}</p>}
                            {stop.visit.photos && stop.visit.photos.length > 0 && (
                              <VisitPhotoStrip visitId={stop.visit.id} photos={stop.visit.photos} thumbClassName="w-10 h-10" />
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="p-3 border-t border-stone-200">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-3 flex items-center gap-1.5">
            <Activity className="w-3 h-3" />
            Live Activity
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </h4>
          {activityEvents.length === 0 ? (
            <p className="text-xs text-stone-400 italic">Waiting for activity...</p>
          ) : (
            <div className="space-y-2.5">
              {activityEvents.map(event => (
                <div key={event.id} className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${event.dotColor}`} />
                  <div className="min-w-0">
                    <p className="text-xs text-stone-700">{event.message}</p>
                    <p className="text-[10px] text-stone-400 tabular-nums">{formatRelativeTime(event.minuteMark)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScheduledVisitTrackingDetail;
