import type { Route, RouteStop, RouteStatus, RouteChangeRequest, RecurrenceRule, MockRepPosition, HoReCa, ReorderPayload, AddStopPayload, RemoveStopPayload } from '../types';

export function createRoute(
  name: string,
  date: string,
  hoReCaIds: number[],
  userId: number,
): Route {
  const stops: RouteStop[] = hoReCaIds.map((hoReCaId, i) => ({
    hoReCaId,
    sequence: i + 1,
    status: 'pending' as const,
  }));

  return {
    id: `ROUTE-${Date.now()}`,
    name,
    date,
    stops,
    status: 'planned',
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
}

export function reorderStops(route: Route, fromIndex: number, toIndex: number): Route {
  const stops = [...route.stops];
  const [moved] = stops.splice(fromIndex, 1);
  stops.splice(toIndex, 0, moved);
  return {
    ...route,
    stops: stops.map((s, i) => ({ ...s, sequence: i + 1 })),
  };
}

export function addStopToRoute(route: Route, hoReCaId: number): Route {
  return {
    ...route,
    stops: [
      ...route.stops,
      { hoReCaId, sequence: route.stops.length + 1, status: 'pending' as const },
    ],
  };
}

export function removeStopFromRoute(route: Route, hoReCaId: number): Route {
  return {
    ...route,
    stops: route.stops
      .filter(s => s.hoReCaId !== hoReCaId)
      .map((s, i) => ({ ...s, sequence: i + 1 })),
  };
}

export function startRoute(route: Route): Route {
  return { ...route, status: 'in_progress' };
}

export function completeRoute(route: Route): Route {
  return { ...route, status: 'completed', completedAt: new Date().toISOString() };
}

export function arriveAtStop(route: Route, stopIndex: number, visitId: string): Route {
  return {
    ...route,
    stops: route.stops.map((s, i) =>
      i === stopIndex ? { ...s, status: 'arrived' as const, visitId } : s
    ),
  };
}

export function skipStop(route: Route, stopIndex: number): Route {
  return {
    ...route,
    stops: route.stops.map((s, i) =>
      i === stopIndex ? { ...s, status: 'skipped' as const } : s
    ),
  };
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr === today;
}

function isFuture(dateStr: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr > today;
}

function isPast(dateStr: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr < today;
}

function matchesUser(route: Route, userId?: number): boolean {
  if (userId === undefined) return true;
  return route.createdBy === userId || route.assignedTo === userId;
}

export function getTodaysRoutes(routes: readonly Route[], userId?: number): Route[] {
  return routes.filter(r => !r.isTemplate && isToday(r.date) && matchesUser(r, userId));
}

export function getUpcomingRoutes(routes: readonly Route[], userId?: number): Route[] {
  return routes
    .filter(r => !r.isTemplate && isFuture(r.date) && matchesUser(r, userId))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getPastRoutes(routes: readonly Route[], userId?: number): Route[] {
  return routes
    .filter(r => !r.isTemplate && (isPast(r.date) || r.status === 'completed') && matchesUser(r, userId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// --- Route Assignment ---

export function createAssignedRoute(
  name: string,
  date: string,
  hoReCaIds: number[],
  assignedTo: number,
  assignedBy: number,
): Route {
  const base = createRoute(name, date, hoReCaIds, assignedBy);
  return {
    ...base,
    assignedTo,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };
}

export function assignRoute(route: Route, assignedTo: number, assignedBy: number): Route {
  return {
    ...route,
    assignedTo,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };
}

export function reassignRoute(route: Route, newAssignedTo: number, reassignedBy: number): Route {
  if (route.status === 'completed') return route;
  return {
    ...route,
    assignedTo: newAssignedTo,
    assignedBy: reassignedBy,
    assignedAt: new Date().toISOString(),
  };
}

export function isAssignedRoute(route: Route): boolean {
  return route.assignedTo !== undefined && route.assignedBy !== undefined;
}

export function getRoutesForRep(routes: readonly Route[], userId: number): Route[] {
  return routes.filter(r => !r.isTemplate && (r.createdBy === userId || r.assignedTo === userId));
}

export function getAssignedRoutes(routes: readonly Route[], assignedBy?: number): Route[] {
  return routes.filter(r =>
    !r.isTemplate &&
    r.assignedTo !== undefined &&
    (assignedBy === undefined || r.assignedBy === assignedBy)
  );
}

// --- Change Requests ---

export function addChangeRequest(
  route: Route,
  request: Omit<RouteChangeRequest, 'id' | 'status' | 'requestedAt'>,
): Route {
  const newRequest: RouteChangeRequest = {
    ...request,
    id: `CR-${Date.now()}`,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  };
  return {
    ...route,
    changeRequests: [...(route.changeRequests ?? []), newRequest],
  };
}

export function approveChangeRequest(route: Route, requestId: string, reviewerId: number): Route {
  const request = route.changeRequests?.find(cr => cr.id === requestId);
  if (!request || request.status !== 'pending') return route;

  // Apply the change to stops
  let updatedStops = [...route.stops];

  if (request.type === 'reorder') {
    const payload = request.payload as ReorderPayload;
    const stopMap = new Map(route.stops.map(s => [s.hoReCaId, s]));
    updatedStops = payload.newStopOrder
      .map(hoReCaId => stopMap.get(hoReCaId))
      .filter((s): s is RouteStop => s !== undefined)
      .map((s, i) => ({ ...s, sequence: i + 1 }));
  } else if (request.type === 'add_stop') {
    const payload = request.payload as AddStopPayload;
    const newStop: RouteStop = { hoReCaId: payload.hoReCaId, sequence: 0, status: 'pending' };
    if (payload.atIndex !== undefined) {
      updatedStops.splice(payload.atIndex, 0, newStop);
    } else {
      updatedStops.push(newStop);
    }
    updatedStops = updatedStops.map((s, i) => ({ ...s, sequence: i + 1 }));
  } else if (request.type === 'remove_stop') {
    const payload = request.payload as RemoveStopPayload;
    updatedStops = updatedStops
      .filter(s => s.hoReCaId !== payload.hoReCaId)
      .map((s, i) => ({ ...s, sequence: i + 1 }));
  }

  return {
    ...route,
    stops: updatedStops,
    changeRequests: (route.changeRequests ?? []).map(cr =>
      cr.id === requestId
        ? { ...cr, status: 'approved' as const, reviewedBy: reviewerId, reviewedAt: new Date().toISOString() }
        : cr
    ),
  };
}

export function rejectChangeRequest(route: Route, requestId: string, reviewerId: number): Route {
  return {
    ...route,
    changeRequests: (route.changeRequests ?? []).map(cr =>
      cr.id === requestId
        ? { ...cr, status: 'rejected' as const, reviewedBy: reviewerId, reviewedAt: new Date().toISOString() }
        : cr
    ),
  };
}

export function getPendingChangeRequests(routes: readonly Route[]): { route: Route; request: RouteChangeRequest }[] {
  const results: { route: Route; request: RouteChangeRequest }[] = [];
  for (const route of routes) {
    for (const cr of route.changeRequests ?? []) {
      if (cr.status === 'pending') {
        results.push({ route, request: cr });
      }
    }
  }
  return results;
}

// --- Route Templates ---

export function createRouteTemplate(
  name: string,
  hoReCaIds: number[],
  recurrence: RecurrenceRule,
  assignedTo: number,
  createdBy: number,
): Route {
  const stops: RouteStop[] = hoReCaIds.map((hoReCaId, i) => ({
    hoReCaId,
    sequence: i + 1,
    status: 'pending' as const,
  }));
  return {
    id: `TMPL-${Date.now()}`,
    name,
    date: '',
    stops,
    status: 'planned',
    createdBy,
    createdAt: new Date().toISOString(),
    assignedTo,
    assignedBy: createdBy,
    isTemplate: true,
    recurrence,
  };
}

export function generateRoutesFromTemplates(
  templates: readonly Route[],
  existingRoutes: readonly Route[],
  daysAhead: number = 7,
): Route[] {
  const generated: Route[] = [];
  const now = new Date();

  for (const tmpl of templates) {
    if (!tmpl.isTemplate || !tmpl.recurrence) continue;

    for (let d = 0; d < daysAhead; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() + d);

      if (date.getDay() !== tmpl.recurrence.dayOfWeek) continue;

      // Skip if biweekly and wrong week
      if (tmpl.recurrence.frequency === 'biweekly') {
        const weekNum = Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));
        if (weekNum % 2 !== 0) continue;
      }

      const dateStr = date.toISOString().slice(0, 10);

      // Check if route already exists for this template + date
      const alreadyExists = existingRoutes.some(
        r => r.templateId === tmpl.id && r.date === dateStr
      );
      if (alreadyExists) continue;

      const stops: RouteStop[] = tmpl.stops.map((s, i) => ({
        hoReCaId: s.hoReCaId,
        sequence: i + 1,
        status: 'pending' as const,
      }));

      generated.push({
        id: `ROUTE-${Date.now()}-${d}`,
        name: tmpl.name,
        date: dateStr,
        stops,
        status: 'planned',
        createdBy: tmpl.createdBy,
        createdAt: new Date().toISOString(),
        assignedTo: tmpl.assignedTo,
        assignedBy: tmpl.assignedBy,
        assignedAt: new Date().toISOString(),
        templateId: tmpl.id,
      });
    }
  }

  return generated;
}

// --- Mock GPS Simulation ---

const TRAVEL_MINUTES_BETWEEN_STOPS = 15;
const DWELL_MINUTES_PER_STOP = 10;

export function simulateRepPosition(
  route: Route,
  hoReCas: readonly HoReCa[],
  elapsedMinutes: number,
): MockRepPosition | null {
  const hoReCaMap = new Map(hoReCas.map(h => [h.id, h]));
  const stopsWithCoords = route.stops
    .map(s => {
      const h = hoReCaMap.get(s.hoReCaId);
      return h ? { ...s, lat: h.lat ?? -33.87, lng: h.lng ?? 151.21 } : null;
    })
    .filter((s): s is RouteStop & { lat: number; lng: number } => s !== null);

  if (stopsWithCoords.length === 0) return null;

  const segmentTime = TRAVEL_MINUTES_BETWEEN_STOPS + DWELL_MINUTES_PER_STOP;
  const totalTime = stopsWithCoords.length * segmentTime;
  const clamped = Math.min(Math.max(0, elapsedMinutes), totalTime);

  const segIndex = Math.min(
    Math.floor(clamped / segmentTime),
    stopsWithCoords.length - 1
  );
  const timeInSegment = clamped - segIndex * segmentTime;

  let lat: number;
  let lng: number;
  let heading = 0;

  if (timeInSegment <= DWELL_MINUTES_PER_STOP) {
    // At stop (dwelling)
    lat = stopsWithCoords[segIndex].lat;
    lng = stopsWithCoords[segIndex].lng;
  } else if (segIndex < stopsWithCoords.length - 1) {
    // Traveling between stops
    const travelProgress = (timeInSegment - DWELL_MINUTES_PER_STOP) / TRAVEL_MINUTES_BETWEEN_STOPS;
    const from = stopsWithCoords[segIndex];
    const to = stopsWithCoords[segIndex + 1];
    lat = from.lat + (to.lat - from.lat) * travelProgress;
    lng = from.lng + (to.lng - from.lng) * travelProgress;
    heading = Math.atan2(to.lng - from.lng, to.lat - from.lat) * (180 / Math.PI);
  } else {
    // At last stop
    lat = stopsWithCoords[segIndex].lat;
    lng = stopsWithCoords[segIndex].lng;
  }

  return {
    userId: route.assignedTo ?? route.createdBy,
    lat,
    lng,
    heading,
    timestamp: new Date().toISOString(),
    routeId: route.id,
    currentStopIndex: segIndex,
  };
}
