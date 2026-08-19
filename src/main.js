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
  const leewayCoefVal = parseFloat(document.getElementById('leewayCoef').value);

  ui.showLoading('조류 분석 중...');
  ui.setStatus('busy', '⏳ 조류 연산 수행 중...');

  try {
    const result = await runPrediction(
      { lat, lon, ahead, startDateTime, leewayCoefVal },
      {
        onStatus: ui.setStatus,
        onProgress: (done, total) => ui.setStatus('busy', `🎲 몬테카를로 시뮬레이션 중... (${done}/${total})`),
      }
    );
    ui.hideLoading();
    ui.setStatus('ok', '✅ 예측 완료');
    console.log('예측 결과:', result); // TODO(2단계): 상태 저장소(state.js)로 옮겨 화면 결과카드와 자동 연동
  } catch (err) {
    ui.hideLoading();
    ui.setStatus('warn', `⚠ 예측 실패: ${err.message}`);
    console.error(err);
  }
}

async function init() {
  const today = new Date();
  document.getElementById('dateInput').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.getElementById('hourInput').value = today.getHours();
  document.getElementById('minuteInput').value = today.getMinutes();

  // 비차단 로드 - 실패해도 페이지 동작에 영향 없음
  loadCoastlineGeoJSON();
  loadSetnetGeoJSON();

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
      },
      (err) => ui.setStatus('warn', `⚠ 위치 확인 실패: ${err.message}`)
    );
  });

  await mapModule.initMap('map', (lat, lon) => {
    setCoordsToInputs(lat, lon);
    mapModule.setMarkerPosition(lat, lon);
    ui.setStatus('ok', '🎯 좌표 자동 입력 완료');
  });
  ui.setStatus('ok', '✅ 지도 연동 완료');
}

init();
