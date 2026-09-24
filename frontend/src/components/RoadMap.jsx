import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

const severityColor = { High: '#dc2626', Medium: '#e8a317', Low: '#15803d' };

function pinIcon(severity) {
  const color = severityColor[severity] || '#64748b';
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export default function RoadMap({ reports, onSelect }) {
  const points = useMemo(
    () =>
      reports
        .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
        .map((r) => [r.latitude, r.longitude]),
    [reports]
  );

  const center = points[0] || [26.85, 80.95];

  return (
    <div className="panel map-panel">
      <div className="panel-head">
        <h2>Live hazard map</h2>
        <span>{points.length} pinned locations</span>
      </div>

      <div className="map">
        <MapContainer center={center} zoom={5} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} />
          {reports.map((r) =>
            Number.isFinite(r.latitude) && Number.isFinite(r.longitude) ? (
              <Marker
                key={r._id}
                position={[r.latitude, r.longitude]}
                icon={pinIcon(r.severity)}
                eventHandlers={{ click: () => onSelect?.(r) }}
              >
                <Popup>
                  <strong style={{ textTransform: 'capitalize' }}>{r.detection?.label || 'Report'}</strong>
                  <br />
                  Severity: {r.severity}
                  <br />
                  Status: {r.status}
                  <br />
                  <button
                    type="button"
                    style={{ marginTop: 8, padding: '6px 10px', fontSize: 12 }}
                    onClick={() => onSelect?.(r)}
                  >
                    Open details
                  </button>
                </Popup>
              </Marker>
            ) : null
          )}
        </MapContainer>
      </div>

      <div className="map-legend">
        <span>
          <i style={{ background: severityColor.High }} /> High
        </span>
        <span>
          <i style={{ background: severityColor.Medium }} /> Medium
        </span>
        <span>
          <i style={{ background: severityColor.Low }} /> Low
        </span>
      </div>
    </div>
  );
}
