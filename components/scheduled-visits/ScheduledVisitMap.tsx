import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ScheduledVisitStop, HoReCa } from '../../types';

// Fix Leaflet default marker icon issue with bundlers
const createNumberedIcon = (num: number, isVisited: boolean) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width: 28px; height: 28px; border-radius: 50%;
      background: ${isVisited ? '#059669' : '#2988de'};
      color: white; display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    ">${num}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};

interface FitBoundsProps {
  positions: [number, number][];
}

const FitBounds: React.FC<FitBoundsProps> = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
    }
  }, [map, positions]);
  return null;
};

interface RouteMapProps {
  stops: ScheduledVisitStop[];
  hoReCas: HoReCa[];
}

const ScheduledVisitMap: React.FC<RouteMapProps> = ({ stops, hoReCas }) => {
  const customerMap = new Map<number, HoReCa>(hoReCas.map(c => [c.id, c]));

  const positions: [number, number][] = stops
    .map(stop => {
      const c = customerMap.get(stop.hoReCaId);
      return c?.lat !== undefined && c?.lng !== undefined ? [c.lat, c.lng] as [number, number] : null;
    })
    .filter((p): p is [number, number] => p !== null);

  if (positions.length === 0) {
    return (
      <div className="h-64 sm:h-[400px] rounded-xl bg-stone-100 flex items-center justify-center text-stone-500 border border-stone-200 shadow-card relative z-0">
        No HoReCa locations available for map view.
      </div>
    );
  }

  const center = positions[0];

  return (
    <div className="h-64 sm:h-[400px] rounded-xl overflow-hidden border border-stone-200 shadow-card relative z-0">
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={positions} />

        {stops.map((stop, i) => {
          const customer = customerMap.get(stop.hoReCaId);
          if (!customer?.lat || !customer?.lng) return null;

          return (
            <Marker
              key={stop.hoReCaId}
              position={[customer.lat, customer.lng]}
              icon={createNumberedIcon(stop.sequence, stop.status === 'arrived')}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{stop.sequence}. {customer.name}</p>
                  <p className="text-stone-500">{customer.address}</p>
                  <p className="text-xs mt-1 capitalize">{stop.status}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {positions.length > 1 && (
          <Polyline
            positions={positions}
            pathOptions={{ color: '#2988de', weight: 3, dashArray: '8 4', opacity: 0.7 }}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default ScheduledVisitMap;
