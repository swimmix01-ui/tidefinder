// ==========================================================================
// TideFinder 앱 진입점
// ※ index.html에 <script type="module" src="/src/main.js"> 한 줄만 있으면
//   Vite가 이 파일부터 시작해서 import 트리를 전부 번들링한다.
// ==========================================================================
import { loadLandPolygons } from './modules/route.js';
import * as harbors from './modules/harbors.js';
import { initPlaceSearch } from './modules/placesearch.js';
import * as currents from './modules/currentarrows.js';
import * as measure from './modules/measure.js';
let placeSearch = null;
import { dmsToDecimal, decimalToDMS, parseCoordText, isValidKoreaSea, positionAtHour, bearingToCompass } from './modules/geo.js';
import { loadCoastlineGeoJSON, loadSetnetGeoJSON, getLocalCoastline, getCoastlineStatus } from './modules/coastline.js';
import * as mapModule from './modules/map.js';
import * as ui from './modules/ui.js';
import { runPrediction } from './predict.js';
import { loadMarineStatus } from './modules/marine.js';
import * as seaLayers from './modules/sealayers.js';
import * as eta from './modules/eta.js';
import * as depth from './modules/depth.js';

let lastPredictionResult = null;
// 사용자가 사고 좌표를 직접 정했는지 (지도 클릭·붙여넣기·칸 입력·현재위치·계산 실행).
// 정하기 전엔 기본 좌표로 출동 항로를 긋지 않는다 - 엉뚱한 곳으로 가는 선이 먼저 뜨는 걸 막음
let incidentSet = false;
let myPos = null; // 앱 열 때 받은 내 위치

function getCoordsFromInputs() {
  const lat = dmsToDecimal(
    parseFloat(document.getElementById('latD').value),
    parseFloat(document.getElementById('latM').value),
    parseFloat(document.getElementById('latS').value)
  );
  const lon = dmsToDecimal(
    parseFloat(document.getElementById('lonD').value),
    parseFloat(document.getElementById('lonM').value),
    parseFloat(document.getElementById('lonS').value)
  );
  return { lat, lon };
}

function setCoordsToInputs(lat, lon) {
  const latDMS = decimalToDMS(lat), lonDMS = decimalToDMS(lon);
  document.getElementById('latD').value = latDMS.d;
  document.getElementById('latM').value = latDMS.m;
  document.getElementById('latS').value = latDMS.s;
  document.getElementById('lonD').value = lonDMS.d;
  document.getElementById('lonM').value = lonDMS.m;
  document.getElementById('lonS').value = lonDMS.s;
  ui.refreshInputCheckmarks();
  eta.updateEta();
  updateCoastViewBtn();
}

// 입력값 점검 - 잘못된 값으로 계산이 돌아가 엉뚱한 구역이 나오는 걸 막는다
function validateInputs({ lat, lon, ahead, hourN, minN, startDateTime }) {
  if (!isValidKoreaSea(lat, lon)) return '좌표를 확인하세요 (위도 32~39.5°, 경도 124~132.5° 범위 밖이거나 빈칸)';
  if (!Number.isInteger(ahead) || ahead < 1 || ahead > 24) return '예측 시간은 1~24시간으로 넣어주세요';
  if (!Number.isInteger(hourN) || hourN < 0 || hourN > 23 || !Number.isInteger(minN) || minN < 0 || minN > 59) return '사고 시각(시 0~23, 분 0~59)을 확인하세요';
  if (Number.isNaN(startDateTime.getTime())) return '사고 날짜를 확인하세요';
  if (startDateTime.getTime() > Date.now() + 6 * 3600000) return '사고 시각이 지금보다 6시간 넘게 미래입니다 - 날짜를 확인하세요';
  if (Date.now() - startDateTime.getTime() > 7 * 86400000) return '사고 시각이 7일보다 오래 전입니다 - 날짜를 확인하세요';
  return null;
}

async function handleRunPrediction() {
  incidentSet = true;
  const { lat, lon } = getCoordsFromInputs();
  const ahead = parseInt(document.getElementById('hoursAhead').value, 10);
  const hourN = parseInt(document.getElementById('hourInput').value, 10);
  const minN = parseInt(document.getElementById('minuteInput').value, 10);
  const hour = String(hourN).padStart(2, '0');
  const minute = String(minN).padStart(2, '0');
  const dateInputVal = document.getElementById('dateInput').value;
  const startDateTime = new Date(`${dateInputVal}T${hour}:${minute}:00`);
  const invalid = validateInputs({ lat, lon, ahead, hourN, minN, startDateTime });
  if (invalid) { ui.setStatus('warn', `⚠ ${invalid}`); document.getElementById('status').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const leewaySelect = document.getElementById('leewayCoef');
  const leewayCoefVal = parseFloat(leewaySelect.value);
  const selectedOption = leewaySelect.options[leewaySelect.selectedIndex];
  const cwAngleAttr = selectedOption?.dataset?.cwangle;
  const crosswindAngleDeg = cwAngleAttr ? parseFloat(cwAngleAttr) : undefined; // 없으면 predict.js 기본값(20°) 사용

  ui.showLoading('조류 분석 중...');
  ui.setStatus('busy', '⏳ 조류 연산 수행 중...');

  try {
    const result = await runPrediction(
      { lat, lon, ahead, startDateTime, leewayCoefVal, crosswindAngleDeg },
      {
        onStatus: ui.setStatus,
        onProgress: (done, total) => ui.setStatus('busy', `🎲 몬테카를로 시뮬레이션 중... (${done}/${total})`),
      }
    );
    ui.hideLoading();
    ui.setStatus('ok', '✅ 예측 완료');
    ui.renderResultCard(result);
    lastPredictionResult = { ...result, inputLat: lat, inputLon: lon, startDateTime, ahead };
    eta.updateEta();
    // 결과(지도·수색구역)가 입력칸보다 한참 아래라 폰에서 안 보였음 → 지도로 바로 이동
    document.getElementById('status').scrollIntoView({ behavior: 'smooth', block: 'start' });
    console.log('예측 결과:', result);
  } catch (err) {
    ui.hideLoading();
    ui.setStatus('warn', `⚠ 예측 실패: ${err.message}`);
    console.error(err);
  }
}

// "🗻 연안 3D 지형 보기" - 브이월드 3D는 육상 지형만 있어 먼바다에선 바다만 보인다.
// 사고 지점에서 가장 가까운 해안선까지 COAST_KM 이내일 때만 켜고, 카메라를 사고 지점 위에서
// 가장 가까운 해안 쪽을 바라보게 넘긴다.
const COAST_KM = 3;
let coastView = null; // { lat, lon, distM, heading }
function nearestCoast(lat, lon) {
  const data = getLocalCoastline(lat, lon, COAST_KM + 2);
  if (!data || !data.features.length) return null;
  return nearestCoastIn(data, lat, lon);
}
function nearestCoastIn(data, lat, lon) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = null;
  for (const f of data.features) {
    const c = f.geometry && f.geometry.coordinates;
    if (!c || typeof c[0][0] !== 'number') continue;
    for (let i = 1; i < c.length; i++) {
      const ax = (c[i - 1][0] - lon) * kx, ay = (c[i - 1][1] - lat) * ky, bx = (c[i][0] - lon) * kx, by = (c[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
      if (!best || d < best.d) best = { d, px, py };
    }
  }
  if (!best) return null;
  return { distM: best.d, heading: (Math.atan2(best.px, best.py) * 180 / Math.PI + 360) % 360 };
}
// 지도 아래 "가장 가까운 해안" 한 줄 (안전해 '육지 방향 보기'와 같은 개념) - 사고 좌표를 정했을 때만
// 3km 밖이면 반경을 넓혀 한 번 더 (먼바다에서도 '가장 가까운 해안'은 보여주기 위해)
function nearestCoastFar(lat, lon) {
  for (const km of [10, 30]) {
    const data = getLocalCoastline(lat, lon, km);
    if (data && data.features.length) return nearestCoastIn(data, lat, lon);
  }
  return null;
}

function updateCoastInfo(n) {
  const el = document.getElementById('coastInfo');
  if (!el) return;
  if (!incidentSet || !n) { el.style.display = 'none'; return; }
  const dist = n.distM < 1000 ? `${Math.round(n.distM)}m` : `${(n.distM / 1000).toFixed(1)}km (${(n.distM / 1852).toFixed(1)}NM)`;
  el.style.display = '';
  el.textContent = n.distM < 30 ? '🏝 사고 지점이 해안선 위입니다 (갯바위·방파제 확인)'
    : `🏝 가장 가까운 해안: ${String(Math.round(n.heading)).padStart(3, '0')}° ${bearingToCompass(n.heading)} 방향 ${dist}`;
}

function updateCoastViewBtn() {
  const btn = document.getElementById('coastViewBtn'), sub = document.getElementById('coastViewSub');
  if (!btn) return;
  const { lat, lon } = getCoordsFromInputs();
  if (!isValidKoreaSea(lat, lon)) { btn.disabled = true; sub.textContent = '사고 좌표를 먼저 정해 주세요'; coastView = null; return; }
  if (!getCoastlineStatus().loaded) { btn.disabled = false; sub.textContent = '해안선 자료 불러오는 중 · 바다 위면 지형이 안 보일 수 있음'; coastView = { lat, lon, heading: 0 }; return; }
  const n = nearestCoast(lat, lon) || nearestCoastFar(lat, lon);
  updateCoastInfo(n);
  if (!n || n.distM > COAST_KM * 1000) {
    btn.disabled = true;
    sub.textContent = `해안에서 ${COAST_KM}km 이내에서만 볼 수 있음 (먼바다는 3D 지형 없음)`;
    coastView = null;
    return;
  }
  btn.disabled = false;
  coastView = { lat, lon, heading: Math.round(n.heading), distM: n.distM };
  sub.textContent = `해안까지 ${n.distM < 1000 ? Math.round(n.distM) + 'm' : (n.distM / 1000).toFixed(1) + 'km'} · 지도와 같은 방향(북쪽 위) · 새 탭`;
}
window.openCoastView = function openCoastView() {
  updateCoastViewBtn();
  if (!coastView) return;
  const { lat, lon } = coastView;
  // 3D도 지도와 같은 모양(북쪽 위)·비슷한 범위로 보이게 지금 지도 확대 단계를 넘긴다
  const m = mapModule.getMap();
  const level = m ? m.getLevel() : 5;
  window.open(`/coastview.html?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&level=${level}`, '_blank', 'noopener');
};

function windSourceText(src, obsLabel) {
  const fc = (k) => (k === 'openmeteo' ? 'Open-Meteo 해상 격자 예보' : '기상청 단기예보(육상 격자)');
  if (src.startsWith('obs')) {
    const rest = src.split('+')[1];
    return `기상청 부이 실측(${obsLabel})${rest ? ` → ${fc(rest)}` : ''}`;
  }
  return fc(src);
}

// "📋 상황 보고서 양식 복사" 버튼 - 가장 최근 예측 결과를 텍스트 양식으로 복사한다.
window.copyOperationReport = function copyOperationReport() {
  if (!lastPredictionResult) {
    ui.setStatus('warn', '⚠ 먼저 표류 예측을 실행해주세요.');
    return;
  }
  const r = lastPredictionResult;
  const fmt = (n, digits = 4) => (typeof n === 'number' ? n.toFixed(digits) : '-');
  const text = [
    '[해양 수색지원 상황 보고서 - TideFinder]',
    `사고 발생 좌표: ${fmt(r.inputLat)}, ${fmt(r.inputLon)}`,
    `사고 발생 시각: ${r.startDateTime instanceof Date ? r.startDateTime.toLocaleString('ko-KR') : '-'}`,
    `예측 시간: ${r.ahead}시간`,
    r.finalPoint ? `예상 도달 위치: ${fmt(r.finalPoint.lat)}, ${fmt(r.finalPoint.lon)}` : null,
    typeof r.finalErrorRadius === 'number' ? `오차반경: 약 ${Math.round(r.finalErrorRadius)}m` : null,
    typeof r.combBrng === 'number' ? `추천 탐색 방향: ${Math.round(r.combBrng)}°` : null,
    typeof r.combSpeed === 'number' ? `평균 이동속도: ${(r.combSpeed / 1852).toFixed(2)}kn` : null,
    r.currentSource ? `해류 자료: ${r.currentSource}` : null,
    r.windSource ? `바람 자료: ${windSourceText(r.windSource, r.windObsLabel)}` : null,
    r.regions ? `수색 기준점: ${fmt(r.regions.center.lat)}, ${fmt(r.regions.center.lon)}` : null,
    r.regions?.area50Km2 ? `1차 구역(50%): ${r.regions.area50Km2.toFixed(2)}km² / 2차 구역(90%): ${r.regions.area90Km2.toFixed(2)}km²` : null,
    r.confidence ? `입력 자료 품질(추정): ${r.confidence.score}점 (${r.confidence.label})` : null,
    '',
    '※ 본 보고서는 광역 조류 격자 데이터 기반 예측치이며, 현장 상황과 다를 수 있습니다.',
  ].filter(Boolean).join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => ui.setStatus('ok', '📋 상황 보고서가 클립보드에 복사되었습니다.'))
      .catch(() => ui.setStatus('warn', '⚠ 클립보드 복사에 실패했습니다.'));
  } else {
    ui.setStatus('warn', '⚠ 이 브라우저는 클립보드 복사를 지원하지 않습니다.');
  }
};

// 화면 전체를 처음 상태로: 입력값(기본 좌표·현재 시각), 지도 표시물, 결과 카드, 출동 도착위치
// 기본 좌표 = 영일만 바다 한가운데 (예전 기본값 36°01′23″ 129°25′10″은 포항신항 매립지 위였음)
const DEFAULT_COORD = { lat: 36.05, lon: 129.45 };
// 입력칸의 사고 일시 ↔ Date
function getIncidentDate() {
  const d = document.getElementById('dateInput').value;
  const h = parseInt(document.getElementById('hourInput').value, 10);
  const m = parseInt(document.getElementById('minuteInput').value, 10);
  if (!d || Number.isNaN(h) || Number.isNaN(m)) return null;
  const dt = new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function setIncidentDate(dt) {
  document.getElementById('dateInput').value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  document.getElementById('hourInput').value = dt.getHours();
  document.getElementById('minuteInput').value = dt.getMinutes();
  ui.refreshInputCheckmarks();
  updateDtNote();
}
// "지금으로부터 몇 분 전"을 보여줘서 날짜·시각 실수를 바로 알아채게
function updateDtNote() {
  const el = document.getElementById('dtNote');
  const dt = getIncidentDate();
  if (!dt) { el.textContent = ''; return; }
  const diff = Math.round((Date.now() - dt.getTime()) / 60000);
  const abs = Math.abs(diff);
  const txt = abs < 1 ? '지금' : abs < 60 ? `${abs}분` : `${Math.floor(abs / 60)}시간${abs % 60 ? ` ${abs % 60}분` : ''}`;
  el.textContent = abs <= 1 ? '사고 시각 = 지금' : diff > 0 ? `지금으로부터 ${txt} 전` : `⚠ 지금보다 ${txt} 뒤 (미래 시각)`;
  el.style.color = diff < -1 ? 'var(--amber)' : '';
}

function setNowToInputs() {
  const now = new Date();
  document.getElementById('dateInput').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  document.getElementById('hourInput').value = now.getHours();
  document.getElementById('minuteInput').value = now.getMinutes();
  updateDtNote();
}
function resetAll() {
  lastPredictionResult = null;
  incidentSet = false;
  ['aiCard', 'resultCard', 'searchCard'].forEach((id) => { document.getElementById(id).style.display = 'none'; });
  if (placeSearch) placeSearch.clear();
  setNowToInputs();
  document.getElementById('hoursAhead').value = 6;
  eta.resetEta(); // 출발지·항로선 지우기 (GPS 추적도 끔)
  measure.setMeasure(false);
  const mc = document.getElementById('measureChip'); if (mc) mc.classList.remove('on');
  setCoordsToInputs(DEFAULT_COORD.lat, DEFAULT_COORD.lon);
  mapModule.resetMapView();
  if (myPos) mapModule.centerMap(myPos.lat, myPos.lon, 7);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function init() {
  setNowToInputs();

  // 비차단 로드 - 실패해도 페이지 동작에 영향 없음
  const seaLoad = seaLayers.loadSeaLayers();
  const harborLoad = harbors.loadHarbors();
  const dataLoads = Promise.allSettled([loadCoastlineGeoJSON(), loadSetnetGeoJSON(), seaLoad, loadLandPolygons()]);
  dataLoads.then(updateCoastViewBtn);
  updateCoastViewBtn();
  dataLoads.then(() => eta.updateEta()); // 해안선이 늦게 오면 그때 항로를 다시 계산
  loadMarineStatus();

  ['latD', 'latM', 'latS', 'lonD', 'lonM', 'lonS', 'dateInput', 'hourInput', 'minuteInput', 'hoursAhead'].forEach((id) => {
    document.getElementById(id).addEventListener('input', ui.refreshInputCheckmarks);
  });
  // 도분초 칸을 직접 고쳐도 지도 핀이 따라가게 (예전엔 지도 클릭·붙여넣기 때만 핀이 움직였음)
  const syncMarkerFromInputs = (center) => {
    const { lat, lon } = getCoordsFromInputs();
    if (!isValidKoreaSea(lat, lon)) return;
    mapModule.setMarkerPosition(lat, lon);
    if (center) mapModule.centerMap(lat, lon);
  };
  ['latD', 'latM', 'latS', 'lonD', 'lonM', 'lonS'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { incidentSet = true; eta.updateEta(); syncMarkerFromInputs(false); updateCoastViewBtn(); });
    el.addEventListener('change', () => syncMarkerFromInputs(true));
  });
  ui.refreshInputCheckmarks();

  // 사고 일시 빠른 조정: [지금] [-30분] [-1시간] [-2시간] - 누를 때마다 현재 입력값에서 더 빼진다
  document.querySelectorAll('.dt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.shift;
      if (v === 'now') { setIncidentDate(new Date()); return; }
      const base = getIncidentDate() || new Date();
      setIncidentDate(new Date(base.getTime() + parseInt(v, 10) * 60000));
    });
  });
  ['dateInput', 'hourInput', 'minuteInput'].forEach((id) => document.getElementById(id).addEventListener('input', updateDtNote));
  setInterval(updateDtNote, 60000);

  // 어항 계류 판정 기준 수심 (기억)
  const needEl = document.getElementById('harborNeed');
  needEl.value = harbors.getNeedDepth();
  needEl.addEventListener('change', () => {
    const v = parseFloat(needEl.value);
    if (v > 0 && v < 10) harbors.setNeedDepth(v); else needEl.value = harbors.getNeedDepth();
  });

  // 위치 검색: 항구·지명(경북 어항 + 카카오 장소검색) 또는 좌표 → 사고 좌표 입력 + 지도 이동
  placeSearch = initPlaceSearch({
    input: document.getElementById('placeSearch'),
    list: document.getElementById('placeList'),
    note: document.getElementById('placeNote'),
    getHarbors: harbors.getHarbors,
    getCenter: () => { const m = mapModule.getMap(); return m ? m.getCenter() : null; },
    onPick: (lat, lon) => {
      incidentSet = true;
      setCoordsToInputs(lat, lon);
      mapModule.setMarkerPosition(lat, lon);
      mapModule.centerMap(lat, lon, 6);
    },
  });

  document.getElementById('runPredictionBtn').addEventListener('click', handleRunPrediction);

  // 오른쪽 위 버튼 = 처음 화면으로 전체 초기화 (예전엔 해상상태만 다시 받아서 지도·결과가 그대로 남았음)
  document.getElementById('headerRefreshBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.classList.contains('spinning')) return; // 중복 클릭 방지
    btn.classList.add('spinning');
    resetAll();
    ui.setStatus('busy', '⏳ 초기화 · 해상상태 다시 받는 중...');
    try {
      await loadMarineStatus();
      ui.setStatus('ok', '↺ 초기화 완료 - 지도를 누르거나 좌표를 넣어주세요');
    } catch (err) {
      ui.setStatus('warn', '↺ 초기화 완료 (해상상태 갱신 실패)');
    } finally {
      btn.classList.remove('spinning');
    }
  });

  document.getElementById('resetMapBtn').addEventListener('click', () => {
    // 지도 위 그림(표류경로·수색구역·출동항로)과 결과만 지우고, 입력한 사고 좌표는 그대로 둔다
    // (예전엔 핀만 기본 위치로 튀고 입력칸 좌표는 남아서 서로 안 맞았음)
    mapModule.clearPrediction();
    eta.resetEta();
    lastPredictionResult = null;
    ['aiCard', 'resultCard', 'searchCard'].forEach((id) => { document.getElementById(id).style.display = 'none'; });
    const { lat, lon } = getCoordsFromInputs();
    if (isValidKoreaSea(lat, lon)) { mapModule.setMarkerPosition(lat, lon); mapModule.centerMap(lat, lon, 8); }
    ui.setStatus('warn', '↺ 지도 표시를 지웠습니다 (사고 좌표는 유지)');
  });

  document.getElementById('useLocationBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { ui.setStatus('warn', '⚠ 이 브라우저는 위치 정보를 지원하지 않습니다.'); return; }
    ui.setStatus('busy', '⏳ 현재 위치 확인 중...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        incidentSet = true;
        setCoordsToInputs(pos.coords.latitude, pos.coords.longitude);
        mapModule.setMarkerPosition(pos.coords.latitude, pos.coords.longitude);
        mapModule.centerMap(pos.coords.latitude, pos.coords.longitude);
        ui.setStatus('ok', `📍 현재 위치 적용 완료 (오차 ±${Math.round(pos.coords.accuracy)}m)`);
        loadMarineStatus({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => ui.setStatus('warn', `⚠ 위치 확인 실패: ${err.message}`)
    );
  });

  const mapInstance = await mapModule.initMap('map', (lat, lon) => {
    // 어장 도형/간출암을 누른 클릭이면 사고좌표를 옮기지 않는다
    // (도형 클릭과 지도 클릭 중 어느 쪽이 먼저 오는지 SDK가 보장하지 않아 잠깐 기다렸다 판단)
    setTimeout(() => {
      if (measure.handleMapClick(lat, lon)) return; // 거리재기 중엔 사고 좌표로 안 들어감
      if (seaLayers.shouldIgnoreMapClick() || harbors.shouldIgnoreMapClick()) return;
      seaLayers.hideInfo();
      if (eta.consumeMapClick(lat, lon)) { ui.setStatus('ok', '🚤 출발지 지정 완료'); return; }
      incidentSet = true;
      setCoordsToInputs(lat, lon);
      mapModule.setMarkerPosition(lat, lon);
      ui.setStatus('ok', '🎯 좌표 자동 입력 완료');
      loadMarineStatus({ lat, lon });
    }, 30);
  });
  eta.initEta({
    kakaoMap: mapInstance,
    getTargetCoords: () => (incidentSet ? getCoordsFromInputs() : null),
    // 구조정 도착 시각에 표류자가 있을 것으로 보이는 위치 (예측을 돌린 뒤에만)
    getDriftAt: (arriveDate) => {
      const r = lastPredictionResult;
      if (!r || !r.path) return null;
      const { lat, lon } = getCoordsFromInputs();
      if (Math.abs(lat - r.inputLat) > 1e-6 || Math.abs(lon - r.inputLon) > 1e-6) return null; // 좌표가 바뀌면 무효
      const h = (arriveDate.getTime() - r.startDateTime.getTime()) / 3600000;
      if (h < 0) return null;
      return { ...positionAtHour(r.path, h), hours: h, beyond: h > r.path.length - 1 };
    },
  });
  if (mapInstance) {
    await seaLoad;
    seaLayers.initSeaLayers(mapInstance);
    depth.initDepthLayer(mapInstance);
    try { if (await harborLoad) { harbors.initHarbors(mapInstance); document.getElementById('harborChip').style.display = ''; } } catch (err) { console.warn('어항 레이어 실패(다른 기능엔 영향 없음):', err); }
    try {
      currents.initCurrentArrows(mapInstance, document.getElementById('mapToolNote'));
      measure.initMeasure(mapInstance, document.getElementById('mapToolNote'));
      if (mapInstance) { document.getElementById('currentChip').style.display = ''; document.getElementById('measureChip').style.display = ''; }
    } catch (err) { console.warn('조류·거리재기 초기화 실패:', err); }
    setupLayerChips();
    ui.setStatus('ok', '✅ 지도 연동 완료');
  } else {
    ui.setStatus('warn', '⚠ 지도를 불러오지 못했습니다(통신 불량). 좌표 직접 입력으로 예측은 가능합니다.');
  }

  locateMeOnStart();
  setupStatusStrip();
  registerServiceWorker(dataLoads);
}

// 상단 고정 상태바 - 해상상태 카드(아래쪽)의 값을 그대로 따라 보여준다. 누르면 해상상태 카드로.
function setupStatusStrip() {
  const pairs = [['marineWind', 'ssWind'], ['marineWaveHeight', 'ssWave'], ['marineWaterTemp', 'ssWater'], ['marineNextTide', 'ssTide']];
  const short = (id, t) => {
    t = (t || '-').trim();
    if (id === 'marineWaveHeight') t = t.replace(/\s*\(.*$/, ''); // "0.8m (실측·구룡포 21km)" → "0.8m"
    if (id === 'marineWind') { // "45° / 9.0m/s (해상예보)" → "북동 9.0m/s"
      const m = t.match(/(\d+(?:\.\d+)?)°\s*\/\s*([\d.]+\s*m\/s)/);
      if (m) t = `${bearingToCompass(+m[1])} ${m[2].replace(/\s/g, '')}`;
      else t = t.replace(/\s*\(.*$/, '');
    }
    if (id === 'marineNextTide') t = t.replace(/^(\S+)\s+\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}).*$/, '$1 $2'); // "만조 2026-11-26 09:12:00 (…)" → "만조 09:12"
    return t === '불러오는 중…' ? '…' : t;
  };
  const sync = () => {
    pairs.forEach(([from, to]) => { const f = document.getElementById(from), t = document.getElementById(to); if (f && t) t.textContent = short(from, f.textContent); });
    const box = document.getElementById('marineAlertBox'), al = document.getElementById('ssAlert');
    if (box && al) {
      const on = box.style.display !== 'none' && box.textContent.trim();
      al.style.display = on ? '' : 'none';
      // "[특보] 제11-26호 : … / 풍랑주의보 발표(*)" → "⚠ 풍랑주의보"
      const names = on ? [...new Set((box.textContent.match(/(풍랑|태풍|폭풍해일|해일|강풍)\s*(주의보|경보)/g) || []).map((x) => x.replace(/\s/g, '')))] : [];
      al.textContent = on ? `⚠ ${names.length ? names.join('·') : '기상특보 발효'}` : '';
    }
  };
  const obs = new MutationObserver(sync);
  pairs.forEach(([from]) => { const el = document.getElementById(from); if (el) obs.observe(el, { childList: true, characterData: true, subtree: true }); });
  const box = document.getElementById('marineAlertBox');
  if (box) obs.observe(box, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  sync();
  const strip = document.getElementById('statusStrip');
  const go = () => document.getElementById('marineCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  strip.addEventListener('click', go);
  strip.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// 앱 열 때 내 위치를 한 번 받아 지도를 그쪽으로 옮기고, 출동 거리의 기본 출발지로 쓴다.
// 사고 좌표는 GPS로 채우지 않는다 - 출동 전엔 보통 파출소·부두(육상)에 있고, 사고 위치는 무전·신고로 따로 들어오기 때문.
// (사고 현장에 이미 있으면 "📍 현재 위치 사용" 버튼)
function locateMeOnStart() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      mapModule.setMyLocation(myPos.lat, myPos.lon);
      if (!incidentSet) mapModule.centerMap(myPos.lat, myPos.lon, 7);
      eta.setFallbackOrigin(myPos.lat, myPos.lon, pos.coords.accuracy);
    },
    () => { /* 위치 거부·실패 시 기본 지도 위치 그대로 */ },
    { enableHighAccuracy: false, maximumAge: 120000, timeout: 10000 }
  );
}

function setupLayerChips() {
  const state = seaLayers.getLayerState();
  if (state.loaded.rocks) document.getElementById('rockChip').style.display = '';
  document.querySelectorAll('#layerChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const on = !chip.classList.contains('on');
      chip.classList.toggle('on', on);
      if (chip.dataset.tool === 'measure') { measure.setMeasure(on); return; }
      if (chip.dataset.layer === 'depth') depth.setDepthVisible(on);
      else if (chip.dataset.layer === 'harbor') harbors.setHarborsVisible(on);
      else if (chip.dataset.layer === 'current') currents.setCurrentArrowsVisible(on);
      else if (chip.dataset.layer) seaLayers.setLayerVisible(chip.dataset.layer, on);
      if (chip.dataset.maptype) mapModule.setMapType(on);
    });
  });
}

// 오프라인 대비: 앱 화면과 해안선·정치망 데이터를 폰에 저장해 둔다 (public/sw.js).
// 서비스워커가 페이지를 제어하기 전에 이미 받아온 파일들(첫 방문)은 목록을 넘겨서
// 워커가 캐시에 담게 한다 - 해안선 파일은 브라우저 HTTP 캐시에서 바로 복사되므로
// 17MB를 다시 내려받지 않는다.
function registerServiceWorker(dataLoads) {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost') return;
  navigator.serviceWorker.register('/sw.js').then(async () => {
    const reg = await navigator.serviceWorker.ready;
    await dataLoads; // 해안선·정치망 다운로드가 끝난 뒤에 목록을 만들어야 그 파일들도 포함된다
    const urls = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.startsWith(location.origin) && !u.includes('/.netlify/functions/'));
    reg.active?.postMessage({ type: 'cache-urls', urls: ['/', ...urls] });
  }).catch((err) => console.warn('서비스워커 등록 실패(오프라인 캐시만 비활성, 앱 동작 영향 없음):', err));
}

init();
