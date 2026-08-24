// ==========================================================================
// TideFinder 앱 진입점
// ※ index.html에 <script type="module" src="/src/main.js"> 한 줄만 있으면
//   Vite가 이 파일부터 시작해서 import 트리를 전부 번들링한다.
// ==========================================================================
import { dmsToDecimal, decimalToDMS } from './modules/geo.js';
import { loadCoastlineGeoJSON, loadSetnetGeoJSON } from './modules/coastline.js';
import * as mapModule from './modules/map.js';
import * as ui from './modules/ui.js';
import { runPrediction } from './predict.js';
import { loadMarineStatus } from './modules/marine.js';

let lastPredictionResult = null;

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
}

async function handleRunPrediction() {
  const { lat, lon } = getCoordsFromInputs();
  const ahead = parseInt(document.getElementById('hoursAhead').value, 10);
  const hour = document.getElementById('hourInput').value.padStart(2, '0');
  const minute = document.getElementById('minuteInput').value.padStart(2, '0');
  const dateInputVal = document.getElementById('dateInput').value;
  const startDateTime = new Date(`${dateInputVal}T${hour}:${minute}:00`);
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
    console.log('예측 결과:', result);
  } catch (err) {
    ui.hideLoading();
    ui.setStatus('warn', `⚠ 예측 실패: ${err.message}`);
    console.error(err);
  }
}

// "🗻 3D 지형 보기" 버튼 - 현재 입력된 좌표를 붙여서 coastview.html을 새 탭으로 연다.
// (index.html에 onclick="openCoastView()"로 이미 연결돼 있어 전역에 노출해야 한다)
window.openCoastView = function openCoastView() {
  const { lat, lon } = getCoordsFromInputs();
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    window.open('/coastview.html', '_blank', 'noopener');
    return;
  }
  window.open(`/coastview.html?lat=${lat}&lon=${lon}`, '_blank', 'noopener');
};

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

async function init() {
  const today = new Date();
  document.getElementById('dateInput').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.getElementById('hourInput').value = today.getHours();
  document.getElementById('minuteInput').value = today.getMinutes();

  // 비차단 로드 - 실패해도 페이지 동작에 영향 없음
  loadCoastlineGeoJSON();
  loadSetnetGeoJSON();
  loadMarineStatus();

  ['latD', 'latM', 'latS', 'lonD', 'lonM', 'lonS', 'dateInput', 'hourInput', 'minuteInput', 'hoursAhead'].forEach((id) => {
    document.getElementById(id).addEventListener('input', ui.refreshInputCheckmarks);
  });
  ui.refreshInputCheckmarks();

  document.getElementById('runPredictionBtn').addEventListener('click', handleRunPrediction);
  document.getElementById('resetMapBtn').addEventListener('click', () => {
    mapModule.resetMapView();
    ui.setStatus('warn', '↺ 지도가 초기화되었습니다.');
  });

  document.getElementById('useLocationBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { ui.setStatus('warn', '⚠ 이 브라우저는 위치 정보를 지원하지 않습니다.'); return; }
    ui.setStatus('busy', '⏳ 현재 위치 확인 중...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoordsToInputs(pos.coords.latitude, pos.coords.longitude);
        mapModule.setMarkerPosition(pos.coords.latitude, pos.coords.longitude);
        mapModule.centerMap(pos.coords.latitude, pos.coords.longitude);
        ui.setStatus('ok', `📍 현재 위치 적용 완료 (오차 ±${Math.round(pos.coords.accuracy)}m)`);
        loadMarineStatus({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => ui.setStatus('warn', `⚠ 위치 확인 실패: ${err.message}`)
    );
  });

  await mapModule.initMap('map', (lat, lon) => {
    setCoordsToInputs(lat, lon);
    mapModule.setMarkerPosition(lat, lon);
    ui.setStatus('ok', '🎯 좌표 자동 입력 완료');
    loadMarineStatus({ lat, lon });
  });
  ui.setStatus('ok', '✅ 지도 연동 완료');
}

init();
