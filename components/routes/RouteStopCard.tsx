import React from 'react';
import type { RouteStop, HoReCa, Visit } from '../../types';
import { MapPin, CheckCircle2, XCircle, Clock, Navigation } from 'lucide-react';

interface RouteStopCardProps {
  stop: RouteStop;
  customer: HoReCa;
  visit?: Visit;
  isRouteActive: boolean;
  onCheckIn: () => void;
  onSkip: () => void;
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'text-stone-500 bg-stone-50 border-stone-200', icon: Clock },
  arrived: { label: 'Visited', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  skipped: { label: 'Skipped', color: 'text-red-700 bg-red-50 border-red-200', icon: XCircle },
};

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  order_placed: { label: 'Order Placed', color: 'text-emerald-700 bg-emerald-50' },
  follow_up_needed: { label: 'Follow Up', color: 'text-amber-700 bg-amber-50' },
  not_available: { label: 'Not Available', color: 'text-stone-600 bg-stone-100' },
  no_interest: { label: 'No Interest', color: 'text-red-600 bg-red-50' },
  stock_check_only: { label: 'Stock Check', color: 'text-blue-700 bg-blue-50' },
};

const RouteStopCard: React.FC<RouteStopCardProps> = ({ stop, customer, visit, isRouteActive, onCheckIn, onSkip }) => {
  const config = STATUS_CONFIG[stop.status];
  const StatusIcon = config.icon;

  return (
    <div className={`p-4 rounded-xl border-l-4 border border-stone-200/60 bg-white shadow-card ${
      stop.status === 'arrived' ? 'border-l-emerald-500' : stop.status === 'skipped' ? 'border-l-red-400' : 'border-l-stone-300'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-8 h-8 rounded-full text-white flex items-center justify-center text-sm font-bold relative z-10 ${
          stop.status === 'arrived' ? 'bg-emerald-500' : stop.status === 'skipped' ? 'bg-red-400' : 'bg-stone-400'
        }`}>
          {stop.sequence}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-base font-semibold text-stone-800 truncate">{customer.name}</h4>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${config.color}`}>
              <StatusIcon className="w-3 h-3" />
              {config.label}
            </span>
          </div>
          <p className="text-sm text-stone-500 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {customer.address}
          </p>
          {stop.plannedArrival && stop.status === 'pending' && (
            <p className="text-xs text-stone-400 mt-1">Planned: {stop.plannedArrival}</p>
          )}

          {/* Visit summary */}
          {visit && (
            <div className="mt-2 p-2 rounded-lg bg-white border border-stone-100 text-sm">
              <div className="flex items-center gap-2 mb-1">
                {visit.outcome && OUTCOME_LABELS[visit.outcome] && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${OUTCOME_LABELS[visit.outcome].color}`}>
                    {OUTCOME_LABELS[visit.outcome].label}
                  </span>
                )}
                {visit.departureTime && (
                  <span className="text-xs text-stone-400">
                    {Math.round((new Date(visit.departureTime).getTime() - new Date(visit.arrivalTime).getTime()) / 60000)} min
                  </span>
                )}
              </div>
              {visit.notes && <p className="text-xs text-stone-600 line-clamp-2">{visit.notes}</p>}
            </div>
          )}

          {/* Actions */}
          {isRouteActive && stop.status === 'pending' && (
            <div className="flex gap-2 mt-3">
              <button onClick={onCheckIn} className="flex items-center gap-1 text-xs font-medium text-white bg-nexgen-blue px-3 py-1.5 rounded-lg hover:bg-nexgen-blue-dark transition-colors">
                <Navigation className="w-3 h-3" />
                Check In
              </button>
              <button onClick={onSkip} className="text-xs font-medium text-stone-500 hover:text-stone-700 px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 transition-colors">
                Skip
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RouteStopCard;
