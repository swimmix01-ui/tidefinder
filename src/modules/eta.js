// ==========================================================================
// 출동 거리·도착 예정시각 + 직선 항로 위험물 경고
//  - 출발지: 폰 GPS(이동 중 계속 갱신) 또는 지도에서 직접 찍기
//  - 목적지: 화면의 사고 좌표(지도 클릭/좌표 입력값)
//  - 선속(kn)은 폰에 저장해 두고 다음에도 그대로 쓴다
// ==========================================================================
import { distanceBetween, bearingBetween, bearingToCompass } from './geo.js';
import { findHazardsOnRoute } from './sealayers.js';

const NM = 1852;
const SPEED_KEY = 'tf-boat-speed-kn';

let map = null;
let getTarget = () => null;
let origin = null;          // { lat, lon, src: 'gps' | 'map', acc }
let watchId = null;
let pickMode = false;
let routeLine = null;
let originMarker = null;
let hazardMarks = [];
let lastHazardKey = '';

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
  hazardMarks.forEach((m) => m.setMap(null)); hazardMarks = [];
}

function drawRoute(o, t, hazards) {
  if (!map) return;
  clearRoute();
  const a = new window.kakao.maps.LatLng(o.lat, o.lon);
  const b = new window.kakao.maps.LatLng(t.lat, t.lon);
  routeLine = new window.kakao.maps.Polyline({
    path: [a, b], strokeWeight: 3, strokeColor: hazards.length ? '#FF8A3D' : '#7DD3FC', strokeOpacity: 0.95, strokeStyle: 'shortdash', zIndex: 8,
  });
  routeLine.setMap(map);
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

const fmtNm = (m) => `${(m / NM).toFixed(m < 10 * NM ? 2 : 1)} NM`;
function fmtDur(min) {
  if (min < 1) return '1분 미만';
  const h = Math.floor(min / 60), mm = Math.round(min % 60);
  return h ? `${h}시간 ${mm}분` : `${mm}분`;
}
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function updateEta() {
  const t = getTarget();
  const speed = parseFloat($('etaSpeed').value);
  const box = $('etaResult');
  if (!origin || !t || Number.isNaN(t.lat) || Number.isNaN(t.lon)) {
    box.style.display = 'none';
    clearRoute();
    return;
  }
  const d = distanceBetween(origin.lat, origin.lon, t.lat, t.lon);
  const brg = bearingBetween(origin.lat, origin.lon, t.lat, t.lon);
  const minutes = speed > 0 ? (d / NM / speed) * 60 : NaN;
  const arrive = new Date(Date.now() + minutes * 60000);

  $('etaDist').textContent = fmtNm(d);
  $('etaBrg').textContent = `${Math.round(brg)}° ${bearingToCompass(brg)}`;
  $('etaDur').textContent = Number.isFinite(minutes) ? fmtDur(minutes) : '-';
  $('etaArrive').textContent = Number.isFinite(minutes) ? hhmm(arrive) : '-';
  $('etaFrom').textContent = origin.src === 'gps'
    ? `출발: 내 위치(GPS ±${Math.round(origin.acc || 0)}m, 이동하면 자동 갱신)`
    : '출발: 지도에서 찍은 위치';

  const { checked, hazards } = findHazardsOnRoute(origin, t, 100);
  const hz = $('etaHazards');
  if (!checked) {
    hz.className = 'eta-hazards none';
    hz.textContent = '위험물 데이터를 불러오지 못해 항로 점검을 못 했습니다.';
  } else if (!hazards.length) {
    hz.className = 'eta-hazards ok';
    hz.textContent = '직선 항로 ±100m 안에 등록된 정치망·양식장·간출암 없음 (서류상 기준 · 육지 통과 여부는 직접 확인)';
  } else {
    const sets = hazards.filter((h) => h.kind === 'set').length;
    const farms = hazards.filter((h) => h.kind === 'farm').length;
    const rocksN = hazards.filter((h) => h.kind === 'rock').length;
    const parts = [sets && `정치망 ${sets}`, farms && `양식장 ${farms}`, rocksN && `간출암 ${rocksN}`].filter(Boolean).join(' · ');
    hz.className = 'eta-hazards warn';
    hz.innerHTML = `<b>⚠ 직선 항로에 걸림: ${parts}</b><ul>${hazards.slice(0, 8).map((h) =>
      `<li><span>${h.label}</span> 출발 ${fmtNm(h.fromStartM)} 지점 · ${h.addr ? h.addr.replace(/\s+/g, ' ') : h.name}</li>`).join('')}${hazards.length > 8 ? `<li>외 ${hazards.length - 8}건</li>` : ''}</ul>`;
  }
  box.style.display = 'block';
  drawRoute(origin, t, hazards);

  // 위험물 목록이 바뀔 때만 지도 범위를 맞춘다(GPS 갱신마다 화면이 튀지 않게)
  const key = `${origin.src}|${t.lat.toFixed(4)},${t.lon.toFixed(4)}|${hazards.length}`;
  if (map && key !== lastHazardKey) {
    lastHazardKey = key;
    const bounds = new window.kakao.maps.LatLngBounds();
    bounds.extend(new window.kakao.maps.LatLng(origin.lat, origin.lon));
    bounds.extend(new window.kakao.maps.LatLng(t.lat, t.lon));
    map.setBounds(bounds, 40, 40, 40, 40);
  }
}
