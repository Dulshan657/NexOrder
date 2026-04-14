import { useEffect, useRef } from 'react';
import type { Route, AppNotification, User, ToastType } from '../types';

interface UseRouteLifecycleParams {
  routes: Route[];
  users: User[];
  currentUser: User;
  notifications: AppNotification[];
  setNotifications: (fn: (prev: AppNotification[]) => AppNotification[]) => void;
  addToast: (message: string, type: ToastType) => void;
}

export function useRouteLifecycle({
  routes,
  users,
  currentUser,
  notifications,
  setNotifications,
  addToast,
}: UseRouteLifecycleParams) {
  const prevRoutesRef = useRef<Route[]>(routes);
  const userMap = new Map(users.map(u => [u.id, u]));

  useEffect(() => {
    const prev = prevRoutesRef.current;
    const prevMap = new Map(prev.map(r => [r.id, r]));

    for (const route of routes) {
      if (route.isTemplate) continue;
      const old = prevMap.get(route.id);

      // New assignment
      if (route.assignedTo && (!old || !old.assignedTo)) {
        const repName = userMap.get(route.assignedTo)?.name ?? 'a rep';
        const notification: AppNotification = {
          id: `notif-route-assign-${route.id}-${Date.now()}`,
          type: 'route_assigned',
          message: `Route "${route.name}" has been assigned to ${repName}`,
          timestamp: new Date().toISOString(),
          read: false,
          metadata: { routeId: route.id, userId: route.assignedTo },
        };
        setNotifications(prev => [notification, ...prev]);
      }

      // Route completed
      if (route.status === 'completed' && old && old.status !== 'completed' && route.assignedBy) {
        const repName = userMap.get(route.assignedTo ?? route.createdBy)?.name ?? 'A rep';
        const notification: AppNotification = {
          id: `notif-route-complete-${route.id}-${Date.now()}`,
          type: 'route_completed',
          message: `Route "${route.name}" completed by ${repName}`,
          timestamp: new Date().toISOString(),
          read: false,
          metadata: { routeId: route.id, userId: route.assignedBy },
        };
        setNotifications(prev => [notification, ...prev]);
        addToast(`Route "${route.name}" completed by ${repName}`, 'success');
      }

      // New change request
      const oldCRCount = old?.changeRequests?.length ?? 0;
      const newCRCount = route.changeRequests?.length ?? 0;
      if (newCRCount > oldCRCount && route.assignedBy) {
        const repName = userMap.get(route.changeRequests?.[newCRCount - 1]?.requestedBy ?? 0)?.name ?? 'A rep';
        const notification: AppNotification = {
          id: `notif-cr-${route.id}-${Date.now()}`,
          type: 'change_request',
          message: `${repName} requested a change to "${route.name}"`,
          timestamp: new Date().toISOString(),
          read: false,
          metadata: { routeId: route.id, userId: route.assignedBy },
        };
        setNotifications(prev => [notification, ...prev]);
      }

      // Change request status changed (approved/rejected)
      if (old?.changeRequests && route.changeRequests) {
        for (let i = 0; i < route.changeRequests.length; i++) {
          const newCR = route.changeRequests[i];
          const oldCR = old.changeRequests[i];
          if (oldCR && oldCR.status === 'pending' && newCR.status !== 'pending') {
            const notification: AppNotification = {
              id: `notif-cr-${newCR.id}-${Date.now()}`,
              type: newCR.status === 'approved' ? 'change_approved' : 'change_rejected',
              message: `Your change request for "${route.name}" was ${newCR.status}`,
              timestamp: new Date().toISOString(),
              read: false,
              metadata: { routeId: route.id, userId: newCR.requestedBy },
            };
            setNotifications(prev => [notification, ...prev]);
          }
        }
      }
    }

    prevRoutesRef.current = routes;
  }, [routes]);
}
