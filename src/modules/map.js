import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatDMS } from "./geo.js";
let map, clickMarker, prediction, hull, comparisons, selection, records;
const icon = (text, color = "#22d3ee") =>
  L.divIcon({
    className: "map-label",
    html: `<span style="background:${color}">${text}</span>`,
    iconSize: [44, 24],
    iconAnchor: [22, 12],
  });
export async function initMap(id, onMapClick) {
  map = L.map(id).setView([36.023, 129.419], 11);
  L.tileLayer(
    import.meta.env.VITE_TILE_URL ||
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  ).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  prediction = L.layerGroup().addTo(map);
  hull = L.layerGroup().addTo(map);
  comparisons = L.layerGroup().addTo(map);
  selection = L.layerGroup().addTo(map);
  records = L.layerGroup().addTo(map);
  clickMarker = L.circleMarker([36.023, 129.419], {
    radius: 7,
    color: "#22d3ee",
    fillOpacity: 1,
  }).addTo(map);
  map.on("click", (e) => onMapClick(e.latlng.lat, e.latlng.lng));
  return map;
}
export function setMarkerPosition(lat, lon) {
  clickMarker?.setLatLng([lat, lon]);
}
export function centerMap(lat, lon) {
  map?.panTo([lat, lon]);
}
export function renderPredictionPath({
  pathPoints,
  hourlyRadii,
  strandedAt,
  finalErrorRadius,
}) {
  clearPrediction();
  const path = pathPoints.map((p) => [p.lat, p.lon]);
  L.polyline(path, { color: "#00a9bd", weight: 4 }).addTo(prediction);
  pathPoints.forEach((p, i) => {
    if (i === 0) return;
    L.circle([p.lat, p.lon], {
      radius: hourlyRadii[i],
      color: "#ef6666",
      weight: 1,
      fillOpacity: 0.03,
    }).addTo(prediction);
    L.marker([p.lat, p.lon], { icon: icon(`${i}h`) }).addTo(prediction);
  });
  const end = path.at(-1);
  const finalCircle = L.circle(end, {
    radius: finalErrorRadius,
    color: "#ef6666",
    weight: 2,
    fillOpacity: 0.08,
  }).addTo(prediction);
  L.marker(end, {
    icon: icon(strandedAt !== null ? "해안 도달" : "종료점", "#ff7777"),
  }).addTo(prediction);
  const bounds = L.latLngBounds(path);
  bounds.extend(finalCircle.getBounds());
  map.fitBounds(bounds.pad(0.2), { maxZoom: 15 });
}
export function renderMonteCarloHull(feature) {
  hull.clearLayers();
  if (feature)
    L.geoJSON(feature, {
      style: { color: "#9467d7", weight: 2, fillOpacity: 0.1 },
    }).addTo(hull);
}
export function renderComparisonPolylines({ hfPathLatLon, romsPathLatLon }) {
  comparisons.clearLayers();
  for (const [p, color] of [
    [hfPathLatLon, "#f99f1c"],
    [romsPathLatLon, "#9467d7"],
  ])
    if (p?.length > 1)
      L.polyline(
        p.map((v) => [v.lat, v.lon]),
        { color, dashArray: "5 5" },
      ).addTo(comparisons);
}
export function showTimePosition(p) {
  selection.clearLayers();
  if (!p) return;
  L.circle([p.lat, p.lon], {
    radius: p.radius,
    color: "#ffd166",
    weight: 3,
    fillOpacity: 0.12,
  }).addTo(selection);
  L.marker([p.lat, p.lon], { icon: icon("선택", "#ffd166") })
    .addTo(selection)
    .bindTooltip(formatDMS(p.lat, p.lon));
  map.panTo([p.lat, p.lon]);
}
export function renderRecords(observations, searches) {
  records.clearLayers();
  for (const r of observations)
    L.circleMarker([r.lat, r.lon], {
      radius: 6,
      color: "#ffbf47",
      fillOpacity: 1,
    })
      .addTo(records)
      .bindTooltip(document.createTextNode(`목격 ${formatDMS(r.lat, r.lon)}`));
  for (const r of searches)
    L.circle([r.lat, r.lon], {
      radius: r.radius,
      color: "#25b389",
      dashArray: "6 4",
      fillOpacity: 0.12,
    })
      .addTo(records)
      .bindTooltip(document.createTextNode(`${r.method} / ${r.result}`));
}
export function clearPrediction() {
  prediction?.clearLayers();
  hull?.clearLayers();
  comparisons?.clearLayers();
  selection?.clearLayers();
}
export function resetMapView() {
  clearPrediction();
  map?.setView([36.023, 129.419], 11);
  setMarkerPosition(36.023, 129.419);
}
