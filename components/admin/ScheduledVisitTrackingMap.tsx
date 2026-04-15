import React, { useState, useEffect, useRef } from 'react';
import type { ScheduledVisit, HoReCa, User, Visit, MockRepPosition } from '../../types';
import { simulateRepPosition } from '../../services/scheduledVisitService';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Play, CheckCircle2, MapPin } from 'lucide-react';
import ScheduledVisitTrackingDetail from './ScheduledVisitTrackingDetail';

interface RouteTrackingMapProps {
  routes: ScheduledVisit[];
  hoReCas: HoReCa[];
  users: User[];
  visits?: Visit[];
}

const REP_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

const STOP_ICONS = {
  pending: (seq: number) =>
    L.divIcon({
      className: '',
      html: `<div style="width:24px;height:24px;border-radius:50%;background:#3b82f6;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${seq}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
  arrived: (seq: number) =>
    L.divIcon({
      className: '',
      html: `<div style="width:24px;height:24px;border-radius:50%;background:#10b981;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${seq}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
  skipped: (seq: number) =>
    L.divIcon({
      className: '',
      html: `<div style="width:24px;height:24px;border-radius:50%;background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${seq}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
};

function repIcon(initial: string, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;border:3px solid #fff;box-shadow:0 0 0 2px ${color},0 2px 8px rgba(0,0,0,.3);animation:pulse 2s ease-in-out infinite">${initial}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40] });
    }
  }, [positions, map]);
  return null;
}

const ScheduledVisitTrackingMap: React.FC<RouteTrackingMapProps> = ({ routes, hoReCas, users, visits = [] }) => {
  const hoReCaMap = new Map(hoReCas.map(h => [h.id, h]));
  const userMap = new Map(users.map(u => [u.id, u]));

  const activeRoutes = routes.filter(r => r.status === 'in_progress' && !r.isTemplate);
  const [selectedTrackingRouteId, setSelectedTrackingRouteId] = useState<string | null>(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(10); // Start 10 min in so there's visible progress
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsedMinutes(prev => prev + 1);
    }, 3000); // 3 real seconds = 1 simulated minute
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Compute positions for all active routes
  const repPositions: MockRepPosition[] = activeRoutes
    .map(r => simulateRepPosition(r, hoReCas, elapsedMinutes))
    .filter((p): p is MockRepPosition => p !== null);

  // Selected route drill-down data
  const selectedTrackingRoute = selectedTrackingRouteId
    ? activeRoutes.find(r => r.id === selectedTrackingRouteId) ?? null
    : null;
  const selectedRepPosition = selectedTrackingRoute
    ? simulateRepPosition(selectedTrackingRoute, hoReCas, elapsedMinutes)
    : null;
  const routeVisits = selectedTrackingRoute
    ? visits.filter(v => v.scheduledVisitId === selectedTrackingRoute.id)
    : [];

  // All positions for bounds fitting (scope to selected route when drilled in)
  const allPositions: [number, number][] = [];
  const routesToShow = selectedTrackingRoute ? [selectedTrackingRoute] : activeRoutes;
  routesToShow.forEach(r => {
    r.stops.forEach(s => {
      const h = hoReCaMap.get(s.hoReCaId);
      if (h?.lat && h?.lng) allPositions.push([h.lat, h.lng]);
    });
  });
  if (selectedRepPosition) {
    allPositions.push([selectedRepPosition.lat, selectedRepPosition.lng]);
  } else {
    repPositions.forEach(p => allPositions.push([p.lat, p.lng]));
  }

  const defaultCenter: [number, number] = allPositions.length > 0
    ? [allPositions.reduce((s, p) => s + p[0], 0) / allPositions.length, allPositions.reduce((s, p) => s + p[1], 0) / allPositions.length]
    : [-33.87, 151.21];

  if (activeRoutes.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-stone-200 border-dashed">
        <MapPin className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <h3 className="text-lg font-display font-semibold text-stone-700">No Active Scheduled Visits</h3>
        <p className="text-stone-500 text-sm mt-1">Scheduled visits that are in progress will appear here with live tracking.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[500px]">
      {/* Sidebar */}
      <div className={`${selectedTrackingRoute ? 'w-80' : 'w-64'} flex-shrink-0 overflow-hidden flex flex-col transition-all duration-200 bg-white rounded-xl border border-stone-200`}>
        {selectedTrackingRoute ? (
          <ScheduledVisitTrackingDetail
            route={selectedTrackingRoute}
            hoReCas={hoReCas}
            users={users}
            visits={routeVisits}
            repPosition={selectedRepPosition}
            elapsedMinutes={elapsedMinutes}
            onBack={() => setSelectedTrackingRouteId(null)}
          />
        ) : (
          <div className="p-3 space-y-3 overflow-y-auto">
            <h3 className="text-sm font-semibold text-stone-700">Active Scheduled Visits</h3>
            {activeRoutes.map((route, i) => {
              const rep = userMap.get(route.assignedTo ?? route.createdBy);
              const completed = route.stops.filter(s => s.status !== 'pending').length;
              const color = REP_COLORS[i % REP_COLORS.length];
              return (
                <button
                  key={route.id}
                  onClick={() => setSelectedTrackingRouteId(route.id)}
                  className="w-full text-left bg-white rounded-lg border border-stone-200 p-3 cursor-pointer hover:border-nexgen-blue/30 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <p className="text-sm font-medium text-stone-800 truncate">{route.name}</p>
                  </div>
                  <p className="text-xs text-stone-500">{rep?.name ?? 'Unknown rep'}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${route.stops.length > 0 ? (completed / route.stops.length) * 100 : 0}%` }} />
                    </div>
                    <span className="text-xs text-stone-500">{completed}/{route.stops.length}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 rounded-xl overflow-hidden border border-stone-200 relative z-0">
        <MapContainer center={defaultCenter} zoom={12} className="w-full h-full" scrollWheelZoom>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OSM' />
          {allPositions.length > 0 && <FitBounds positions={allPositions} />}

          {activeRoutes.map((route, scheduledVisitIdx) => {
            const color = REP_COLORS[scheduledVisitIdx % REP_COLORS.length];
            const coords: [number, number][] = route.stops
              .map(s => {
                const h = hoReCaMap.get(s.hoReCaId);
                return h?.lat && h?.lng ? [h.lat, h.lng] as [number, number] : null;
              })
              .filter((c): c is [number, number] => c !== null);

            return (
              <React.Fragment key={route.id}>
                <Polyline positions={coords} pathOptions={{ color, weight: 3, dashArray: '8 4', opacity: 0.7 }} />
                {route.stops.map((stop, si) => {
                  const h = hoReCaMap.get(stop.hoReCaId);
                  if (!h?.lat || !h?.lng) return null;
                  const icon = STOP_ICONS[stop.status](stop.sequence);
                  return (
                    <Marker key={`${route.id}-${stop.hoReCaId}`} position={[h.lat, h.lng]} icon={icon}>
                      <Popup>
                        <strong>{h.name}</strong><br />
                        Stop {stop.sequence} · {stop.status === 'arrived' ? 'Visited' : stop.status === 'skipped' ? 'Skipped' : 'Pending'}
                      </Popup>
                    </Marker>
                  );
                })}
              </React.Fragment>
            );
          })}

          {/* Rep position markers */}
          {repPositions.map((pos, i) => {
            const rep = userMap.get(pos.userId);
            const initial = rep?.name?.charAt(0) ?? '?';
            const color = REP_COLORS[i % REP_COLORS.length];
            return (
              <Marker key={`rep-${pos.userId}`} position={[pos.lat, pos.lng]} icon={repIcon(initial, color)}>
                <Popup>
                  <strong>{rep?.name ?? 'Unknown'}</strong><br />
                  En route · Stop {(pos.currentStopIndex ?? 0) + 1}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};

export default ScheduledVisitTrackingMap;
