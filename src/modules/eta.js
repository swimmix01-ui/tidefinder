// ==========================================================================
// 출동 거리·도착 예정시각 + 직선 항로 위험물 경고
//  - 출발지: 폰 GPS(이동 중 계속 갱신) 또는 지도에서 직접 찍기
//  - 목적지: 화면의 사고 좌표(지도 클릭/좌표 입력값)
//  - 선속(kn)은 폰에 저장해 두고 다음에도 그대로 쓴다
// ==========================================================================
import { distanceBetween, bearingBetween, bearingToCompass } from './geo.js';
import { findHazardsOnRoute } from './sealayers.js';
import { planSeaRoute } from './route.js';

const NM = 1852;
const SPEED_KEY = 'tf-boat-speed-kn';
const AVOID_KEY = 'tf-route-avoid';
const DEPTH_KEY = 'tf-route-min-depth';

let map = null;
let getTarget = () => null;
let origin = null;          // { lat, lon, src: 'gps' | 'map', acc }
let watchId = null;
let pickMode = false;
let routeLine = null;
let originMarker = null;
let hazardMarks = [];
let lastHazardKey = '';
let landLeg = null;
let routeCache = null; // { key, from, res }
let updSeq = 0;
let shallowLeg = null;

const $ = (id) => document.getElementById(id);

function loadSpeed() {
  try { const v = parseFloat(localStorage.getItem(SPEED_KEY)); if (v > 0) return v; } catch { /* 저장소 없음 */ }
  return 25;
}
function saveSpeed(v) {
  try { localStorage.setItem(SPEED_KEY, String(v)); } catch { /* 무시 */ }
}

export function initEta({ kakaoMap, getTargetCoords }) {
  map = kakaoMap;
  getTarget = getTargetCoords;
  $('etaSpeed').value = loadSpeed();
  $('etaSpeed').addEventListener('input', () => {
    const v = parseFloat($('etaSpeed').value);
    if (v > 0) saveSpeed(v);
    updateEta();
  });
  try { $('etaAvoid').checked = localStorage.getItem(AVOID_KEY) !== '0'; } catch { /* 기본 켬 */ }
  $('etaAvoid').addEventListener('change', () => {
    try { localStorage.setItem(AVOID_KEY, $('etaAvoid').checked ? '1' : '0'); } catch { /* 무시 */ }
    routeCache = null;
    updateEta();
  });
  try { const v = localStorage.getItem(DEPTH_KEY); $('etaMinDepth').value = v !== null ? v : '2'; } catch { $('etaMinDepth').value = '2'; }
  $('etaMinDepth').addEventListener('change', () => {
    try { localStorage.setItem(DEPTH_KEY, $('etaMinDepth').value); } catch { /* 무시 */ }
    routeCache = null;
    updateEta();
  });
  $('etaGpsBtn').addEventListener('click', toggleGps);
  $('etaPickBtn').addEventListener('click', () => {
    pickMode = !pickMode;
    $('etaPickBtn').classList.toggle('active', pickMode);
    setNote(pickMode ? '지도에서 출발 위치(예: 구조정 현재 위치)를 눌러주세요.' : '');
  });
  updateEta();
}

// main.js의 지도 클릭 처리에서 먼저 물어본다 - 출발지 찍기 모드면 이 클릭은 여기서 소비
export function consumeMapClick(lat, lon) {
  if (!pickMode) return false;
  pickMode = false;
  $('etaPickBtn').classList.remove('active');
  stopGps();
  origin = { lat, lon, src: 'map' };
  setNote('');
  updateEta();
  return true;
}

function setNote(t) { $('etaNote').textContent = t; }

function toggleGps() {
  if (watchId !== null) { stopGps(); updateEta(); return; }
  if (!navigator.geolocation) { setNote('이 브라우저는 위치 정보를 지원하지 않습니다.'); return; }
  setNote('GPS 위치 확인 중…');
  $('etaGpsBtn').classList.add('active');
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude, lon: pos.coords.longitude, src: 'gps', acc: pos.coords.accuracy };
      setNote('');
      updateEta();
    },
    (err) => { setNote(`GPS 실패: ${err.message}`); stopGps(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  $('etaGpsBtn').classList.remove('active');
}

function clearRoute() {
  if (routeLine) { routeLine.setMap(null); routeLine = null; }
  if (originMarker) { originMarker.setMap(null); originMarker = null; }
  if (landLeg) { landLeg.setMap(null); landLeg = null; }
  if (shallowLeg) { shallowLeg.setMap(null); shallowLeg = null; }
  hazardMarks.forEach((m) => m.setMap(null)); hazardMarks = [];
}

function drawRoute(o, pts, hazards, routed, shallowLast) {
  if (!map) return;
  clearRoute();
  const all = pts.map((p) => new window.kakao.maps.LatLng(p.lat, p.lon));
  // 사고지점이 얕은 곳이면 마지막 구간(구조정 접근 불가)은 빨간 점선으로 따로
  const path = shallowLast && all.length > 2 ? all.slice(0, -1) : all;
  if (shallowLast && all.length >= 2) {
    shallowLeg = new window.kakao.maps.Polyline({ path: all.slice(-2), strokeWeight: 3, strokeColor: '#FF3B3B', strokeOpacity: 0.95, strokeStyle: 'shortdot', zIndex: 8 });
    shallowLeg.setMap(map);
  }
  routeLine = new window.kakao.maps.Polyline({
    path, strokeWeight: routed ? 4 : 3,
    strokeColor: hazards.length ? '#FF8A3D' : routed ? '#38BDF8' : '#7DD3FC',
    strokeOpacity: 0.95, strokeStyle: routed ? 'solid' : 'shortdash', zIndex: 8,
  });
  routeLine.setMap(map);
  const a = new window.kakao.maps.LatLng(o.lat, o.lon);
  if (Math.abs(pts[0].lat - o.lat) > 1e-6 || Math.abs(pts[0].lon - o.lon) > 1e-6) {
    // 출발지가 육상일 때: 출발지 → 바다 진입점 (회색 점선, 거리 계산엔 미포함)
    landLeg = new window.kakao.maps.Polyline({ path: [a, path[0]], strokeWeight: 2, strokeColor: '#94A3B8', strokeOpacity: 0.8, strokeStyle: 'dot', zIndex: 7 });
    landLeg.setMap(map);
  }
  originMarker = new window.kakao.maps.CustomOverlay({ position: a, content: '<div class="boat-mark">🚤</div>', zIndex: 9 });
  originMarker.setMap(map);
  hazards.forEach((h) => {
    const m = new window.kakao.maps.CustomOverlay({
      position: new window.kakao.maps.LatLng(h.lat, h.lon), content: '<div class="hazard-ping">!</div>', zIndex: 10,
    });
    m.setMap(map);
    hazardMarks.push(m);
  });
}

// GPS가 조금 움직일 때마다 다시 계산하지 않도록 150m 이상 움직였거나 목적지가 바뀌었을 때만 새로 계산
async function getRoute(o, t) {
  const avoid = $('etaAvoid').checked;
  const minDepth = Math.max(0, parseFloat($('etaMinDepth').value) || 0);
  const key = `${t.lat.toFixed(5)},${t.lon.toFixed(5)}|${avoid}|${minDepth}`;
  if (routeCache && routeCache.key === key && distanceBetween(routeCache.from.lat, routeCache.from.lon, o.lat, o.lon) < 150) {
    return routeCache.res;
  }
  let res;
  try { res = await planSeaRoute(o, t, { avoidHazards: avoid, minDepth }); } catch (err) { res = { ok: false, reason: String(err.message || err) }; }
  routeCache = { key, from: { lat: o.lat, lon: o.lon }, res };
  return res;
}

function hazardsAlong(pts) {
  const seen = new Set(); const all = []; let checked = false; let offset = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = findHazardsOnRoute(pts[i], pts[i + 1], pts.length > 2 ? 60 : 100);
    checked = checked || r.checked;
    r.hazards.forEach((h) => {
      const k = `${h.kind}|${h.lat.toFixed(5)}|${h.lon.toFixed(5)}`;
      if (seen.has(k)) return; seen.add(k);
      all.push({ ...h, fromStartM: offset + h.fromStartM });
    });
    offset += distanceBetween(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
  }
  return { checked, hazards: all };
}

const fmtNm = (m) => `${(m / NM).toFixed(m < 10 * NM ? 2 : 1)} NM`;
function fmtDur(min) {
  if (min < 1) return '1분 미만';
  const h = Math.floor(min / 60), mm = Math.round(min % 60);
  return h ? `${h}시간 ${mm}분` : `${mm}분`;
}
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export async function updateEta() {
  const seq = ++updSeq;
  const t = getTarget();
  const speed = parseFloat($('etaSpeed').value);
  const box = $('etaResult');
  if (!origin || !t || Number.isNaN(t.lat) || Number.isNaN(t.lon)) {
    box.style.display = 'none';
    clearRoute();
    return;
  }
  const straight = distanceBetween(origin.lat, origin.lon, t.lat, t.lon);
  if (!routeCache) setNote('항로 계산 중…(수심 자료 받는 중)');
  const route = await getRoute(origin, t);
  if (seq !== updSeq) return; // 그 사이 새 계산이 시작됨
  setNote('');
  const routed = route.ok;
  const pts = routed ? route.points : [{ lat: origin.lat, lon: origin.lon }, { lat: t.lat, lon: t.lon }];
  const d = routed ? route.distM : straight;
  const brg = bearingBetween(pts[0].lat, pts[0].lon, pts[1].lat, pts[1].lon); // 첫 구간 침로
  const minutes = speed > 0 ? (d / NM / speed) * 60 : NaN;
  const arrive = new Date(Date.now() + minutes * 60000);

  $('etaDistLabel').textContent = routed ? '해상 항로 거리' : '직선거리';
  $('etaDist').textContent = fmtNm(d);
  $('etaBrg').textContent = `${Math.round(brg)}° ${bearingToCompass(brg)}`;
  $('etaBrgLabel').textContent = routed && pts.length > 2 ? '첫 구간 침로' : '침로(방위)';
  $('etaDur').textContent = Number.isFinite(minutes) ? fmtDur(minutes) : '-';
  $('etaArrive').textContent = Number.isFinite(minutes) ? hhmm(arrive) : '-';
  const fromTxt = origin.src === 'gps'
    ? `출발: 내 위치(GPS ±${Math.round(origin.acc || 0)}m, 이동하면 자동 갱신)`
    : '출발: 지도에서 찍은 위치';
  const routeTxt = routed
    ? ` · 직선 ${fmtNm(straight)} 대비 +${fmtNm(Math.max(0, d - straight))}${route.startOnLandM ? ` · 출발지가 육상이라 가장 가까운 바다(${(route.startOnLandM / 1000).toFixed(1)}km)부터 계산` : ''}`
    : ` · 해상 항로 계산 실패(${route.reason}) → 직선으로 표시`;
  const minDepth = parseFloat($('etaMinDepth').value) || 0;
  const depthTxt = !routed || !minDepth ? '' : route.depthUsed
    ? ` · 수심 ${minDepth}m 미만 회피${route.depthNote ? ` (${route.depthNote})` : ''}`
    : ` · 수심 미반영(${route.depthNote})`;
  $('etaFrom').textContent = fromTxt + routeTxt + depthTxt;

  const { checked, hazards } = hazardsAlong(pts);
  const avoid = $('etaAvoid').checked;
  const hz = $('etaHazards');
  if (!checked) {
    hz.className = 'eta-hazards none';
    hz.textContent = '위험물 데이터를 불러오지 못해 항로 점검을 못 했습니다.';
  } else if (!hazards.length) {
    hz.className = 'eta-hazards ok';
    hz.textContent = routed
      ? (avoid ? '육지를 돌아가고 정치망·양식장·간출암을 피해 그은 항로입니다 (면허구역 기준 · 실제 부표·수심은 현장 확인)'
               : '육지만 피한 항로 · 항로 근처에 등록된 정치망·양식장·간출암 없음')
      : '직선 항로 ±100m 안에 등록된 정치망·양식장·간출암 없음 (육지 통과 여부는 직접 확인)';
  } else {
    const sets = hazards.filter((h) => h.kind === 'set').length;
    const farms = hazards.filter((h) => h.kind === 'farm').length;
    const rocksN = hazards.filter((h) => h.kind === 'rock').length;
    const parts = [sets && `정치망 ${sets}`, farms && `양식장 ${farms}`, rocksN && `간출암 ${rocksN}`].filter(Boolean).join(' · ');
    hz.className = 'eta-hazards warn';
    hz.innerHTML = `<b>⚠ 항로에 걸림: ${parts}</b>${routed && avoid ? '<div style="font-size:12px;color:var(--text-lo)">사고지점·출발지가 어장 안이거나 붙어 있어 피할 수 없는 구간입니다.</div>' : ''}<ul>${hazards.slice(0, 8).map((h) =>
      `<li><span>${h.label}</span> 출발 ${fmtNm(h.fromStartM)} 지점 · ${h.addr ? h.addr.replace(/\s+/g, ' ') : h.name}</li>`).join('')}${hazards.length > 8 ? `<li>외 ${hazards.length - 8}건</li>` : ''}</ul>`;
  }
  const sh = $('etaShallow');
  if (routed && route.shallowLastLegM > 0) {
    sh.style.display = 'block';
    sh.innerHTML = `<b>⚠ 저수심</b> 사고지점 앞 약 <b>${Math.round(route.shallowLastLegM)}m</b>는 수심 ${minDepth}m 미만입니다. 구조정은 빨간 점선 시작점까지 — 이후 고무보트·수영 접근 검토`;
  } else {
    sh.style.display = 'none';
  }
  box.style.display = 'block';
  drawRoute(origin, pts, hazards, routed, routed && route.shallowLastLegM > 0);

  // 위험물 목록이 바뀔 때만 지도 범위를 맞춘다(GPS 갱신마다 화면이 튀지 않게)
  const key = `${origin.src}|${t.lat.toFixed(4)},${t.lon.toFixed(4)}|${hazards.length}|${pts.length}|${$('etaAvoid').checked}`;
  if (map && key !== lastHazardKey) {
    lastHazardKey = key;
    const bounds = new window.kakao.maps.LatLngBounds();
    bounds.extend(new window.kakao.maps.LatLng(origin.lat, origin.lon));
    pts.forEach((p) => bounds.extend(new window.kakao.maps.LatLng(p.lat, p.lon)));
    map.setBounds(bounds, 40, 40, 40, 40);
  }
}
