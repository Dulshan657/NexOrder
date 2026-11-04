import { useEffect, useMemo, useState } from 'react';
import { dashboardRange, type DashboardPeriod, type DashboardRange } from '../lib/period';

const TICK_MS = 60_000;

/**
 * The Admin Dashboard's period range, kept current while the page stays open.
 *
 * The comparison window stops at "the same time of day" (NX-0010), so a range
 * worked out once, when the page opened, would compare an afternoon's orders
 * with "yesterday until 9 am" and the arrows would drift upward. The clock ticks
 * once a minute; the range object only changes on a tick or an input change, so
 * the memos downstream do not recompute on every render.
 */
export function useDashboardRange(period: DashboardPeriod, customStart?: string, customEnd?: string): DashboardRange {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  return useMemo(
    () => dashboardRange(period, now, customStart, customEnd),
    [period, now, customStart, customEnd],
  );
}
