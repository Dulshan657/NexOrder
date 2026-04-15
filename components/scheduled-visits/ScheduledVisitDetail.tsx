import React, { useState } from 'react';
import type { ScheduledVisit, HoReCa, Visit, User } from '../../types';
import { startScheduledVisit, completeScheduledVisit, arriveAtStop, skipStop, isAssignedScheduledVisit } from '../../services/scheduledVisitService';
import ScheduledVisitStopCard from './ScheduledVisitStopCard';
import ScheduledVisitMap from './ScheduledVisitMap';
import ChangeRequestModal from './ChangeRequestModal';
import { ArrowLeft, Play, CheckCircle2, Clock, UserCheck, GitPullRequest, ChevronDown, ChevronUp } from 'lucide-react';

interface RouteDetailProps {
  route: ScheduledVisit;
  hoReCas: HoReCa[];
  visits: Visit[];
  users?: User[];
  currentUserId?: number;
  onUpdateRoute: (route: ScheduledVisit) => void;
  onBack: () => void;
  onCheckIn: (stopIndex: number) => void;
}

const CR_STATUS_COLORS: Record<string, string> = {
  pending: 'text-orange-700 bg-orange-50 border-orange-200',
  approved: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  rejected: 'text-red-700 bg-red-50 border-red-200',
};

const ScheduledVisitDetail: React.FC<RouteDetailProps> = ({ route, hoReCas, visits, users, currentUserId, onUpdateRoute, onBack, onCheckIn }) => {
  const [showChangeRequest, setShowChangeRequest] = useState(false);
  const [showCRHistory, setShowCRHistory] = useState(false);
  const assigned = isAssignedScheduledVisit(route);
  const userMap = new Map((users ?? []).map(u => [u.id, u]));
  const assignerName = assigned && route.assignedBy ? userMap.get(route.assignedBy)?.name : undefined;
  const customerMap = new Map(hoReCas.map(c => [c.id, c]));
  const visitMap = new Map(visits.map(v => [v.id, v]));

  const completedStops = route.stops.filter(s => s.status !== 'pending').length;
  const totalStops = route.stops.length;
  const allDone = completedStops === totalStops && totalStops > 0;

  const handleStartRoute = () => {
    onUpdateRoute(startScheduledVisit(route));
  };

  const handleCompleteRoute = () => {
    onUpdateRoute(completeScheduledVisit(route));
  };

  const handleSkip = (stopIndex: number) => {
    onUpdateRoute(skipStop(route, stopIndex));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-stone-500" />
            </button>
            <div>
              <h2 className="text-xl font-display font-bold text-stone-800">{route.name}</h2>
              <p className="text-sm text-stone-500">
                {new Date(route.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* ScheduledVisit actions */}
            {route.status === 'planned' && (
              <button onClick={handleStartRoute} className="flex items-center gap-1 text-sm font-medium text-white bg-nexgen-blue px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors">
                <Play className="w-4 h-4" />
                Start ScheduledVisit
              </button>
            )}
            {route.status === 'in_progress' && allDone && (
              <button onClick={handleCompleteRoute} className="flex items-center gap-1 text-sm font-medium text-white bg-emerald-600 px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors">
                <CheckCircle2 className="w-4 h-4" />
                Complete ScheduledVisit
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm font-medium text-stone-600">
            {completedStops}/{totalStops} stops
          </span>
        </div>
      </div>

      {/* Assigned route banner */}
      {assigned && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-teal-600" />
            <p className="text-sm text-teal-800">
              Assigned by <span className="font-semibold">{assignerName ?? 'a manager'}</span> — changes require approval
            </p>
          </div>
          {route.status !== 'completed' && currentUserId !== undefined && (
            <button
              onClick={() => setShowChangeRequest(true)}
              className="flex items-center gap-1 text-sm font-medium text-teal-700 bg-white px-3 py-1.5 rounded-lg border border-teal-200 hover:bg-teal-100 transition-colors"
            >
              <GitPullRequest className="w-4 h-4" />
              Request Change
            </button>
          )}
        </div>
      )}

      {/* Change request history */}
      {assigned && (route.changeRequests ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <button
            onClick={() => setShowCRHistory(!showCRHistory)}
            className="w-full flex items-center justify-between p-4 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
          >
            <span>Change Requests ({(route.changeRequests ?? []).length})</span>
            {showCRHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showCRHistory && (
            <div className="border-t border-stone-100 p-4 space-y-2">
              {(route.changeRequests ?? []).map(cr => (
                <div key={cr.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-stone-50">
                  <div>
                    <span className="font-medium text-stone-700 capitalize">{cr.type.replace('_', ' ')}</span>
                    <span className="text-stone-400 mx-2">·</span>
                    <span className="text-stone-500">{cr.description}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${CR_STATUS_COLORS[cr.status]}`}>
                    {cr.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Change request modal */}
      {showChangeRequest && currentUserId !== undefined && (
        <ChangeRequestModal
          route={route}
          hoReCas={hoReCas}
          userId={currentUserId}
          onSave={(updated) => { onUpdateRoute(updated); setShowChangeRequest(false); }}
          onClose={() => setShowChangeRequest(false)}
        />
      )}

      {/* Map — always visible */}
      <ScheduledVisitMap stops={route.stops} hoReCas={hoReCas} />

      {/* Stop list with timeline connector */}
      <div className="relative pl-4">
        <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-stone-200" />
        <div className="space-y-2">
          {route.stops.map((stop, index) => {
            const customer = customerMap.get(stop.hoReCaId);
            if (!customer) return null;
            const visit = stop.visitId ? visitMap.get(stop.visitId) : undefined;

            return (
              <ScheduledVisitStopCard
                key={stop.hoReCaId}
                stop={stop}
                customer={customer}
                visit={visit}
                isRouteActive={route.status === 'in_progress'}
                onCheckIn={() => onCheckIn(index)}
                onSkip={() => handleSkip(index)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ScheduledVisitDetail;
