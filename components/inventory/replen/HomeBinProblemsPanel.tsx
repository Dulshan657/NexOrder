// "Home bin problems" -- every product home bin putaway cannot actually use.
//
// Since NX-0032 putaway must send a product to its home bin while the home has
// room, so a home it can never use (retired, in a hold zone, on a level that
// takes no cartons, off the published layout, full, ...) strands the floor: the
// app says "put it there" and the planner would never have offered it. This lists
// each one with the reason, so it is fixed here, before a worker finds out.
//
// The check itself runs on the server (home-bin-health); the same answer is what
// `npm run check:home-bins` prints before a release.

import React from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useHomeBinHealth } from '../../../hooks/queries/useHomeBinHealth';

interface HomeBinProblemsPanelProps {
  warehouseId: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const HomeBinProblemsPanel: React.FC<HomeBinProblemsPanelProps> = ({ warehouseId }) => {
  const { data, isLoading, isFetching, error, refetch } = useHomeBinHealth(warehouseId);

  const rows = data?.rows ?? [];
  const checked = data?.checked ?? 0;

  return (
    <section
      aria-labelledby={`home-bin-problems-${warehouseId}`}
      className="glass-card rounded-xl p-3 space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`home-bin-problems-${warehouseId}`} className="text-sm font-semibold text-stone-800">
          Home bin problems
        </h3>
        {data && rows.length > 0 && (
          <span className="text-xs text-amber-700">
            {rows.length} of {plural(checked, 'home bin')} need attention
          </span>
        )}
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 touch-target-y rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 btn-press disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Check again
        </button>
      </div>

      {isLoading && <p className="text-xs text-stone-500">Checking home bins…</p>}

      {!isLoading && error && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-red-600">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error instanceof Error ? error.message : 'Could not check the home bins'}</span>
          <button type="button" onClick={() => refetch()} className="underline">
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && data && rows.length === 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>No problems</span>
          <span className="text-stone-400">· {plural(checked, 'home bin')} checked</span>
        </p>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <ul className="divide-y divide-stone-100 max-h-72 overflow-y-auto">
          {rows.map((row) => (
            <li key={`${row.productId}:${row.binId}`} data-home={row.binId} className="py-2">
              <p className="text-xs">
                <span className="font-medium text-stone-900">{row.sku}</span>
                <span className="text-stone-500"> · bin </span>
                <span className="font-mono text-stone-700">{row.binCode}</span>
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {row.problems.map((problem) => (
                  <li key={problem.code} className="flex gap-1.5 text-[11px] text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" aria-hidden="true" />
                    <span>{problem.message}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default HomeBinProblemsPanel;
