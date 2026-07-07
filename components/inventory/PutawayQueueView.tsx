// Standing queue of pending putaway recommendations for a warehouse (rows the
// engine produced at receipt time but nobody has actioned yet). Each row shows
// the recommended bin with an Accept action and an inline "Why?" explanation.

import React, { useMemo, useState } from 'react';
import { PackageOpen, Check, HelpCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getPendingPutaways } from '../../services/supabase/putawayQueueService';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useDecidePutaway } from '../../hooks/queries/usePutawayRecommendation';
import { useToasts } from '../../hooks/useToasts';
import { PutawayExplanationCard } from './PutawayExplanationCard';

interface PutawayQueueViewProps {
  warehouseId: number;
  /** Optional product-name lookup; falls back to `Product #id`. */
  productNameById?: Map<number, string>;
}

const PutawayQueueView: React.FC<PutawayQueueViewProps> = ({ warehouseId, productNameById }) => {
  const queueQuery = useQuery({
    queryKey: ['putaway-queue', warehouseId],
    queryFn: () => getPendingPutaways(warehouseId),
    enabled: warehouseId != null,
  });
  const locationsQuery = useWarehouseLocations(warehouseId);
  const decide = useDecidePutaway();
  const { addToast } = useToasts();
  const [expanded, setExpanded] = useState<number | null>(null);

  const codeById = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of locationsQuery.data ?? []) m.set(l.id, l.code);
    return m;
  }, [locationsQuery.data]);

  const rows = queueQuery.data ?? [];

  const accept = async (id: number) => {
    try {
      await decide.mutateAsync({ recommendationId: id, decision: 'accept' });
      await queueQuery.refetch();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to put away', 'error');
    }
  };

  const productName = (id: number) => productNameById?.get(id) ?? `Product #${id}`;

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-50">
          <PackageOpen className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Putaway</h1>
          <p className="text-xs text-stone-500 mt-0.5">Pending bin recommendations waiting to be put away.</p>
        </div>
      </div>

      {queueQuery.isLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
        </div>
      ) : queueQuery.isError ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-sm text-red-600">Couldn't load the putaway queue.</p>
          <p className="text-xs text-stone-400 mt-1">Check your connection and try again.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">Nothing to put away</p>
          <p className="text-xs text-stone-400 mt-1">Recommendations from received stock will appear here.</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl divide-y divide-stone-100 overflow-hidden">
          {rows.map((r) => {
            const recCode = r.recommendedLocationId ? codeById.get(r.recommendedLocationId) ?? `#${r.recommendedLocationId}` : null;
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-800 truncate">{productName(r.productId)}</p>
                    <p className="text-xs text-stone-400">
                      {r.quantity} units →{' '}
                      {recCode ? <span className="font-mono text-emerald-600">{recCode}</span> : <span className="text-amber-600">no eligible bin</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      className="p-1.5 rounded-lg hover:bg-stone-100 btn-press"
                      aria-label="Why this bin?"
                    >
                      <HelpCircle className="w-4 h-4 text-stone-400" />
                    </button>
                    <button
                      onClick={() => accept(r.id)}
                      disabled={!r.recommendedLocationId || decide.isPending}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                  </div>
                </div>

                {expanded === r.id && (
                  <div className="mt-3 pl-1">
                    <PutawayExplanationCard explanation={r.explanation} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PutawayQueueView;
