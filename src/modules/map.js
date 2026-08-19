// ==========================================================================
// 카카오맵 렌더링 전담 모듈
// ※ kakao.maps SDK는 index.html의 <script> 태그로 전역 로드되므로 import하지
//   않는다 (npm 패키지가 아니라 외부 스크립트다). window.kakao를 그대로 쓴다.
// ==========================================================================

let map = null;
let clickMarker = null;
let currentPolyline = null;
let currentCircles = [];
let currentMarkers = [];
let currentRectangle = null;
let monteCarloHullOverlay = null;
let hfComparisonPolyline = null;
let romsComparisonPolyline = null;

export function initMap(containerId, onMapClick) {
  return new Promise((resolve) => {
    window.kakao.maps.load(() => {
      const container = document.getElementById(containerId);
      map = new window.kakao.maps.Map(container, { center: new window.kakao.maps.LatLng(36.023, 129.419), level: 8 });
      clickMarker = new window.kakao.maps.Marker({ position: map.getCenter() });
      clickMarker.setMap(map);

      window.kakao.maps.event.addListener(map, 'click', (mouseEvent) => {
        onMapClick(mouseEvent.latLng.getLat(), mouseEvent.latLng.getLng());
      });
      resolve(map);
    });
  });
}

export function setMarkerPosition(lat, lon) {
  const pos = new window.kakao.maps.LatLng(lat, lon);
  clickMarker.setPosition(pos);
  return pos;
}

export function centerMap(lat, lon, level) {
  map.setCenter(new window.kakao.maps.LatLng(lat, lon));
  if (level) map.setLevel(level);
}

function animateCircleFade(circle, targetOpacity, steps = 10, durationMs = 400) {
  let step = 0;
  const interval = setInterval(() => {
    step++;
    circle.setOptions({ fillOpacity: (targetOpacity * step) / steps });
    if (step >= steps) clearInterval(interval);
  }, durationMs / steps);
}

// 예측 결과 전체(경로선/오차원/시간마커/사각형/최종핀)를 지도에 그린다.
export function renderPredictionPath({ startLat, startLon, pathPoints, hourlyRadii, strandedAt, finalErrorRadius }) {
  clearPrediction();

  const start = new window.kakao.maps.LatLng(startLat, startLon);
  clickMarker.setPosition(start);

  currentPolyline = new window.kakao.maps.Polyline({ path: [start], strokeWeight: 3, strokeColor: '#22D3EE', strokeOpacity: 0.9 });
  currentPolyline.setMap(map);
  const fullPath = [start, ...pathPoints.slice(1).map((p) => new window.kakao.maps.LatLng(p.lat, p.lon))];
  fullPath.forEach((pos, idx) => {
    setTimeout(() => currentPolyline.setPath(fullPath.slice(0, idx + 1)), idx * 140);
  });

  pathPoints.slice(1).forEach((p, idx) => {
    const hourNum = idx + 1;
    const r = hourlyRadii[hourNum] ?? 0;
    const isFinal = hourNum === (pathPoints.length - 1);
    const pos = new window.kakao.maps.LatLng(p.lat, p.lon);

    const c = new window.kakao.maps.Circle({
      center: pos, radius: r, strokeWeight: 1, strokeColor: '#FF5C5C', strokeOpacity: 0.6, strokeStyle: 'shortdash',
      fillColor: '#FF5C5C', fillOpacity: 0,
    });
    c.setMap(map);
    currentCircles.push(c);
    setTimeout(() => animateCircleFade(c, isFinal ? 0.2 : 0.06), idx * 140);

    const label = new window.kakao.maps.CustomOverlay({
      position: pos, content: `<div class="hour-marker bounce-in">${hourNum}h</div>`, yAnchor: 1.6,
    });
    setTimeout(() => label.setMap(map), idx * 140);
    currentMarkers.push(label);
  });

  const finalPoint = pathPoints[pathPoints.length - 1];
  const finalPos = new window.kakao.maps.LatLng(finalPoint.lat, finalPoint.lon);
  const finalPin = new window.kakao.maps.CustomOverlay({
    position: finalPos,
    content: `<div class="final-pin bounce-in">
                 <svg width="28" height="38" viewBox="0 0 28 38"><path d="M14 0C6 0 0 6.2 0 13.8 0 24 14 38 14 38s14-14 14-24.2C28 6.2 22 0 14 0z" fill="#FF5C5C" stroke="#06222E" stroke-width="1"/><circle cx="14" cy="14" r="5" fill="#06222E"/></svg>
                 <div class="final-pin-label">${strandedAt ? `해안 도달 예상지점 (${strandedAt}h)` : '예상 최종지점'}</div>
               </div>`,
    yAnchor: 1, zIndex: 20,
  });
  setTimeout(() => finalPin.setMap(map), fullPath.length * 140 + 100);
  currentMarkers.push(finalPin);

  const innerCircle = new window.kakao.maps.Circle({
    center: finalPos, radius: Math.round(finalErrorRadius * 0.5),
    strokeWeight: 1.5, strokeColor: '#22D3EE', strokeOpacity: 0.7, strokeStyle: 'solid', fillColor: '#22D3EE', fillOpacity: 0,
  });
  innerCircle.setMap(map);
  currentCircles.push(innerCircle);

  const outerCircle = new window.kakao.maps.Circle({
    center: finalPos, radius: finalErrorRadius,
    strokeWeight: 2.6, strokeColor: '#FF5C5C', strokeOpacity: 0.9, strokeStyle: 'solid', fillColor: '#FF5C5C', fillOpacity: 0,
  });
  outerCircle.setMap(map);
  currentCircles.push(outerCircle);

  setTimeout(() => {
    animateCircleFade(innerCircle, 0.14);
    animateCircleFade(outerCircle, 0.16);
  }, fullPath.length * 140);

  const latOffset = finalErrorRadius / 111000;
  const lonOffset = finalErrorRadius / (111000 * Math.cos((finalPoint.lat * Math.PI) / 180));
  currentRectangle = new window.kakao.maps.Rectangle({
    bounds: new window.kakao.maps.LatLngBounds(
      new window.kakao.maps.LatLng(finalPoint.lat - latOffset, finalPoint.lon - lonOffset),
      new window.kakao.maps.LatLng(finalPoint.lat + latOffset, finalPoint.lon + lonOffset)
    ),
    strokeWeight: 2, strokeColor: '#22D3EE', strokeOpacity: 0.6, strokeStyle: 'solid', fillColor: '#22D3EE', fillOpacity: 0.03,
  });
  currentRectangle.setMap(map);

  centerMap(startLat, startLon, 9);
  return { animationDurationMs: fullPath.length * 140 };
}

export function renderMonteCarloHull(hullFeature) {
  if (!hullFeature || !hullFeature.geometry) return;
  const coords = hullFeature.geometry.coordinates[0];
  const path = coords.map((c) => new window.kakao.maps.LatLng(c[1], c[0]));
  if (monteCarloHullOverlay) monteCarloHullOverlay.setMap(null);
  monteCarloHullOverlay = new window.kakao.maps.Polygon({
    path, strokeWeight: 2, strokeColor: '#A78BFA', strokeOpacity: 0.85, strokeStyle: 'solid', fillColor: '#A78BFA', fillOpacity: 0.12,
  });
  monteCarloHullOverlay.setMap(map);
}

export function renderComparisonPolylines({ hfPathLatLon, romsPathLatLon }) {
  if (hfComparisonPolyline) { hfComparisonPolyline.setMap(null); hfComparisonPolyline = null; }
  if (romsComparisonPolyline) { romsComparisonPolyline.setMap(null); romsComparisonPolyline = null; }

  if (hfPathLatLon && hfPathLatLon.length > 1) {
    hfComparisonPolyline = new window.kakao.maps.Polyline({
      path: hfPathLatLon.map((p) => new window.kakao.maps.LatLng(p.lat, p.lon)),
      strokeWeight: 2.5, strokeColor: '#FF9F1C', strokeOpacity: 0.85, strokeStyle: 'shortdash',
    });
    hfComparisonPolyline.setMap(map);
  }
  if (romsPathLatLon && romsPathLatLon.length > 1) {
    romsComparisonPolyline = new window.kakao.maps.Polyline({
      path: romsPathLatLon.map((p) => new window.kakao.maps.LatLng(p.lat, p.lon)),
      strokeWeight: 2.5, strokeColor: '#A78BFA', strokeOpacity: 0.85, strokeStyle: 'shortdash',
    });
    romsComparisonPolyline.setMap(map);
  }
}

export function clearPrediction() {
  if (currentPolyline) { currentPolyline.setMap(null); currentPolyline = null; }
  currentCircles.forEach((c) => c.setMap(null)); currentCircles = [];
  currentMarkers.forEach((m) => m.setMap(null)); currentMarkers = [];
  if (currentRectangle) { currentRectangle.setMap(null); currentRectangle = null; }
  if (monteCarloHullOverlay) { monteCarloHullOverlay.setMap(null); monteCarloHullOverlay = null; }
  if (hfComparisonPolyline) { hfComparisonPolyline.setMap(null); hfComparisonPolyline = null; }
  if (romsComparisonPolyline) { romsComparisonPolyline.setMap(null); romsComparisonPolyline = null; }
}

export function resetMapView() {
  clearPrediction();
  const defaultPos = new window.kakao.maps.LatLng(36.023, 129.419);
  clickMarker.setPosition(defaultPos);
  centerMap(36.023, 129.419, 8);
}
