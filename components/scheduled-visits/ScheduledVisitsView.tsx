import React, { useState, useMemo, useEffect } from 'react';
import type { ScheduledVisit, HoReCa, Visit, User, Order } from '../../types';
import { getTodaysScheduledVisits, getUpcomingScheduledVisits, getPastScheduledVisits, arriveAtStop, startScheduledVisit, getScheduledVisitsForRep } from '../../services/scheduledVisitService';
import ScheduledVisitList from './ScheduledVisitList';
import ScheduledVisitDetail from './ScheduledVisitDetail';
import ScheduledVisitWizard from './ScheduledVisitWizard';
import VisitModal from '../visits/VisitModal';
import { Plus, MapPin, Calendar, History, Play, ArrowRight } from 'lucide-react';

type RoutesTab = 'today' | 'upcoming' | 'past';

interface RoutesViewProps {
  currentUser: User;
  hoReCas: HoReCa[];
  routes: ScheduledVisit[];
  setRoutes: (routes: ScheduledVisit[]) => void;
  visits: Visit[];
  setVisits: (visits: Visit[]) => void;
  orders: Order[];
  users?: User[];
  onStartOrder: (hoReCaId: number) => void;
  initialSelectedRouteId?: string | null;
  onClearInitialRoute?: () => void;
}

const ScheduledVisitsView: React.FC<RoutesViewProps> = ({ currentUser, hoReCas, routes, setRoutes, visits, setVisits, orders, users, onStartOrder, initialSelectedRouteId, onClearInitialRoute }) => {
  const [activeTab, setActiveTab] = useState<RoutesTab>('today');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [checkInStopIndex, setCheckInStopIndex] = useState<number | null>(null);

  useEffect(() => {
    if (initialSelectedRouteId) {
      setSelectedRouteId(initialSelectedRouteId);
      onClearInitialRoute?.();
    }
  }, [initialSelectedRouteId, onClearInitialRoute]);

  const todaysRoutes = useMemo(() => getTodaysScheduledVisits(routes, currentUser.id), [routes, currentUser.id]);
  const upcomingRoutes = useMemo(() => getUpcomingScheduledVisits(routes, currentUser.id), [routes, currentUser.id]);
  const pastRoutes = useMemo(() => getPastScheduledVisits(routes, currentUser.id), [routes, currentUser.id]);

  const selectedRoute = useMemo(() => routes.find(r => r.id === selectedRouteId), [routes, selectedRouteId]);

  const currentRoutes = activeTab === 'today' ? todaysRoutes : activeTab === 'upcoming' ? upcomingRoutes : pastRoutes;

  const handleSaveRoute = (route: ScheduledVisit) => {
    setRoutes([...routes, route]);
    setShowForm(false);
  };

  const handleUpdateRoute = (updated: ScheduledVisit) => {
    setRoutes(routes.map(r => r.id === updated.id ? updated : r));
  };

  const handleCheckIn = (stopIndex: number) => {
    setCheckInStopIndex(stopIndex);
  };

  const handleVisitSave = (visit: Visit) => {
    setVisits([...visits, visit]);
    // Link visit to route stop
    if (selectedRoute && checkInStopIndex !== null) {
      const updated = arriveAtStop(selectedRoute, checkInStopIndex, visit.id);
      handleUpdateRoute(updated);
    }
    setCheckInStopIndex(null);
  };

  const tabs: Array<{ key: RoutesTab; label: string; icon: React.ReactNode; count: number }> = [
    { key: 'today', label: 'Today', icon: <MapPin className="w-4 h-4" />, count: todaysRoutes.length },
    { key: 'upcoming', label: 'Upcoming', icon: <Calendar className="w-4 h-4" />, count: upcomingRoutes.length },
    { key: 'past', label: 'Past', icon: <History className="w-4 h-4" />, count: pastRoutes.length },
  ];

  // Determine which customer is at the stop being checked into
  const checkInHoReCaId = selectedRoute && checkInStopIndex !== null
    ? selectedRoute.stops[checkInStopIndex]?.hoReCaId
    : undefined;

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-stone-700" />
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Scheduled Visits & Check-ins</h1>
        </div>
        <button
          onClick={() => { setShowForm(true); setSelectedRouteId(null); }}
          className="flex items-center gap-1 text-sm font-medium text-white bg-nexgen-blue px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors"
        >
          <Plus className="w-4 h-4" />
          New ScheduledVisit
        </button>
      </div>

      {showForm ? (
        <ScheduledVisitWizard
          hoReCas={hoReCas}
          userId={currentUser.id}
          users={users}
          onSave={handleSaveRoute}
          onCancel={() => setShowForm(false)}
        />
      ) : selectedRoute ? (
        <ScheduledVisitDetail
          route={selectedRoute}
          hoReCas={hoReCas}
          visits={visits.filter(v => v.scheduledVisitId === selectedRoute.id)}
          users={users}
          currentUser={currentUser}
          currentUserId={currentUser.id}
          onUpdateRoute={handleUpdateRoute}
          onBack={() => setSelectedRouteId(null)}
          onCheckIn={handleCheckIn}
        />
      ) : (
        <>
          {/* Start/Continue ScheduledVisit Banner */}
          {(() => {
            const plannedRoute = todaysRoutes.find(r => r.status === 'planned');
            const inProgressRoute = todaysRoutes.find(r => r.status === 'in_progress');
            const targetRoute = plannedRoute ?? inProgressRoute;
            if (!targetRoute) return null;
            const done = targetRoute.stops.filter(s => s.status !== 'pending').length;
            return (
              <div className="glass-card rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <MapPin className="w-5 h-5 text-nexgen-blue flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 truncate">{targetRoute.name}</p>
                    <p className="text-xs text-stone-500">{targetRoute.stops.length} stops{inProgressRoute ? ` · ${done}/${targetRoute.stops.length} done` : ''}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (plannedRoute) {
                      const started = startScheduledVisit(plannedRoute);
                      handleUpdateRoute(started);
                      setSelectedRouteId(started.id);
                    } else if (inProgressRoute) {
                      setSelectedRouteId(inProgressRoute.id);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-nexgen-blue text-white text-sm font-semibold hover:bg-nexgen-blue-dark btn-press cursor-pointer whitespace-nowrap min-h-[44px]"
                >
                  {plannedRoute ? <><Play className="w-4 h-4" /> Start ScheduledVisit</> : <><ArrowRight className="w-4 h-4" /> Continue ScheduledVisit</>}
                </button>
              </div>
            );
          })()}

          {/* Tab Bar */}
          <div className="flex bg-white rounded-xl border border-stone-200 p-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-nexgen-blue text-white'
                    : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key ? 'bg-white/20' : 'bg-stone-100'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <ScheduledVisitList routes={currentRoutes} hoReCas={hoReCas} users={users} onSelectRoute={setSelectedRouteId} />
        </>
      )}

      {/* Visit Modal */}
      {checkInStopIndex !== null && checkInHoReCaId !== undefined && (
        <VisitModal
          hoReCaId={checkInHoReCaId}
          userId={currentUser.id}
          scheduledVisitId={selectedRoute?.id}
          hoReCas={hoReCas}
          onSave={handleVisitSave}
          onClose={() => setCheckInStopIndex(null)}
        />
      )}
    </div>
  );
};

export default ScheduledVisitsView;
