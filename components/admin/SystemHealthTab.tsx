// Admin-only System Health tab (Audit-Log 4-file pattern).
// Live status banner (60s refetch), uptime/latency/error stat tiles, an
// inline-SVG DB-latency sparkline (no chart lib), and the recent-deployments
// list with verified badges. Footer shows the build this client is running.

import React from 'react';
import { Activity, CheckCircle2, AlertTriangle, Rocket } from 'lucide-react';
import {
  useLatestHealthCheck,
  useHealthChecks,
  useDeployments,
  useRecentClientErrorCount,
} from '@/hooks/queries/useSystemHealth';
import { uptimePercent, latencySeries, formatSha, statusTone } from './systemHealthFormat';

const SPARK_POINTS = 48;

function LatencySparkline({ points }: { points: ReturnType<typeof latencySeries> }) {
  const width = 480;
  const height = 80;
  const pad = 4;
  if (points.length < 2) {
    return (
      <div style={{ height: `${height}px` }} className="flex items-center justify-center text-xs text-stone-400">
        Not enough checks yet for a latency trend.
      </div>
    );
  }
  const max = Math.max(...points.map((p) => p.latencyMs), 1);
  const getX = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const getY = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.latencyMs)}`).join(' ');
  const areaPath = `${linePath} L ${getX(points.length - 1)} ${height - pad} L ${getX(0)} ${height - pad} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="DB latency trend">
      <defs>
        <linearGradient id="healthLatencyGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#6F7EFF" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#6F7EFF" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#healthLatencyGradient)" />
      <path d={linePath} fill="none" stroke="#007BFF" strokeWidth="2" />
    </svg>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-panel rounded-xl border border-stone-200 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-stone-900 font-mono">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
    </div>
  );
}

const SystemHealthTab: React.FC = () => {
  const { data: latest, isLoading: latestLoading } = useLatestHealthCheck();
  const { data: history = [] } = useHealthChecks(7 * 24);
  const { data: deployments = [] } = useDeployments(20);
  const { data: errorsLastHour } = useRecentClientErrorCount(60);

  const tone = statusTone(latest?.status);
  const uptime24 = uptimePercent(history, 24);
  const uptime7d = uptimePercent(history, 7 * 24);
  const spark = latencySeries(history, SPARK_POINTS);

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className={`rounded-2xl border p-5 ${tone.bg}`}>
        <div className="flex items-center gap-3">
          <span className={`inline-block h-3 w-3 rounded-full ${tone.dot}`} />
          <h2 className={`text-lg font-bold ${tone.text}`}>
            {latestLoading
              ? 'Loading system status…'
              : latest
                ? `System ${latest.status}`
                : 'No health checks recorded yet'}
          </h2>
          <Activity className={`ml-auto h-5 w-5 ${tone.text}`} />
        </div>
        {latest && (
          <p className="mt-2 text-sm text-stone-600">
            Last check {new Date(latest.checked_at).toLocaleString()} · DB{' '}
            {latest.db_latency_ms != null ? `${latest.db_latency_ms}ms` : '—'} · frontend{' '}
            {latest.frontend_ok ? `ok (${formatSha(latest.frontend_version)})` : 'unreachable'} ·{' '}
            {latest.error_count_10m} client errors / 10m
            {latest.error && <span className="block mt-1 text-xs text-stone-500">{latest.error}</span>}
          </p>
        )}
        {!latest && !latestLoading && (
          <p className="mt-2 text-sm text-stone-500">
            The health-check cron writes a row every 5 minutes once scheduled.
          </p>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Uptime 24h" value={uptime24 != null ? `${uptime24.toFixed(1)}%` : '—'} sub="checks not down" />
        <StatTile label="Uptime 7d" value={uptime7d != null ? `${uptime7d.toFixed(1)}%` : '—'} sub="checks not down" />
        <StatTile
          label="DB latency"
          value={latest?.db_latency_ms != null ? `${latest.db_latency_ms}ms` : '—'}
          sub="latest check"
        />
        <StatTile label="Client errors" value={errorsLastHour != null ? String(errorsLastHour) : '—'} sub="last hour" />
      </div>

      {/* Latency sparkline */}
      <div className="glass-panel rounded-2xl border border-stone-200 p-5">
        <h3 className="mb-3 text-sm font-semibold text-stone-700">DB latency — last 7 days</h3>
        <LatencySparkline points={spark} />
      </div>

      {/* Recent deployments */}
      <div className="glass-panel rounded-2xl border border-stone-200 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-700">
          <Rocket className="h-4 w-4" /> Recent deployments
        </h3>
        {deployments.length === 0 ? (
          <p className="text-sm text-stone-400">No deployments recorded yet — the next `npm run deploy` will appear here.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {deployments.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5 text-sm">
                {d.verified ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Verified" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="Not verified" />
                )}
                <span className="font-mono text-stone-900">{formatSha(d.commit_sha)}</span>
                <span className="text-stone-500 truncate">{d.branch ?? '—'}</span>
                <span className="ml-auto shrink-0 text-xs text-stone-400">
                  {new Date(d.deployed_at).toLocaleString()} · {d.deployer ?? 'unknown'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-center text-xs text-stone-400 font-mono">
        client build {formatSha(__APP_VERSION__)} · {__BUILD_TIME__}
      </p>
    </div>
  );
};

export default SystemHealthTab;
