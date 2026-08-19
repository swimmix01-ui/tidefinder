// ==========================================================================
// 상단 "현재 해상 상태" 카드 로더
// ※ Vite 리팩토링 과정에서 이 부분(카드에 실측/예보값 채우는 로직)이 빠져있어서
//   화면에 전부 "-"로만 나오던 문제를 해결하기 위해 새로 작성함.
//   각 API의 실제 필드명은 배포된 상태에서 원본 응답을 직접 확인해 확정했다.
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

export async function loadMarineStatus() {
  setText('marineStationName', STATION_NAME);
  const reqDate = todayYYYYMMDD();

  // 1) 수온/기온/기압 (조위관측소 실측) - 필드명: wtem/artmp/atmpr
  try {
    const { water, air, press } = await api.fetchMarineWeatherData(DT_STATION.code, reqDate);
    const waterItem = latestItem(water);
    const airItem = latestItem(air);
    const pressItem = latestItem(press);

    const waterTemp = pickNumeric(waterItem, ['wtem', 'temp', 'tmp', 'wtr']);
    const airTemp = pickNumeric(airItem, ['artmp', 'temp', 'tmp', 'air']);
    const airPress = pickNumeric(pressItem, ['atmpr', 'press', 'pres']);
    if (waterTemp !== null) setText('marineWaterTemp', `${waterTemp}℃`);
    if (airTemp !== null) setText('marineAirTemp', `${airTemp}℃`);
    if (airPress !== null) setText('marineAirPress', `${airPress}hPa`);

    const obsTime = pickText(waterItem || airItem || pressItem, ['obsrvndt', 'time', 'date', 'dt']);
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

  // 3) HF레이더 실측 유향/유속 - 필드명: crdir/crsp
  try {
    const hf = await api.fetchHfCurrentByStation(HF_STATION.code);
    const hfItem = latestItem(hf);
    const dir = pickNumeric(hfItem, ['crdir', 'dir']);
    const sp = pickNumeric(hfItem, ['crsp', 'speed', 'sp']);
    if (dir !== null && sp !== null) setText('marineHfCurrent', `${dir}° / ${sp}cm/s`);
  } catch (err) {
    console.warn('⚠ HF레이더 실측 로드 실패:', err);
  }

  // 4) 다음 만조/간조 - 필드명: predcDt(시각)/predcTdlvVl(조위값)/extrSe(극값구분)
  //    extrSe: 1=고고조, 2=저고조, 3=고저조, 4=저저조 → 1·2는 만조, 3·4는 간조로 단순화
  try {
    const tide = await api.fetchTideData(DT_STATION.code);
    const list = Array.isArray(tide) ? tide : tide ? [tide] : [];
    const now = new Date();
    const upcoming = list.find((t) => {
      const timeStr = pickText(t, ['predcdt', 'time', 'tph', 'dt']);
      return timeStr && new Date(timeStr.replace(' ', 'T')) > now;
    });
    if (upcoming) {
      const extrSe = pickText(upcoming, ['extrse']);
      const kind = extrSe === '1' || extrSe === '2' ? '만조' : extrSe === '3' || extrSe === '4' ? '간조' : '조위 변화';
      const timeStr = pickText(upcoming, ['predcdt', 'time', 'tph', 'dt']);
      const level = pickNumeric(upcoming, ['predctdlvvl', 'lvl', 'level']);
      setText('marineNextTide', `${kind} ${timeStr || ''}${level !== null ? ` (${level}cm)` : ''}`);
    }
  } catch (err) {
    console.warn('⚠ 조석 로드 실패:', err);
  }

  // 5) 시정 (해무관측소) - 필드명: dtvsbV20kLen (탐지가시거리, m 단위)
  try {
    const fog = await api.fetchSeaFogData(SF_STATION.code, reqDate);
    const fogItem = latestItem(fog);
    const visRaw = pickNumeric(fogItem, ['dtvsbv', 'vsb', 'vis']);
    if (visRaw !== null) {
      setText('marineVisibility', visRaw >= 1000 ? `${(visRaw / 1000).toFixed(1)}km` : `${visRaw}m`);
    }
  } catch (err) {
    console.warn('⚠ 시정 로드 실패:', err);
  }

  // ※ 기상특보(marineAlertBox)는 지역코드 체계가 달라 별도 매핑이 필요 - 다음 단계에서 추가.
}
