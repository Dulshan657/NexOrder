import type { ScheduledVisit, ScheduledVisitStop, ScheduledVisitStatus, ScheduledVisitChangeRequest, RecurrenceRule, MockRepPosition, HoReCa, ReorderPayload, AddStopPayload, RemoveStopPayload, User } from '../types';
import { UserRole } from '../types';

/**
 * Whether the given user is allowed to add a stop to this route.
 * Feature rule: assignee, creator, admin, or manager can add stops to a
 * route in 'planned' or 'in_progress' status. Completed routes are locked.
 */
export function canAddStopToRoute(route: ScheduledVisit, user: User): boolean {
  if (route.status === 'completed') return false;
  if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) return true;
  const assignee = route.assignedTo ?? route.createdBy;
  return assignee === user.id;
}

export function createScheduledVisit(
  name: string,
  date: string,
  hoReCaIds: number[],
  userId: number,
): ScheduledVisit {
  const stops: ScheduledVisitStop[] = hoReCaIds.map((hoReCaId, i) => ({
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

export function reorderStops(route: ScheduledVisit, fromIndex: number, toIndex: number): ScheduledVisit {
  const stops = [...route.stops];
  const [moved] = stops.splice(fromIndex, 1);
  stops.splice(toIndex, 0, moved);
  return {
    ...route,
    stops: stops.map((s, i) => ({ ...s, sequence: i + 1 })),
  };
}

export function addStopToScheduledVisit(
  route: ScheduledVisit,
  hoReCaId: number,
  atIndex?: number,
): ScheduledVisit {
  const newStop: ScheduledVisitStop = { hoReCaId, sequence: 0, status: 'pending' };
  const next = [...route.stops];
  if (atIndex === undefined || atIndex < 0 || atIndex > next.length) {
    next.push(newStop);
  } else {
    next.splice(atIndex, 0, newStop);
  }
  return {
    ...route,
    stops: next.map((s, i) => ({ ...s, sequence: i + 1 })),
  };
}

export function removeStopFromScheduledVisit(route: ScheduledVisit, hoReCaId: number): ScheduledVisit {
  return {
    ...route,
    stops: route.stops
      .filter(s => s.hoReCaId !== hoReCaId)
      .map((s, i) => ({ ...s, sequence: i + 1 })),
  };
}

export function startScheduledVisit(route: ScheduledVisit): ScheduledVisit {
  return { ...route, status: 'in_progress' };
}

export function completeScheduledVisit(route: ScheduledVisit): ScheduledVisit {
  return { ...route, status: 'completed', completedAt: new Date().toISOString() };
}

export function arriveAtStop(route: ScheduledVisit, stopIndex: number, visitId: string): ScheduledVisit {
  return {
    ...route,
    stops: route.stops.map((s, i) =>
      i === stopIndex ? { ...s, status: 'arrived' as const, visitId } : s
    ),
  };
}

export function skipStop(route: ScheduledVisit, stopIndex: number): ScheduledVisit {
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

function matchesUser(route: ScheduledVisit, userId?: number): boolean {
  if (userId === undefined) return true;
  return route.createdBy === userId || route.assignedTo === userId;
}

export function getTodaysScheduledVisits(routes: readonly ScheduledVisit[], userId?: number): ScheduledVisit[] {
  return routes.filter(r => !r.isTemplate && isToday(r.date) && matchesUser(r, userId));
}

export function getUpcomingScheduledVisits(routes: readonly ScheduledVisit[], userId?: number): ScheduledVisit[] {
  return routes
    .filter(r => !r.isTemplate && isFuture(r.date) && matchesUser(r, userId))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getPastScheduledVisits(routes: readonly ScheduledVisit[], userId?: number): ScheduledVisit[] {
  return routes
    .filter(r => !r.isTemplate && (isPast(r.date) || r.status === 'completed') && matchesUser(r, userId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// --- ScheduledVisit Assignment ---

export function createAssignedScheduledVisit(
  name: string,
  date: string,
  hoReCaIds: number[],
  assignedTo: number,
  assignedBy: number,
): ScheduledVisit {
  const base = createScheduledVisit(name, date, hoReCaIds, assignedBy);
  return {
    ...base,
    assignedTo,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };
}

export function assignScheduledVisit(route: ScheduledVisit, assignedTo: number, assignedBy: number): ScheduledVisit {
  return {
    ...route,
    assignedTo,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };
}

export function reassignScheduledVisit(route: ScheduledVisit, newAssignedTo: number, reassignedBy: number): ScheduledVisit {
  if (route.status === 'completed') return route;
  return {
    ...route,
    assignedTo: newAssignedTo,
    assignedBy: reassignedBy,
    assignedAt: new Date().toISOString(),
  };
}

export function isAssignedScheduledVisit(route: ScheduledVisit): boolean {
  return route.assignedTo !== undefined && route.assignedBy !== undefined;
}

export function getScheduledVisitsForRep(routes: readonly ScheduledVisit[], userId: number): ScheduledVisit[] {
  return routes.filter(r => !r.isTemplate && (r.createdBy === userId || r.assignedTo === userId));
}

export function getAssignedScheduledVisits(routes: readonly ScheduledVisit[], assignedBy?: number): ScheduledVisit[] {
  return routes.filter(r =>
    !r.isTemplate &&
    r.assignedTo !== undefined &&
    (assignedBy === undefined || r.assignedBy === assignedBy)
  );
}

// --- Change Requests ---

export function addChangeRequest(
  route: ScheduledVisit,
  request: Omit<ScheduledVisitChangeRequest, 'id' | 'status' | 'requestedAt'>,
): ScheduledVisit {
  const newRequest: ScheduledVisitChangeRequest = {
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

export function approveChangeRequest(route: ScheduledVisit, requestId: string, reviewerId: number): ScheduledVisit {
  const request = route.changeRequests?.find(cr => cr.id === requestId);
  if (!request || request.status !== 'pending') return route;

  // Apply the change to stops
  let updatedStops = [...route.stops];

  if (request.type === 'reorder') {
    const payload = request.payload as ReorderPayload;
    const stopMap = new Map(route.stops.map(s => [s.hoReCaId, s] as const));
    updatedStops = payload.newStopOrder
      .map(hoReCaId => stopMap.get(hoReCaId))
      .filter((s): s is ScheduledVisitStop => s !== undefined)
      .map((s, i) => ({ ...s, sequence: i + 1 }));
  } else if (request.type === 'add_stop') {
    const payload = request.payload as AddStopPayload;
    const newStop: ScheduledVisitStop = { hoReCaId: payload.hoReCaId, sequence: 0, status: 'pending' };
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

export function rejectChangeRequest(route: ScheduledVisit, requestId: string, reviewerId: number): ScheduledVisit {
  return {
    ...route,
    changeRequests: (route.changeRequests ?? []).map(cr =>
      cr.id === requestId
        ? { ...cr, status: 'rejected' as const, reviewedBy: reviewerId, reviewedAt: new Date().toISOString() }
        : cr
    ),
  };
}

export function getPendingChangeRequests(routes: readonly ScheduledVisit[]): { route: ScheduledVisit; request: ScheduledVisitChangeRequest }[] {
  const results: { route: ScheduledVisit; request: ScheduledVisitChangeRequest }[] = [];
  for (const route of routes) {
    for (const cr of route.changeRequests ?? []) {
      if (cr.status === 'pending') {
        results.push({ route, request: cr });
      }
    }
  }
  return results;
}

// --- ScheduledVisit Templates ---

export function createScheduledVisitTemplate(
  name: string,
  hoReCaIds: number[],
  recurrence: RecurrenceRule,
  assignedTo: number,
  createdBy: number,
): ScheduledVisit {
  const stops: ScheduledVisitStop[] = hoReCaIds.map((hoReCaId, i) => ({
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

export function generateScheduledVisitsFromTemplates(
  templates: readonly ScheduledVisit[],
  existingRoutes: readonly ScheduledVisit[],
  daysAhead: number = 7,
): ScheduledVisit[] {
  const generated: ScheduledVisit[] = [];
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

      const stops: ScheduledVisitStop[] = tmpl.stops.map((s, i) => ({
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
  route: ScheduledVisit,
  hoReCas: readonly HoReCa[],
  elapsedMinutes: number,
): MockRepPosition | null {
  const hoReCaMap = new Map(hoReCas.map(h => [h.id, h] as const));
  const stopsWithCoords = route.stops
    .map(s => {
      const h = hoReCaMap.get(s.hoReCaId);
      return h ? { ...s, lat: h.lat ?? -33.87, lng: h.lng ?? 151.21 } : null;
    })
    .filter((s): s is ScheduledVisitStop & { lat: number; lng: number } => s !== null);

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
    scheduledVisitId: route.id,
    currentStopIndex: segIndex,
  };
}
