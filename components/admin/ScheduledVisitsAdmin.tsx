import React, { useState, useMemo } from 'react';
import type { ScheduledVisit, User, HoReCa, Visit } from '../../types';
import { UserRole } from '../../types';
import { getPendingChangeRequests, reassignScheduledVisit, isAssignedScheduledVisit, createAssignedScheduledVisit } from '../../services/scheduledVisitService';
import ScheduledVisitApprovalQueue from './ScheduledVisitApprovalQueue';
import ScheduledVisitTrackingMap from './ScheduledVisitTrackingMap';
import ScheduledVisitForm from '../scheduled-visits/ScheduledVisitForm';
import ScheduledVisitTemplateForm from '../scheduled-visits/ScheduledVisitTemplateForm';
import { MapPin, ClipboardList, Repeat, Navigation, Plus, Calendar, Clock, Play, CheckCircle2, UserCheck, ArrowRightLeft, Trash2 } from 'lucide-react';

type SubTab = 'all' | 'approvals' | 'templates' | 'tracking';

interface RoutesAdminProps {
  routes: ScheduledVisit[];
  users: User[];
  hoReCas: HoReCa[];
  visits: Visit[];
  currentUser: User;
  onSetRoutes: (routes: ScheduledVisit[]) => void;
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const STATUS_BADGE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  planned: { label: 'Planned', color: 'text-blue-700 bg-blue-50 border-blue-200', icon: <Clock className="w-3 h-3" /> },
  in_progress: { label: 'In Progress', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: <Play className="w-3 h-3" /> },
  completed: { label: 'Completed', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: <CheckCircle2 className="w-3 h-3" /> },
};

const ScheduledVisitsAdmin: React.FC<RoutesAdminProps> = ({ routes, users, hoReCas, visits, currentUser, onSetRoutes, addToast }) => {
  const [subTab, setSubTab] = useState<SubTab>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [filterRep, setFilterRep] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [reassignRouteId, setReassignRouteId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<number | ''>('');

  const userMap = new Map<number, User>(users.map(u => [u.id, u]));
  const hoReCaMap = new Map<number, HoReCa>(hoReCas.map(h => [h.id, h]));
  const reps = users.filter(u => u.role === UserRole.FIELD_REP);
  const pendingCount = getPendingChangeRequests(routes).length;

  const allRoutes = useMemo(() =>
    routes.filter(r => !r.isTemplate), [routes]);

  const templates = useMemo(() =>
    routes.filter(r => r.isTemplate), [routes]);

  const filteredRoutes = useMemo(() => {
    let result = allRoutes;
    if (filterRep !== '') result = result.filter(r => r.assignedTo === filterRep || r.createdBy === filterRep);
    if (filterStatus) result = result.filter(r => r.status === filterStatus);
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }, [allRoutes, filterRep, filterStatus]);

  const handleUpdateRoute = (updated: ScheduledVisit) => {
    onSetRoutes(routes.map(r => r.id === updated.id ? updated : r));
  };

  const handleSaveNewRoute = (route: ScheduledVisit) => {
    onSetRoutes([...routes, route]);
    setShowCreateForm(false);
    addToast('ScheduledVisit created and assigned', 'success');
  };

  const handleSaveTemplate = (template: ScheduledVisit) => {
    onSetRoutes([...routes, template]);
    setShowTemplateForm(false);
    addToast('ScheduledVisit template created', 'success');
  };

  const handleDeleteTemplate = (templateId: string) => {
    onSetRoutes(routes.filter(r => r.id !== templateId));
    addToast('Template deleted', 'info');
  };

  const handleReassign = (scheduledVisitId: string) => {
    if (reassignTarget === '') return;
    const route = routes.find(r => r.id === scheduledVisitId);
    if (!route) return;
    const updated = reassignScheduledVisit(route, reassignTarget, currentUser.id);
    handleUpdateRoute(updated);
    setReassignRouteId(null);
    setReassignTarget('');
    const repName = userMap.get(reassignTarget)?.name ?? 'rep';
    addToast(`ScheduledVisit reassigned to ${repName}`, 'success');
  };

  const subTabs: Array<{ key: SubTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { key: 'all', label: 'All Scheduled Visits', icon: <ClipboardList className="w-4 h-4" /> },
    { key: 'approvals', label: 'Approvals', icon: <UserCheck className="w-4 h-4" />, badge: pendingCount },
    { key: 'templates', label: 'Templates', icon: <Repeat className="w-4 h-4" />, badge: templates.length },
    { key: 'tracking', label: 'Live Tracking', icon: <Navigation className="w-4 h-4" /> },
  ];

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-stone-700" />
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">ScheduledVisit Management</h1>
        </div>
        <div className="flex gap-2">
          {subTab === 'templates' && (
            <button
              onClick={() => setShowTemplateForm(true)}
              className="flex items-center gap-1 text-sm font-medium text-white bg-purple-600 px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Template
            </button>
          )}
          {subTab === 'all' && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1 text-sm font-medium text-white bg-nexgen-blue px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create & Assign ScheduledVisit
            </button>
          )}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex bg-white rounded-xl border border-stone-200 p-1">
        {subTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
              subTab === tab.key ? 'bg-nexgen-blue text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                subTab === tab.key ? 'bg-white/20' : 'bg-orange-100 text-orange-700'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {showCreateForm && subTab === 'all' ? (
        <ScheduledVisitForm
          hoReCas={hoReCas}
          userId={currentUser.id}
          users={reps}
          isAdminMode
          onSave={handleSaveNewRoute}
          onCancel={() => setShowCreateForm(false)}
        />
      ) : showTemplateForm && subTab === 'templates' ? (
        <ScheduledVisitTemplateForm
          hoReCas={hoReCas}
          users={users}
          currentUser={currentUser}
          onSave={handleSaveTemplate}
          onCancel={() => setShowTemplateForm(false)}
        />
      ) : subTab === 'all' ? (
        <>
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <select
              value={filterRep}
              onChange={e => setFilterRep(e.target.value ? Number(e.target.value) : '')}
              className="px-3 py-2 border border-stone-300 rounded-lg text-sm"
            >
              <option value="">All Reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-stone-300 rounded-lg text-sm"
            >
              <option value="">All Statuses</option>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {/* ScheduledVisit table */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-stone-600">ScheduledVisit</th>
                    <th className="text-left px-4 py-3 font-medium text-stone-600">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-stone-600">Assigned To</th>
                    <th className="text-left px-4 py-3 font-medium text-stone-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-stone-600">Progress</th>
                    <th className="text-left px-4 py-3 font-medium text-stone-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoutes.map(route => {
                    const badge = STATUS_BADGE[route.status];
                    const rep = route.assignedTo ? userMap.get(route.assignedTo) : null;
                    const completed = route.stops.filter(s => s.status !== 'pending').length;
                    const pct = route.stops.length > 0 ? Math.round((completed / route.stops.length) * 100) : 0;

                    return (
                      <tr key={route.id} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-stone-800">{route.name}</p>
                          <p className="text-xs text-stone-500">{route.stops.length} stops</p>
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {route.date ? new Date(route.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {rep ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                              <UserCheck className="w-3 h-3" />{rep.name}
                            </span>
                          ) : (
                            <span className="text-xs text-stone-500">Self-created</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${badge.color}`}>
                            {badge.icon}{badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-stone-500">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {route.status !== 'completed' && (
                            reassignRouteId === route.id ? (
                              <div className="flex items-center gap-1">
                                <select
                                  value={reassignTarget}
                                  onChange={e => setReassignTarget(e.target.value ? Number(e.target.value) : '')}
                                  className="text-xs px-2 py-1 border border-stone-300 rounded"
                                >
                                  <option value="">Select...</option>
                                  {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <button onClick={() => handleReassign(route.id)} className="text-xs text-emerald-600 font-medium hover:underline">Save</button>
                                <button onClick={() => setReassignRouteId(null)} className="text-xs text-stone-500 hover:underline">Cancel</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setReassignRouteId(route.id); setReassignTarget(route.assignedTo ?? ''); }}
                                className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1"
                              >
                                <ArrowRightLeft className="w-3 h-3" />
                                {isAssignedScheduledVisit(route) ? 'Reassign' : 'Assign'}
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRoutes.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-stone-500">No routes match your filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : subTab === 'approvals' ? (
        <ScheduledVisitApprovalQueue
          routes={routes}
          users={users}
          hoReCas={hoReCas}
          currentUser={currentUser}
          onUpdateRoute={handleUpdateRoute}
          addToast={addToast}
        />
      ) : subTab === 'templates' ? (
        <div className="space-y-3">
          {templates.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-stone-200 border-dashed">
              <Repeat className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              <h3 className="text-lg font-display font-semibold text-stone-700">No Templates</h3>
              <p className="text-stone-500 text-sm mt-1">Create a template to auto-generate recurring routes.</p>
            </div>
          ) : (
            templates.map(tmpl => {
              const rep = tmpl.assignedTo ? userMap.get(tmpl.assignedTo) : null;
              const dayName = tmpl.recurrence ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][tmpl.recurrence.dayOfWeek] : '?';
              const stopNames = tmpl.stops.map(s => hoReCaMap.get(s.hoReCaId)?.name ?? '?').join(' → ');
              return (
                <div key={tmpl.id} className="bg-white rounded-xl border border-stone-200 p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-stone-800">{tmpl.name}</h4>
                      <div className="flex items-center gap-2 text-xs text-stone-500 mt-1">
                        <Repeat className="w-3 h-3" />
                        <span>{tmpl.recurrence?.frequency === 'biweekly' ? 'Bi-weekly' : 'Weekly'} on {dayName}</span>
                        {rep && (
                          <>
                            <span className="text-stone-300">|</span>
                            <span className="text-teal-600 font-medium">{rep.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => handleDeleteTemplate(tmpl.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-stone-500 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-stone-500 truncate">
                    <MapPin className="w-3 h-3 inline mr-1" />
                    {stopNames}
                  </p>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <ScheduledVisitTrackingMap routes={routes} hoReCas={hoReCas} users={users} visits={visits} />
      )}
    </div>
  );
};

export default ScheduledVisitsAdmin;
