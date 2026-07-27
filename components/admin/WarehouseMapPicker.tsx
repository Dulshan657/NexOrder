import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const pinIcon = L.divIcon({
  className: 'wh-pin-marker',
  html: `<div style="
    width: 26px; height: 26px; border-radius: 50% 50% 50% 0;
    background: #2E86DE; border: 2px solid white; transform: rotate(-45deg);
    box-shadow: 0 2px 5px rgba(0,0,0,0.35);
  "></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

const ClickHandler: React.FC<{ onPick: (lat: number, lng: number) => void }> = ({ onPick }) => {
  useMapEvents({
    click(e) {
      onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    },
  });
  return null;
};

/** Leaflet measures its container once, at mount. Inside a modal the panel is still
 *  animating (and in a sheet, still zero-width), so tiles lay out against the wrong
 *  size and render grey. Re-measure whenever the container resizes. */
const AutoResize: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
};

interface WarehouseMapPickerProps {
  lat?: number;
  lng?: number;
  onChange: (lat: number, lng: number) => void;
}

/** Click anywhere on the map to set the warehouse coordinates (used for
 * closest-warehouse order routing). Falls back to a wide Australia view when no
 * coordinates are set yet. */
const WarehouseMapPicker: React.FC<WarehouseMapPickerProps> = ({ lat, lng, onChange }) => {
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const center: [number, number] = hasCoords ? [lat as number, lng as number] : [-25.27, 133.78];

  return (
    <div className="h-56 rounded-lg overflow-hidden border border-stone-200 relative z-0">
      <MapContainer center={center} zoom={hasCoords ? 11 : 4} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <AutoResize />
        <ClickHandler onPick={onChange} />
        {hasCoords && <Marker position={[lat as number, lng as number]} icon={pinIcon} />}
      </MapContainer>
    </div>
  );
};

export default WarehouseMapPicker;
