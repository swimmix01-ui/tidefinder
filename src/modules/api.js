// ==========================================================================
// 외부 API 호출 전담 모듈
// ※ 이 파일은 fetch만 하고 반환한다 - DOM을 직접 건드리지 않는다.
//   "이 데이터를 화면에 어떻게 보여줄지"는 ui.js/predict.js의 책임이고,
//   이 파일의 책임은 오직 "데이터를 정확하게 받아오는 것"이다.
//   이렇게 분리해두면, 4단계(API 캐싱/재시도)에서 이 파일만 건드리면 된다.
// ==========================================================================
import { bearingToXY, latLonToGrid } from './geo.js';

// 타임아웃이 있는 fetch. 외부 공공 API 응답이 느리거나 아예 안 올 때,
// await가 무한정 멈추는 걸 막는 안전장치.
export async function fetchWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getKmaBaseDateTime() {
  const times = [2, 5, 8, 11, 14, 17, 20, 23];
  const now = new Date();
  let cand = null;
  times.forEach((t) => {
    if (now.getHours() > t || (now.getHours() === t && now.getMinutes() >= 10)) cand = t;
  });
  let bDate = now;
  if (cand === null) {
    cand = 23;
    bDate = new Date(now.getTime() - 86400000);
  }
  return {
    base_date: `${bDate.getFullYear()}${String(bDate.getMonth() + 1).padStart(2, '0')}${String(bDate.getDate()).padStart(2, '0')}`,
    base_time: String(cand).padStart(2, '0') + '00',
  };
}

// 예보 항목 하나의 fcstDate+fcstTime을 실제 Date 객체로 변환
function parseFcstDateTime(item) {
  const d = item.fcstDate, t = item.fcstTime;
  return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00`);
}

// 특정 시각에 가장 가까운 예보값을 카테고리별로 조회 (VEC/WSD/WAV 등)
export function getForecastValueAtTime(items, category, targetDate) {
  const filtered = items.filter((i) => i.category === category);
  if (filtered.length === 0) return null;
  let best = filtered[0], bestDiff = Infinity;
  filtered.forEach((i) => {
    const diff = Math.abs(parseFcstDateTime(i) - targetDate);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return parseFloat(best.fcstValue);
}

// 기상청 단기예보(풍향/풍속/파고) 조회 - 위경도 -> 격자좌표 변환 포함
export async function fetchWindData(lat, lon) {
  const { nx, ny } = latLonToGrid(lat, lon);
  const { base_date, base_time } = getKmaBaseDateTime();
  const res = await fetchWithTimeout(`/.netlify/functions/weather?nx=${nx}&ny=${ny}&base_date=${base_date}&base_time=${base_time}`, 8000);
  const data = await res.json();
  const items = data.response.body.items.item;
  return {
    windDirFrom: items.find((i) => i.category === 'VEC') ? parseFloat(items.find((i) => i.category === 'VEC').fcstValue) : null,
    windSpeedMS: items.find((i) => i.category === 'WSD') ? parseFloat(items.find((i) => i.category === 'WSD').fcstValue) : null,
    waveHeightM: items.find((i) => i.category === 'WAV') ? parseFloat(items.find((i) => i.category === 'WAV').fcstValue) : null,
    items, // 시간별 예보 전체 - 시간대별 벡터 변동 계산에 재사용 (추가 API 호출 없음)
    nx, ny, base_date, base_time,
  };
}

// KHOA 조류예측(격자) - 특정 미래 시각 재조회 (밀물/썰물 반전 반영용)
export async function fetchKhoaCurrentAt(targetDate, latC, lonC) {
  const ds = `${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}${String(targetDate.getDate()).padStart(2, '0')}`;
  const hh = String(targetDate.getHours()).padStart(2, '0');
  const mi = String(targetDate.getMinutes()).padStart(2, '0');
  const minXc = (lonC - 0.05).toFixed(5), maxXc = (lonC + 0.05).toFixed(5);
  const minYc = (latC - 0.05).toFixed(5), maxYc = (latC + 0.05).toFixed(5);
  try {
    const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=khoacurrent&date=${ds}&hour=${hh}&minute=${mi}&minX=${minXc}&maxX=${maxXc}&minY=${minYc}&maxY=${maxYc}`, 8000);
    const d = await res.json();
    const points = d.result.data;
    if (!points || points.length === 0) return null;
    let minDist = Infinity, nearest = null;
    points.forEach((p) => {
      const dist = Math.pow(parseFloat(p.pre_lat) - latC, 2) + Math.pow(parseFloat(p.pre_lon) - lonC, 2);
      if (dist < minDist) { minDist = dist; nearest = p; }
    });
    if (!nearest) return null;
    return { speed: parseFloat(nearest.current_speed), dir: parseFloat(nearest.current_dir) };
  } catch (err) {
    return null; // 조회 실패 시 호출부에서 직전 시간대 값으로 대체
  }
}

// HF 레이더 실측 표층해류 조회 (특정 관측소)
export async function fetchHfCurrentByStation(stationCode) {
  const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=hfcurrent&obsCode=${stationCode}`, 8000);
  const data = await res.json();
  return data?.body?.items?.item || data?.response?.body?.items?.item || null;
}

// ==========================================================================
// ROMS(YES3K·MOHID300) 수치예측모델 조회
// ※ 공식 API 필드명은 lat/lot (lon 아님) - KHOA 오픈API 활용가이드 문서로 확인.
//   응답 박스 안에는 여러 격자점이 섞여올 수 있어, 반드시 공간(좌표) 최근접
//   필터링을 거쳐야 한다 (실제로 이걸 빼먹어서 방향이 반대로 나온 버그가 있었음).
// ==========================================================================
export async function fetchRomsData(lat, lon) {
  const buf = 0.05;
  const ymin = (lat - buf).toFixed(5), ymax = (lat + buf).toFixed(5);
  const xmin = (lon - buf).toFixed(5), xmax = (lon + buf).toFixed(5);
  const reqUrl = `/.netlify/functions/weather?mode=roms&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}`;

  const res = await fetchWithTimeout(reqUrl, 8000);
  if (!res.ok) throw new Error(`ROMS HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  const items = data?.body?.items?.item || data?.response?.body?.items?.item;
  if (!items || items.length === 0) throw new Error('ROMS 데이터 없음');

  // 요청 좌표와 가장 가까운 격자점 하나를 찾는다
  let nearestPoint = null, minPointDist = Infinity;
  items.forEach((it) => {
    const ilat = parseFloat(it.lat), ilot = parseFloat(it.lot);
    if (isNaN(ilat) || isNaN(ilot)) return;
    const d = Math.pow(ilat - lat, 2) + Math.pow(ilot - lon, 2);
    if (d < minPointDist) { minPointDist = d; nearestPoint = { lat: ilat, lot: ilot }; }
  });
  if (!nearestPoint) throw new Error('ROMS 격자점 좌표 파싱 실패');

  // 동일 격자점(허용오차 0.0001도 ≈ 11m)의 시계열만 추출
  const sameLocationItems = items.filter((it) => {
    const ilat = parseFloat(it.lat), ilot = parseFloat(it.lot);
    return Math.abs(ilat - nearestPoint.lat) < 0.0001 && Math.abs(ilot - nearestPoint.lot) < 0.0001;
  });

  return {
    items: sameLocationItems.length > 0 ? sameLocationItems : items,
    nearestPoint,
    distanceKm: Math.sqrt(minPointDist) * 111,
  };
}

// 조석예보(고조·저조) 조회
export async function fetchTideData(stationCode) {
  const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=tide&obsCode=${stationCode}`, 8000);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.body?.items?.item || data?.response?.body?.items?.item || null;
}

// 기상특보 조회
export async function fetchAlertData(stnId) {
  const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=alert&stnId=${stnId}`, 8000);
  const data = await res.json();
  return data?.response?.body?.items?.item || data?.body?.items?.item || null;
}

// 조위관측소 실측(수온/기온/기압) 조회 - 3개를 동시에
export async function fetchMarineWeatherData(obsCode, reqDate) {
  const [waterRes, airRes, pressRes] = await Promise.all([
    fetch(`/.netlify/functions/weather?mode=watertemp&obsCode=${obsCode}&reqDate=${reqDate}`),
    fetch(`/.netlify/functions/weather?mode=airtemp&obsCode=${obsCode}&reqDate=${reqDate}`),
    fetch(`/.netlify/functions/weather?mode=airpress&obsCode=${obsCode}&reqDate=${reqDate}`),
  ]);
  const [wData, aData, pData] = await Promise.all([waterRes.json(), airRes.json(), pressRes.json()]);
  return {
    water: wData?.body?.items?.item || wData?.response?.body?.items?.item,
    air: aData?.body?.items?.item || aData?.response?.body?.items?.item,
    press: pData?.body?.items?.item || pData?.response?.body?.items?.item,
  };
}

export async function fetchSeaFogData(obsCode, reqDate) {
  const res = await fetch(`/.netlify/functions/weather?mode=seafog&obsCode=${obsCode}&reqDate=${reqDate}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.body?.items?.item || data?.response?.body?.items?.item || null;
}

export { bearingToXY }; // predict.js 등에서 재사용 편의를 위한 re-export
