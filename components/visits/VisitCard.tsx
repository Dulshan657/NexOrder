import React from 'react';
import type { Visit, HoReCa } from '../../types';
import { Clock, Image, MapPin } from 'lucide-react';

const OUTCOME_CONFIG: Record<string, { label: string; color: string }> = {
  order_placed: { label: 'Order Placed', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  follow_up_needed: { label: 'Follow Up', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  not_available: { label: 'Not Available', color: 'text-stone-600 bg-stone-100 border-stone-200' },
  no_interest: { label: 'No Interest', color: 'text-red-600 bg-red-50 border-red-200' },
  stock_check_only: { label: 'Stock Check', color: 'text-blue-700 bg-blue-50 border-blue-200' },
};

interface VisitCardProps {
  visit: Visit;
  customer?: HoReCa;
  showCustomerName?: boolean;
}

const VisitCard: React.FC<VisitCardProps> = ({ visit, customer, showCustomerName = true }) => {
  const outcome = visit.outcome ? OUTCOME_CONFIG[visit.outcome] : null;
  const duration = visit.departureTime
    ? Math.round((new Date(visit.departureTime).getTime() - new Date(visit.arrivalTime).getTime()) / 60000)
    : null;

  return (
    <div className="p-4 bg-white rounded-xl border border-stone-200 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div>
          {showCustomerName && customer && (
            <p className="font-semibold text-stone-800 text-sm">{customer.name}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-stone-500 mt-0.5">
            <Clock className="w-3 h-3" />
            <span>{new Date(visit.arrivalTime).toLocaleDateString()}</span>
            <span>{new Date(visit.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {duration !== null && <span className="text-stone-500">({duration} min)</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {visit.photos.length > 0 && (
            <span className="text-xs text-stone-500 flex items-center gap-1">
              <Image className="w-3 h-3" />
              {visit.photos.length}
            </span>
          )}
          {outcome && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${outcome.color}`}>
              {outcome.label}
            </span>
          )}
        </div>
      </div>
      {visit.notes && (
        <p className="text-sm text-stone-600 line-clamp-2 mt-1">{visit.notes}</p>
      )}
      {visit.nextVisitRecommendation && (
        <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          Next: {visit.nextVisitRecommendation}
        </p>
      )}
    </div>
  );
};

export default VisitCard;
