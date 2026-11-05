import React, { useState, useMemo, useEffect } from 'react';
import type { ScheduledVisit, HoReCa, Visit, User, Order } from '../../types';
import { getTodaysScheduledVisits, getUpcomingScheduledVisits, getPastScheduledVisits, arriveAtStop, startScheduledVisit, getScheduledVisitsForRep } from '../../services/scheduledVisitService';
import ScheduledVisitList from './ScheduledVisitList';
import ScheduledVisitDetail from './ScheduledVisitDetail';
import ScheduledVisitWizard from './ScheduledVisitWizard';
import VisitModal from '../visits/VisitModal';
import { Plus, MapPin, Play, ArrowRight } from 'lucide-react';
import { PageFrame } from '../ui/PageFrame';
import { PageHeader } from '../ui/PageHeader';
import { PageTabs } from '../ui/PageTabs';
import { ADMIN_TAB_LABELS } from '../../lib/adminTabUrl';

type RoutesTab = 'today' | 'upcoming' | 'past';

interface RoutesViewProps {
  currentUser: User;
  hoReCas: HoReCa[];
  routes: ScheduledVisit[];
  setRoutes: (routes: ScheduledVisit[]) => void;
  visits: Visit[];
  setVisits: (visits: Visit[]) => Promise<boolean>;
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

  const handleVisitSave = async (visit: Visit) => {
    const route = selectedRoute;
    const stopIndex = checkInStopIndex;
    setCheckInStopIndex(null);
    // Link the stop only once the visit row exists, so a failed insert never
    // leaves the stop pointing at a visit that was never saved.
    const saved = await setVisits([...visits, visit]);
    if (saved && route && stopIndex !== null) {
      handleUpdateRoute(arriveAtStop(route, stopIndex, visit.id));
    }
  };

  const tabs: Array<{ id: RoutesTab; label: string; badge: number }> = [
    { id: 'today', label: 'Today', badge: todaysRoutes.length },
    { id: 'upcoming', label: 'Upcoming', badge: upcomingRoutes.length },
    { id: 'past', label: 'Past', badge: pastRoutes.length },
  ];

  // Determine which customer is at the stop being checked into
  const checkInHoReCaId = selectedRoute && checkInStopIndex !== null
    ? selectedRoute.stops[checkInStopIndex]?.hoReCaId
    : undefined;

  return (
    <PageFrame>
      <PageHeader
        title={ADMIN_TAB_LABELS['Scheduled Visits']}
        description="Your visits for today and ahead, with check-ins at each stop."
        actions={
          <button
            onClick={() => { setShowForm(true); setSelectedRouteId(null); }}
            className="flex items-center gap-1 px-3 py-1.5 touch-target-y text-sm font-medium text-white bg-nexgen-blue rounded-lg hover:bg-nexgen-blue-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Scheduled Visit
          </button>
        }
      />

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
                  {plannedRoute ? <><Play className="w-4 h-4" /> Start Scheduled Visit</> : <><ArrowRight className="w-4 h-4" /> Continue Scheduled Visit</>}
                </button>
              </div>
            );
          })()}

          <PageTabs
            ariaLabel="Scheduled visit period"
            tabs={tabs}
            activeId={activeTab}
            onChange={setActiveTab}
          />

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
    </PageFrame>
  );
};

export default ScheduledVisitsView;
