// ==========================================================================
// 상단 "현재 해상 상태" 카드 로더
// ※ Vite 리팩토링 과정에서 이 부분(카드에 실측/예보값 채우는 로직)이 빠져있어서
//   화면에 전부 "-"로만 나오던 문제를 해결하기 위해 새로 작성함.
//   각 API의 실제 응답 필드명은 문서로 100% 확정하지 못했으므로, 후보 키워드로
//   유연하게 찾아 채우고 원본 응답을 디버그 박스에도 남겨서, 값이 안 맞으면
//   디버그 박스를 보고 필드명을 바로 교정할 수 있게 해둔다.
// ==========================================================================
import * as api from './api.js';
import * as ui from './ui.js';
import { DT_STATIONS, HF_STATIONS, SF_STATIONS } from './constants.js';

const STATION_NAME = '포항';
const DT_STATION = DT_STATIONS.find((s) => s.name === STATION_NAME) || { code: 'DT_0091', lat: 36.03, lon: 129.38 };
const HF_STATION = HF_STATIONS.find((s) => s.name === '포항항') || { code: 'HF_0071', lat: 36.0, lon: 129.4 };
const SF_STATION = SF_STATIONS.find((s) => s.name === '포항항') || { code: 'SF_0011' };

function todayYYYYMMDD() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function latestItem(data) {
  if (!data) return null;
  return Array.isArray(data) ? data[data.length - 1] : data;
}

// item 객체에서 keywords 중 하나라도 key에 포함되고, 값이 숫자로 변환되는 첫 항목을 찾는다.
function pickNumeric(item, keywords) {
  if (!item || typeof item !== 'object') return null;
  for (const [k, v] of Object.entries(item)) {
    const lower = k.toLowerCase();
    if (keywords.some((kw) => lower.includes(kw))) {
      const num = parseFloat(v);
      if (!Number.isNaN(num)) return num;
    }
  }
  return null;
}

function pickText(item, keywords) {
  if (!item || typeof item !== 'object') return null;
  for (const [k, v] of Object.entries(item)) {
    const lower = k.toLowerCase();
    if (keywords.some((kw) => lower.includes(kw)) && v) return String(v);
  }
  return null;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// marineAlertBox는 원래 경보문구용이지만, 예측을 돌리기 전에는 화면에 보이는 카드가
// 없어서(resultCard의 debugBox는 숨김 상태) 임시로 여기에 원본 응답을 남겨 눈으로
// 바로 확인 가능하게 한다. 필드명이 실제 API와 다르면 이 내용을 보고 교정한다.
function pushDebug(label, payload) {
  const box = document.getElementById('marineAlertBox');
  if (!box) return;
  box.style.display = 'block';
  box.style.color = 'var(--text-lo)';
  box.style.fontFamily = "'SF Mono', Consolas, monospace";
  box.style.fontSize = '10.5px';
  box.style.whiteSpace = 'pre-wrap';
  box.style.maxHeight = '260px';
  box.style.overflowY = 'auto';
  const line = `[${label}] ${JSON.stringify(payload)}\n`;
  box.textContent = (box.textContent || '') + line;
}

export async function loadMarineStatus() {
  setText('marineStationName', STATION_NAME);
  const reqDate = todayYYYYMMDD();

  // 1) 수온/기온/기압 (조위관측소 실측)
  try {
    const { water, air, press } = await api.fetchMarineWeatherData(DT_STATION.code, reqDate);
    const waterItem = latestItem(water);
    const airItem = latestItem(air);
    const pressItem = latestItem(press);
    pushDebug('watertemp/airtemp/airpress raw', { waterItem, airItem, pressItem });

    const waterTemp = pickNumeric(waterItem, ['temp', 'tmp', 'wtr']);
    const airTemp = pickNumeric(airItem, ['temp', 'tmp', 'air']);
    const airPress = pickNumeric(pressItem, ['press', 'pres']);
    if (waterTemp !== null) setText('marineWaterTemp', `${waterTemp}℃`);
    if (airTemp !== null) setText('marineAirTemp', `${airTemp}℃`);
    if (airPress !== null) setText('marineAirPress', `${airPress}hPa`);

    const obsTime = pickText(waterItem || airItem || pressItem, ['time', 'date', 'dt']);
    if (obsTime) {
      setText('marineObsTime', obsTime);
      ui.renderFreshness(obsTime);
    }
  } catch (err) {
    console.warn('⚠ 수온/기온/기압 로드 실패:', err);
  }

  // 2) 풍향/풍속/파고 (기상청 단기예보, 포항 좌표 기준)
  try {
    const wind = await api.fetchWindData(DT_STATION.lat, DT_STATION.lon);
    pushDebug('wind raw', { windDirFrom: wind.windDirFrom, windSpeedMS: wind.windSpeedMS, waveHeightM: wind.waveHeightM });
    if (wind.windSpeedMS !== null) {
      const dirText = wind.windDirFrom !== null ? `${Math.round(wind.windDirFrom)}°` : '-';
      setText('marineWind', `${dirText} / ${wind.windSpeedMS}m/s`);
      ui.renderWindStatusPill(wind.windSpeedMS);
    }
    if (wind.waveHeightM !== null) {
      setText('marineWaveHeight', `${wind.waveHeightM}m`);
      ui.renderWaveStatusPill(wind.waveHeightM);
    }
  } catch (err) {
    console.warn('⚠ 풍향/풍속/파고 로드 실패:', err);
  }

  // 3) HF레이더 실측 유향/유속
  try {
    const hf = await api.fetchHfCurrentByStation(HF_STATION.code);
    const hfItem = latestItem(hf);
    pushDebug('hfcurrent raw', hfItem);
    const dir = pickNumeric(hfItem, ['crdir', 'dir']);
    const sp = pickNumeric(hfItem, ['crsp', 'speed', 'sp']);
    if (dir !== null && sp !== null) setText('marineHfCurrent', `${dir}° / ${sp}cm/s`);
  } catch (err) {
    console.warn('⚠ HF레이더 실측 로드 실패:', err);
  }

  // 4) 다음 만조/간조
  try {
    const tide = await api.fetchTideData(DT_STATION.code);
    const list = Array.isArray(tide) ? tide : tide ? [tide] : [];
    pushDebug('tide raw', list.slice(0, 3));
    const now = new Date();
    const upcoming = list.find((t) => {
      const timeStr = pickText(t, ['time', 'tph']);
      return timeStr && new Date(timeStr.replace(' ', 'T')) > now;
    });
    if (upcoming) {
      const kindRaw = pickText(upcoming, ['hl', 'code', 'type']) || '';
      const kind = kindRaw.includes('고') || kindRaw.toUpperCase().includes('H') ? '만조' : '간조';
      const timeStr = pickText(upcoming, ['time', 'tph']);
      setText('marineNextTide', `${kind} ${timeStr || ''}`);
    }
  } catch (err) {
    console.warn('⚠ 조석 로드 실패:', err);
  }

  // 5) 시정 (해무관측소)
  try {
    const fog = await api.fetchSeaFogData(SF_STATION.code, reqDate);
    const fogItem = latestItem(fog);
    pushDebug('seafog raw', fogItem);
    const vis = pickNumeric(fogItem, ['vis']);
    if (vis !== null) setText('marineVisibility', `${vis}m`);
  } catch (err) {
    console.warn('⚠ 시정 로드 실패:', err);
  }

  // ※ 기상특보(marineAlertBox)는 지역코드 체계가 달라 별도 매핑이 필요 - 다음 단계에서 추가.
}
