// ==========================================================================
// 상단 "현재 해상 상태" 카드 로더
// ※ Vite 리팩토링 과정에서 이 부분(카드에 실측/예보값 채우는 로직)이 빠져있어서
//   화면에 전부 "-"로만 나오던 문제를 해결하기 위해 새로 작성함.
//   각 API의 실제 필드명은 배포된 상태에서 원본 응답을 직접 확인해 확정했다.
//   좌표(lat, lon)를 넘기면 그 지점에서 가장 가까운 관측소 데이터를 보여준다 -
//   지도를 클릭하거나 "내 위치"를 쓰면 그 위치 기준으로 다시 불러온다.
// ==========================================================================
import * as api from './api.js';
import * as ui from './ui.js';
import { DT_STATIONS, HF_STATIONS, SF_STATIONS, getKmaStnId } from './constants.js';

const DEFAULT_STATION_NAME = '포항';
const DEFAULT_DT = DT_STATIONS.find((s) => s.name === DEFAULT_STATION_NAME) || { code: 'DT_0091', lat: 36.03, lon: 129.38, name: '포항' };

// HF레이더 실측값이 이 시간(시간 단위)보다 오래되면 "오래된 데이터"로 표시한다.
const HF_STALE_HOURS = 3;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestStation(list, lat, lon) {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return list[0];
  let best = list[0];
  let bestDist = Infinity;
  for (const s of list) {
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

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

function hoursSince(dateStr) {
  const t = new Date(dateStr.replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  return (Date.now() - t.getTime()) / 3600000;
}

/**
 * @param {{lat?: number, lon?: number}} [coords] - 기준 좌표. 생략하면 포항 기본 관측소를 쓴다.
 */
// 값이 채워지는 필드들 - 로딩 시작 시 "불러오는 중"으로, 끝나고도 안 채워진 건 "-"로 정리한다.
const MARINE_VALUE_IDS = [
  'marineWaterTemp', 'marineAirTemp', 'marineAirPress', 'marineWaveHeight',
  'marineWind', 'marineVisibility', 'marineHfCurrent', 'marineNextTide',
];
const LOADING_TEXT = '불러오는 중…';

export async function loadMarineStatus(coords = {}) {
  MARINE_VALUE_IDS.forEach((id) => setText(id, LOADING_TEXT));

  const lat = coords.lat ?? DEFAULT_DT.lat;
  const lon = coords.lon ?? DEFAULT_DT.lon;
  const dtStation = nearestStation(DT_STATIONS, lat, lon);
  const hfStation = nearestStation(HF_STATIONS, lat, lon);
  const sfStation = nearestStation(SF_STATIONS, lat, lon);
  const windLat = lat;
  const windLon = lon;

  setText('marineStationName', dtStation.name);
  const reqDate = todayYYYYMMDD();

  // 1) 수온/기온/기압 (조위관측소 실측) - 필드명: wtem/artmp/atmpr
  try {
    const { water, air, press } = await api.fetchMarineWeatherData(dtStation.code, reqDate);
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

  // 2) 풍향/풍속/파고 (기상청 단기예보, 기준 좌표)
  try {
    const wind = await api.fetchWindData(windLat, windLon);
    if (wind.windSpeedMS !== null) {
      const dirText = wind.windDirFrom !== null ? `${Math.round(wind.windDirFrom)}°` : '-';
      setText('marineWind', `${dirText} / ${wind.windSpeedMS}m/s`);
      ui.renderWindStatusPill(wind.windSpeedMS);
    }
    if (wind.waveHeightM !== null) {
      // ※ 기상청 단기예보 격자(육상용)라 해안 인접 지점에서 0으로 나오기 쉽다.
      //   다이버 전용 예보 API는 아직 활용신청이 안 되어 있어 못 붙였다(참고: NO_OPENAPI_SERVICE_ERROR).
      //   실제 파고는 현장에서 육안으로 반드시 재확인할 것.
      setText('marineWaveHeight', `${wind.waveHeightM}m*`);
      ui.renderWaveStatusPill(wind.waveHeightM);
    }
  } catch (err) {
    console.warn('⚠ 풍향/풍속/파고 로드 실패:', err);
  }

  // 3) HF레이더 실측 유향/유속 - 필드명: crdir/crsp
  //    관측소가 너무 멀거나(커버리지 밖), 데이터가 오래됐으면 그 사실을 같이 표시한다.
  try {
    const distKm = lat != null && lon != null ? haversineKm(lat, lon, hfStation.lat, hfStation.lon) : 0;
    const hf = await api.fetchHfCurrentByStation(hfStation.code);
    const hfItem = latestItem(hf);
    const dir = pickNumeric(hfItem, ['crdir', 'dir']);
    const sp = pickNumeric(hfItem, ['crsp', 'speed', 'sp']);
    const hfTime = pickText(hfItem, ['obsrvndt', 'time', 'dt']);
    const ageHours = hfTime ? hoursSince(hfTime) : null;
    if (dir !== null && sp !== null) {
      let text = `${dir}° / ${sp}cm/s`;
      if (ageHours !== null && ageHours >= HF_STALE_HOURS) text += ` (${Math.floor(ageHours)}시간 전 - 오래됨)`;
      if (distKm > 50) text += ` (관측소 ${Math.round(distKm)}km 거리 - 참고용)`;
      setText('marineHfCurrent', text);
    }
  } catch (err) {
    console.warn('⚠ HF레이더 실측 로드 실패:', err);
  }

  // 4) 다음 만조/간조 - 필드명: predcDt(시각)/predcTdlvVl(조위값)/extrSe(극값구분)
  //    extrSe: 1=고고조, 2=저고조, 3=고저조, 4=저저조 → 1·2는 만조, 3·4는 간조로 단순화
  try {
    const tide = await api.fetchTideData(dtStation.code);
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
    const fog = await api.fetchSeaFogData(sfStation.code, reqDate);
    const fogItem = latestItem(fog);
    const visRaw = pickNumeric(fogItem, ['dtvsbv', 'vsb', 'vis']);
    if (visRaw !== null) {
      setText('marineVisibility', visRaw >= 1000 ? `${(visRaw / 1000).toFixed(1)}km` : `${visRaw}m`);
    }
  } catch (err) {
    console.warn('⚠ 시정 로드 실패:', err);
  }

  // 6) 기상특보 (태풍/풍랑/폭풍해일 등) - 없으면 평상시엔 표시 안 함
  //    ※ 필드명은 실제 특보 발효 상황에서 아직 검증 못했다 - 문구가 안 뜨거나
  //      이상하면 원본 응답을 확인해서 pickText 키워드를 교정해야 한다.
  try {
    const box = document.getElementById('marineAlertBox');
    if (box) { box.style.display = 'none'; box.textContent = ''; }
    const stnId = getKmaStnId(dtStation.lat, dtStation.lon);
    const alerts = await api.fetchAlertData(stnId);
    const list = Array.isArray(alerts) ? alerts : alerts ? [alerts] : [];
    const seaAlerts = list.filter((a) => {
      const title = pickText(a, ['title', 'wrnvar', 'msg']) || '';
      const isSeaRelated = /풍랑|태풍|폭풍해일|해일/.test(title);
      const isCanceled = /해제/.test(title);
      return isSeaRelated && !isCanceled;
    });
    if (box && seaAlerts.length > 0) {
      const lines = seaAlerts.slice(0, 3).map((a) => pickText(a, ['title', 'wrnvar', 'msg']) || '특보 발효 중');
      box.textContent = `⚠ ${lines.join(' / ')}`;
      box.style.display = 'block';
    }
  } catch (err) {
    console.warn('⚠ 기상특보 로드 실패:', err);
  }

  // 끝까지 값을 못 채운 필드는 "불러오는 중" 문구를 지우고 "-"로 정리한다.
  MARINE_VALUE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.textContent === LOADING_TEXT) el.textContent = '-';
  });
}
