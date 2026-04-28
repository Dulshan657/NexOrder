import React from 'react';
import type { ScheduledVisit, User, HoReCa, ScheduledVisitChangeRequest } from '../../types';
import { approveChangeRequest, rejectChangeRequest, getPendingChangeRequests } from '../../services/scheduledVisitService';
import { Check, X, ArrowUpDown, Plus, Minus, UserCheck } from 'lucide-react';

interface RouteApprovalQueueProps {
  routes: ScheduledVisit[];
  users: User[];
  hoReCas: HoReCa[];
  currentUser: User;
  onUpdateRoute: (route: ScheduledVisit) => void;
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const CHANGE_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  reorder: { label: 'Reorder Stops', icon: <ArrowUpDown className="w-4 h-4" />, color: 'text-blue-700 bg-blue-50 border-blue-200' },
  add_stop: { label: 'Add Stop', icon: <Plus className="w-4 h-4" />, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  remove_stop: { label: 'Remove Stop', icon: <Minus className="w-4 h-4" />, color: 'text-red-700 bg-red-50 border-red-200' },
};

const ScheduledVisitApprovalQueue: React.FC<RouteApprovalQueueProps> = ({ routes, users, hoReCas, currentUser, onUpdateRoute, addToast }) => {
  const userMap = new Map<number, User>(users.map(u => [u.id, u]));
  const hoReCaMap = new Map<number, HoReCa>(hoReCas.map(h => [h.id, h]));
  const pending = getPendingChangeRequests(routes);

  const handleApprove = (route: ScheduledVisit, requestId: string) => {
    const updated = approveChangeRequest(route, requestId, currentUser.id);
    onUpdateRoute(updated);
    addToast('Change request approved', 'success');
  };

  const handleReject = (route: ScheduledVisit, requestId: string) => {
    const updated = rejectChangeRequest(route, requestId, currentUser.id);
    onUpdateRoute(updated);
    addToast('Change request rejected', 'info');
  };

  const renderPayloadDetail = (request: ScheduledVisitChangeRequest) => {
    if (request.type === 'reorder') {
      const payload = request.payload as { newStopOrder: number[] };
      return (
        <p className="text-xs text-stone-500 mt-1">
          New order: {payload.newStopOrder.map(id => hoReCaMap.get(id)?.name ?? `#${id}`).join(' → ')}
        </p>
      );
    }
    if (request.type === 'add_stop') {
      const payload = request.payload as { hoReCaId: number; atIndex?: number };
      const name = hoReCaMap.get(payload.hoReCaId)?.name ?? `#${payload.hoReCaId}`;
      return <p className="text-xs text-stone-500 mt-1">Add: {name}{payload.atIndex !== undefined ? ` at position ${payload.atIndex + 1}` : ''}</p>;
    }
    if (request.type === 'remove_stop') {
      const payload = request.payload as { hoReCaId: number };
      const name = hoReCaMap.get(payload.hoReCaId)?.name ?? `#${payload.hoReCaId}`;
      return <p className="text-xs text-stone-500 mt-1">Remove: {name}</p>;
    }
    return null;
  };

  if (pending.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-stone-200 border-dashed">
        <UserCheck className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <h3 className="text-lg font-display font-semibold text-stone-700">No Pending Requests</h3>
        <p className="text-stone-500 text-sm mt-1">All change requests have been reviewed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">{pending.length} pending request{pending.length !== 1 ? 's' : ''}</p>
      {pending.map(({ route, request }) => {
        const rep = userMap.get(request.requestedBy);
        const config = CHANGE_TYPE_CONFIG[request.type];

        return (
          <div key={request.id} className="bg-white rounded-xl border border-stone-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-semibold text-stone-800">{route.name}</h4>
                <p className="text-xs text-stone-500 mt-0.5">
                  Requested by <span className="font-medium">{rep?.name ?? 'Unknown'}</span> · {new Date(request.requestedAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${config.color}`}>
                {config.icon}
                {config.label}
              </span>
            </div>
            <p className="text-sm text-stone-600 mb-1">{request.description}</p>
            {renderPayloadDetail(request)}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-stone-100">
              <button
                onClick={() => handleReject(route, request.id)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Reject
              </button>
              <button
                onClick={() => handleApprove(route, request.id)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
              >
                <Check className="w-4 h-4" />
                Approve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ScheduledVisitApprovalQueue;
