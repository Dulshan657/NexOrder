import React, { useMemo, useState } from 'react';
import type { HoReCa, User } from '../../types';
import { useMarkHoReCaReviewed, useUpdateHoReCa } from '../../hooks/queries/useHoReCas';
import { numericIdToUuid } from '../../lib/userIdMap';
import { UserPlus, MapPin, Check, ExternalLink, Loader2, Inbox } from 'lucide-react';

interface WalkInReviewTabProps {
  hoReCas: HoReCa[];
  users: User[];
  currentUser: User;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

type FilterMode = 'unreviewed' | 'all';

const WalkInReviewTab: React.FC<WalkInReviewTabProps> = ({ hoReCas, users, currentUser, addToast }) => {
  const [filter, setFilter] = useState<FilterMode>('unreviewed');
  const [busyId, setBusyId] = useState<number | null>(null);
  const markReviewedMutation = useMarkHoReCaReviewed();
  const updateHoReCaMutation = useUpdateHoReCa();

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u] as const)), [users]);

  const walkIns = useMemo(() => {
    const all = hoReCas.filter(h => h.isTemporary || h.reviewedAt);
    const list = filter === 'unreviewed'
      ? all.filter(h => h.isTemporary && !h.reviewedAt)
      : all;
    return [...list].sort((a, b) => {
      // Unreviewed first, then newest first by id (proxy for created_at)
      if (!!a.reviewedAt !== !!b.reviewedAt) return a.reviewedAt ? 1 : -1;
      return b.id - a.id;
    });
  }, [hoReCas, filter]);

  const unreviewedCount = useMemo(
    () => hoReCas.filter(h => h.isTemporary && !h.reviewedAt).length,
    [hoReCas],
  );

  const handleMarkReviewed = async (h: HoReCa) => {
    setBusyId(h.id);
    try {
      await markReviewedMutation.mutateAsync({
        id: h.id,
        reviewerUuid: numericIdToUuid(currentUser.id),
      });
      addToast?.(`Promoted "${h.name}" to the customer list.`, 'success');
    } catch (err) {
      addToast?.(`Could not mark ${h.name} reviewed.`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleEditName = (h: HoReCa) => {
    const next = prompt('Update customer name', h.name);
    if (next == null || next.trim() === '' || next.trim() === h.name) return;
    updateHoReCaMutation.mutate(
      { id: h.id, updates: { name: next.trim() } },
      {
        onSuccess: () => addToast?.(`Renamed to "${next.trim()}".`, 'success'),
        onError: () => addToast?.(`Could not rename ${h.name}.`, 'error'),
      },
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserPlus className="w-5 h-5 text-stone-700" />
          <div>
            <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Walk-in Review</h1>
            <p className="text-sm text-stone-500">
              Temporary customers reps added during scheduled visits. Review and promote to the CRM.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('unreviewed')}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              filter === 'unreviewed'
                ? 'bg-nexgen-blue text-white'
                : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50'
            }`}
          >
            Unreviewed {unreviewedCount > 0 && `(${unreviewedCount})`}
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              filter === 'all'
                ? 'bg-nexgen-blue text-white'
                : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50'
            }`}
          >
            All walk-ins
          </button>
        </div>
      </div>

      {/* List */}
      {walkIns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center">
          <Inbox className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-500">
            {filter === 'unreviewed'
              ? 'No walk-ins waiting for review. Reps add new customers here when they visit off-list.'
              : 'No walk-in customers yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-200 divide-y divide-stone-100 overflow-hidden">
          {walkIns.map(h => {
            const creator = h.createdByUserId != null ? userMap.get(h.createdByUserId) : undefined;
            const reviewer = h.reviewedByUserId != null ? userMap.get(h.reviewedByUserId) : undefined;
            const hasCoords = h.lat != null && h.lng != null;
            const isReviewed = !!h.reviewedAt;
            const busy = busyId === h.id;

            return (
              <div key={h.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-stone-900 truncate">{h.name}</h3>
                    {!isReviewed && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        Walk-in
                      </span>
                    )}
                    {isReviewed && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                        Reviewed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 truncate mt-0.5">{h.address || 'No address'}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-stone-400">
                    {creator && <span>Added by {creator.name}</span>}
                    {hasCoords && (
                      <a
                        href={`https://www.google.com/maps?q=${h.lat},${h.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-0.5 text-stone-500 hover:text-nexgen-blue"
                      >
                        <MapPin className="w-3 h-3" /> Map
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {reviewer && h.reviewedAt && (
                      <span>Reviewed by {reviewer.name} on {new Date(h.reviewedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleEditName(h)}
                    className="text-xs font-medium text-stone-700 bg-white ring-1 ring-inset ring-stone-300 px-3 py-1.5 rounded-lg hover:bg-stone-50 transition-colors"
                  >
                    Edit name
                  </button>
                  {!isReviewed && (
                    <button
                      onClick={() => handleMarkReviewed(h)}
                      disabled={busy}
                      className="flex items-center gap-1 text-xs font-medium text-white bg-emerald-600 px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Mark reviewed
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WalkInReviewTab;
