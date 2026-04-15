import type { Visit, ScheduledVisit, Order } from '../types';
import type { RepProductivity } from '../types';

const MS_PER_DAY = 86_400_000;

function isInDateRange(dateStr: string, startDate: Date, endDate: Date): boolean {
  const d = new Date(dateStr).getTime();
  return d >= startDate.getTime() && d <= endDate.getTime();
}

export function getVisitCompletionRate(
  visits: readonly Visit[],
  routes: readonly ScheduledVisit[],
  userId: number,
  startDate: Date,
  endDate: Date,
): { planned: number; completed: number; skipped: number; rate: number } {
  const userRoutes = routes.filter(r =>
    r.createdBy === userId && isInDateRange(r.date, startDate, endDate)
  );

  const planned = userRoutes.reduce((sum, r) => sum + r.stops.length, 0);

  const completedStops = userRoutes.reduce((sum, r) =>
    sum + r.stops.filter(s => s.status === 'arrived').length, 0
  );

  const skippedStops = userRoutes.reduce((sum, r) =>
    sum + r.stops.filter(s => s.status === 'skipped').length, 0
  );

  const rate = planned > 0 ? Math.round((completedStops / planned) * 100) : 0;

  return { planned, completed: completedStops, skipped: skippedStops, rate };
}

export function getVisitConversionRate(
  visits: readonly Visit[],
  orders: readonly Order[],
  userId: number,
  startDate: Date,
  endDate: Date,
): { totalVisits: number; ordersPlaced: number; rate: number } {
  const userVisits = visits.filter(v =>
    v.userId === userId && isInDateRange(v.arrivalTime, startDate, endDate)
  );

  const ordersPlaced = userVisits.filter(v => v.outcome === 'order_placed').length;
  const rate = userVisits.length > 0 ? Math.round((ordersPlaced / userVisits.length) * 100) : 0;

  return { totalVisits: userVisits.length, ordersPlaced, rate };
}

export function getRouteEfficiency(
  routes: readonly ScheduledVisit[],
  visits: readonly Visit[],
  userId: number,
): { avgStopsPerRoute: number; avgMinutesPerVisit: number; routesCompleted: number } {
  const userRoutes = routes.filter(r => r.createdBy === userId);
  const completedRoutes = userRoutes.filter(r => r.status === 'completed');

  const avgStopsPerRoute = completedRoutes.length > 0
    ? Math.round((completedRoutes.reduce((sum, r) => sum + r.stops.length, 0) / completedRoutes.length) * 10) / 10
    : 0;

  // Calculate avg minutes per visit from visits with arrival and departure times
  const userVisits = visits.filter(v => v.userId === userId && v.arrivalTime && v.departureTime);
  let avgMinutesPerVisit = 0;
  if (userVisits.length > 0) {
    const totalMinutes = userVisits.reduce((sum, v) => {
      const arrival = new Date(v.arrivalTime).getTime();
      const departure = new Date(v.departureTime!).getTime();
      return sum + (departure - arrival) / 60000;
    }, 0);
    avgMinutesPerVisit = Math.round(totalMinutes / userVisits.length);
  }

  return { avgStopsPerRoute, avgMinutesPerVisit, routesCompleted: completedRoutes.length };
}

export function computeRepProductivity(
  visits: readonly Visit[],
  routes: readonly ScheduledVisit[],
  orders: readonly Order[],
  userId: number,
  startDate: Date,
  endDate: Date,
): RepProductivity {
  const completion = getVisitCompletionRate(visits, routes, userId, startDate, endDate);
  const conversion = getVisitConversionRate(visits, orders, userId, startDate, endDate);
  const efficiency = getRouteEfficiency(routes, visits, userId);

  return {
    visitCompletionRate: completion.rate,
    visitConversionRate: conversion.rate,
    avgStopsPerRoute: efficiency.avgStopsPerRoute,
    routesCompleted: efficiency.routesCompleted,
  };
}
