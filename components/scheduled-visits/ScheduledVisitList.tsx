import React, { useState, useMemo, useCallback } from 'react';
import type { ScheduledVisit, HoReCa, User } from '../../types';
import { isAssignedScheduledVisit } from '../../services/scheduledVisitService';
import { MapPin, Clock, Play, CheckCircle2, UserCheck, AlertCircle, Eye, ChevronUp, ChevronDown } from 'lucide-react';

type SortColumn = 'name' | 'date' | 'status' | 'stops';

interface RouteListProps {
  routes: ScheduledVisit[];
  hoReCas: HoReCa[];
  users?: User[];
  onSelectRoute: (scheduledVisitId: string) => void;
}

const STATUS_BADGE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  planned: { label: 'Planned', color: 'text-blue-700 bg-blue-50 border-blue-200', icon: <Clock className="w-3 h-3" /> },
  in_progress: { label: 'In Progress', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: <Play className="w-3 h-3" /> },
  completed: { label: 'Completed', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: <CheckCircle2 className="w-3 h-3" /> },
};

const STATUS_ORDER: Record<string, number> = { planned: 0, in_progress: 1, completed: 2 };
const ITEMS_PER_PAGE = 15;

const ScheduledVisitList: React.FC<RouteListProps> = ({ routes, hoReCas, users, onSelectRoute }) => {
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  const userMap = new Map((users ?? []).map(u => [u.id, u] as const));

  const sortedRoutes = useMemo(() => {
    const sorted = [...routes];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'date': cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
        case 'status': cmp = (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0); break;
        case 'stops': cmp = a.stops.length - b.stops.length; break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [routes, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedRoutes.length / ITEMS_PER_PAGE));
  const paginatedRoutes = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedRoutes.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedRoutes, currentPage]);
  const showingStart = sortedRoutes.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const showingEnd = Math.min(currentPage * ITEMS_PER_PAGE, sortedRoutes.length);

  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  }, [sortColumn]);

  const SortHeader: React.FC<{ column: SortColumn; label: string }> = ({ column, label }) => (
    <th
      className="px-4 py-3 font-semibold text-stone-600 cursor-pointer select-none hover:text-stone-900 transition-colors"
      onClick={() => handleSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortColumn === column ? (
          sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-0" />
        )}
      </span>
    </th>
  );

  if (routes.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-stone-200/60 border-dashed shadow-card">
        <MapPin className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <h3 className="text-lg font-display font-semibold text-stone-700">No Scheduled Visits</h3>
        <p className="text-stone-500 text-sm mt-1">Create a new route to get started.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/60 shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[600px]">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/50">
              <SortHeader column="name" label="ScheduledVisit" />
              <SortHeader column="date" label="Date" />
              <SortHeader column="stops" label="Stops" />
              <th className="px-4 py-3 font-semibold text-stone-600">Progress</th>
              <SortHeader column="status" label="Status" />
              <th className="px-4 py-3 font-semibold text-stone-600">Assigned</th>
              <th className="px-4 py-3 font-semibold text-stone-600 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {paginatedRoutes.map(route => {
              const badge = STATUS_BADGE[route.status];
              const completedStops = route.stops.filter(s => s.status === 'arrived').length;
              const assigned = isAssignedScheduledVisit(route);
              const pendingCRs = (route.changeRequests ?? []).filter(cr => cr.status === 'pending').length;

              return (
                <tr key={route.id} className="hover:bg-stone-50/50 transition-colors">
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-stone-900">{route.name}</span>
                      {pendingCRs > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded-full border border-orange-200">
                          <AlertCircle className="w-2.5 h-2.5" />{pendingCRs}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle text-stone-500 whitespace-nowrap tabular-nums">
                    {new Date(route.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 align-middle text-stone-600 tabular-nums">{route.stops.length}</td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${route.stops.length > 0 ? (completedStops / route.stops.length) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs text-stone-500 tabular-nums">{completedStops}/{route.stops.length}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    {badge && (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${badge.color}`}>
                        {badge.icon}{badge.label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {assigned && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                        <UserCheck className="w-3 h-3" />Assigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle text-right">
                    <button onClick={() => onSelectRoute(route.id)} className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer" title="View ScheduledVisit">
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {sortedRoutes.length > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50/30">
          <p className="text-sm text-stone-500">Showing {showingStart}&#8211;{showingEnd} of {sortedRoutes.length} routes</p>
          <div className="flex items-center gap-2">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed btn-press cursor-pointer">Previous</button>
            <span className="text-sm text-stone-600 tabular-nums">Page {currentPage} of {totalPages}</span>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed btn-press cursor-pointer">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledVisitList;
