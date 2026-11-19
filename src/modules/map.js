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

// 지도가 실제로 떠 있는지. 오프라인이거나 카카오 SDK가 차단되면 false -
// 이때 아래 렌더 함수들은 조용히 아무것도 안 하고, 예측 계산·결과 카드는 그대로 동작한다.
export function isMapReady() {
  return !!map;
}

export function getMap() {
  return map;
}

// 카카오 SDK를 동적으로 불러온다. Netlify 환경변수 VITE_KAKAO_KEY(새 키)를 먼저 쓰고,
// 그 키가 아직 도메인 등록 전이라 거부되면 기존 키로 다시 시도한다.
const LEGACY_KAKAO_KEY = '7cf14f6520831fe7a42b307b25e72103';
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('load fail')); };
    document.head.appendChild(s);
  });
}
async function loadKakaoSdk() {
  if (window.kakao && window.kakao.maps) return true;
  const keys = [import.meta.env.VITE_KAKAO_KEY, LEGACY_KAKAO_KEY].filter(Boolean);
  for (const key of [...new Set(keys)]) {
    try {
      await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`);
      if (window.kakao && window.kakao.maps) return true;
    } catch { /* 다음 키 시도 */ }
  }
  return false;
}

export function setMapType(satellite) {
  if (!map) return;
  map.setMapTypeId(satellite ? window.kakao.maps.MapTypeId.HYBRID : window.kakao.maps.MapTypeId.ROADMAP);
}

export async function initMap(containerId, onMapClick) {
  await loadKakaoSdk();
  return new Promise((resolve) => {
    if (!window.kakao || !window.kakao.maps) { resolve(null); return; }
    window.kakao.maps.load(() => {
      const container = document.getElementById(containerId);
      map = new window.kakao.maps.Map(container, { center: new window.kakao.maps.LatLng(36.05, 129.45), level: 8 });
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
  if (!map) return;
  const pos = new window.kakao.maps.LatLng(lat, lon);
  clickMarker.setPosition(pos);
  return pos;
}

export function centerMap(lat, lon, level) {
  if (!map) return;
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
  if (!map) return;
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

  // 오차반경 원(계산식 기준)은 얇은 점선으로만 - 실제 수색구역은 몬테카를로 50%·90% 구역으로 표시
  const outerCircle = new window.kakao.maps.Circle({
    center: finalPos, radius: finalErrorRadius,
    strokeWeight: 1.5, strokeColor: '#FF5C5C', strokeOpacity: 0.7, strokeStyle: 'shortdash', fillColor: '#FF5C5C', fillOpacity: 0,
  });
  outerCircle.setMap(map);
  currentCircles.push(outerCircle);

  centerMap(startLat, startLon, 9);
  return { animationDurationMs: fullPath.length * 140 };
}

// 확률 수색구역: 90%(빨강, 2차) 위에 50%(노랑, 1차)를 겹쳐 그리고, 기준점(datum)에 표시
let regionOverlays = [];
export function renderSearchRegions(regions) {
  if (!map || !regions) return;
  regionOverlays.forEach((o) => o.setMap(null));
  regionOverlays = [];
  const poly = (f, color, fill, weight) => {
    if (!f || !f.geometry) return;
    const path = f.geometry.coordinates[0].map((c) => new window.kakao.maps.LatLng(c[1], c[0]));
    const pg = new window.kakao.maps.Polygon({ path, strokeWeight: weight, strokeColor: color, strokeOpacity: 0.95, strokeStyle: 'solid', fillColor: color, fillOpacity: fill });
    pg.setMap(map);
    regionOverlays.push(pg);
  };
  poly(regions.r90, '#FF5C5C', 0.10, 2.5);
  poly(regions.r50, '#FBBF24', 0.22, 2.5);
  const c = new window.kakao.maps.LatLng(regions.center.lat, regions.center.lon);
  const mark = new window.kakao.maps.CustomOverlay({ position: c, content: '<div class="datum-mark">✚ 수색 기준점</div>', yAnchor: 0.5, zIndex: 25 });
  mark.setMap(map);
  regionOverlays.push(mark);
  // 90% 구역이 화면에 다 들어오게
  const bounds = new window.kakao.maps.LatLngBounds();
  (regions.r90 || regions.r50)?.geometry.coordinates[0].forEach((p) => bounds.extend(new window.kakao.maps.LatLng(p[1], p[0])));
  if (!bounds.isEmpty()) map.setBounds(bounds, 30, 30, 30, 30);
}

export function renderMonteCarloHull(hullFeature) {
  if (!map) return;
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
  if (!map) return;
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
  regionOverlays.forEach((o) => o.setMap(null)); regionOverlays = [];
  if (hfComparisonPolyline) { hfComparisonPolyline.setMap(null); hfComparisonPolyline = null; }
  if (romsComparisonPolyline) { romsComparisonPolyline.setMap(null); romsComparisonPolyline = null; }
}

export function resetMapView() {
  if (!map) return;
  clearPrediction();
  const defaultPos = new window.kakao.maps.LatLng(36.05, 129.45);
  clickMarker.setPosition(defaultPos);
  centerMap(36.05, 129.45, 8);
}
