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
  // ※ 예보 배치는 3시간 간격으로 여러 시각의 값을 함께 담고 있어서, 배열의 첫 항목이
  //   아니라 "지금"과 가장 가까운 시각의 값을 골라야 한다 (안 그러면 새로고침 시점에 따라
  //   base_time 배치가 바뀌면서 값이 들쭉날쭉하게 보인다).
  const now = new Date();
  return {
    windDirFrom: getForecastValueAtTime(items, 'VEC', now),
    windSpeedMS: getForecastValueAtTime(items, 'WSD', now),
    waveHeightM: getForecastValueAtTime(items, 'WAV', now),
    items, // 시간별 예보 전체 - 시간대별 벡터 변동 계산에 재사용 (추가 API 호출 없음)
    nx, ny, base_date, base_time,
  };
}

// Open-Meteo 해상 격자 예보 - 풍향/풍속(10m) + 파고, 시간별.
// 기상청 단기예보는 육상용 격자라 해상 지점에서 값이 낮게 나오거나 비는 경우가 있어서
// 해상 격자에서 바로 계산된 값을 우선 쓴다. 키 없이 브라우저에서 직접 호출(CORS 허용).
//  - 바람: api.open-meteo.com 기본 best_match(지역별 최적 전지구/지역 모델 자동 선택)
//    ※ Open-Meteo의 기상청(KMA) 모델 피드는 기상청 모델 교체(2026-03)로 중단 상태라 지정하지 않음
//  - 파고: marine-api.open-meteo.com (ECMWF WAM / GFS Wave 등 파랑모델)
//  - cell_selection=sea: 해안 근처 좌표에서도 육지 셀이 아니라 바다 셀 값을 쓰게 함
//  - 비상업적 이용 무료, 출처표시 필요(화면·README에 표기)
// 반환: { times: [ms...], windSpeed: [m/s], windDirFrom: [°], waveHeight: [m] } - 실패 항목은 null 배열
export async function fetchOpenMeteoMarine(lat, lon, startDate, endDate) {
  const now = Date.now();
  const pastHours = Math.min(2000, Math.max(1, Math.ceil((now - startDate.getTime()) / 3600000) + 1));
  const forecastHours = Math.min(384, Math.max(1, Math.ceil((endDate.getTime() - now) / 3600000) + 2));
  const common = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timeformat=unixtime&cell_selection=sea&past_hours=${pastHours}&forecast_hours=${forecastHours}`;
  const [windRes, waveRes] = await Promise.allSettled([
    fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${common}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`, 8000).then((r) => r.json()),
    fetchWithTimeout(`https://marine-api.open-meteo.com/v1/marine?${common}&hourly=wave_height`, 8000).then((r) => r.json()),
  ]);
  const toSeries = (res, key) => {
    if (res.status !== 'fulfilled' || !res.value?.hourly?.time) return null;
    const h = res.value.hourly;
    return { times: h.time.map((s) => s * 1000), values: h[key] };
  };
  return {
    windSpeed: toSeries(windRes, 'wind_speed_10m'),
    windDirFrom: toSeries(windRes, 'wind_direction_10m'),
    waveHeight: toSeries(waveRes, 'wave_height'),
  };
}

// 기상청 API허브 해양 종합 관측(해양기상부이·파고부이·등표 등) - 전국 지점 최신 1건씩.
// 같은 화면에서 해상상태 카드와 예측이 거의 동시에 부르므로 5분간 결과를 공유한다.
let kmaSeaCache = null;
export async function fetchKmaSeaObs() {
  if (kmaSeaCache && Date.now() - kmaSeaCache.at < 5 * 60000) return kmaSeaCache.promise;
  const promise = fetchWithTimeout('/.netlify/functions/weather?mode=kmasea', 10000)
    .then((r) => r.json())
    .then((d) => (Array.isArray(d.stations) ? d.stations : []));
  kmaSeaCache = { at: Date.now(), promise };
  promise.catch(() => { kmaSeaCache = null; });
  return promise;
}

const MARINE_WIND_TYPES = ['B', 'L', 'J'];

// 사고 지점에서 가장 가까운 관측 지점 (해당 항목 값이 있는 지점만, maxKm 이내)
// field: 'wave' → 유의파고(wh), 'wind' → 풍향·풍속(wd, ws)
export function nearestKmaSeaStation(stations, lat, lon, field, maxKm = 50) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  let best = null;
  (stations || []).forEach((s) => {
    // 바람은 바다 위 관측(B 해양기상부이, L 등표, J 기상1호)만 쓴다. 조위관측소(N)·연안방재(F)는
    // 항구·해안 육상이라 지형에 막혀 해상풍보다 훨씬 약하게 나온다
    // (2026-11-16 풍랑주의보 중 포항 2km 지점 3.3m/s 표시 확인).
    const ok = field === 'wave' ? s.wh !== null : s.wd !== null && s.ws !== null && MARINE_WIND_TYPES.includes(s.tp);
    if (!ok) return;
    const dLat = toRad(s.lat - lat), dLon = toRad(s.lon - lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(s.lat)) * Math.sin(dLon / 2) ** 2;
    const distKm = 2 * R * Math.asin(Math.sqrt(a));
    if (distKm <= maxKm && (!best || distKm < best.distKm)) best = { ...s, distKm };
  });
  return best;
}

// 시계열에서 목표 시각과 가장 가까운 유효값 (2시간 넘게 떨어진 값은 버림)
export function seriesValueAt(series, targetDate) {
  if (!series || !series.times?.length) return null;
  const t = targetDate.getTime();
  let best = null, bestDiff = Infinity;
  series.times.forEach((ts, i) => {
    const v = series.values[i];
    if (v === null || v === undefined || isNaN(v)) return;
    const diff = Math.abs(ts - t);
    if (diff < bestDiff) { bestDiff = diff; best = v; }
  });
  return bestDiff <= 2 * 3600000 ? best : null;
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

// 스킨스쿠버 예보 (국립해양조사원) - 다이빙 지점 전용 파고/수온/시정 예보.
// ⚠ 2026-09-08 기준: returnReasonCode 12(NO_OPENAPI_SERVICE_ERROR)로 확인됨 - 이건
//   "활용신청 미승인"(코드 20번대)이 아니라 "해당 오픈API 서비스가 없거나 폐기됨"이라는
//   뜻이라, 승인을 기다린다고 해결되지 않는다. GetFcstSkinScubaApiServiceV2 자체가
//   data.go.kr에서 폐기됐거나 서비스 ID가 바뀐 것으로 보임 - 재사용하려면 포털에서
//   대체 서비스명부터 새로 찾아야 한다. marine.js에서는 이 함수 호출을 뺐다(2026-09-08).
export async function fetchScubaForecast(placeCode, reqDate) {
  const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=scuba&placeCode=${placeCode}&reqDate=${reqDate}`, 8000);
  const data = await res.json();
  if (!res.ok) return { httpError: res.status, detail: data };
  const item = data?.body?.items?.item || data?.response?.body?.items?.item || null;
  if (item) return item;
  return { rawResponse: data };
}

// 해양관측부이 최신 관측데이터 - 실측 파고(wvhgt)/풍향(wndrct)/풍속(wspd) 등.
// 스킨스쿠버 예보(폐기됨)를 대신하는 실측 소스. obsCode는 TW_ 관측소 코드만 유효.
export async function fetchTwRecent(obsCode, reqDate) {
  const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=twrecent&obsCode=${obsCode}&reqDate=${reqDate}&min=60`, 8000);
  const data = await res.json();
  if (!res.ok) return null;
  // ※ 이 API는 XML 응답과 달리 JSON 응답엔 최상위 <response> 래핑이 없다 - body가 루트에
  //   바로 온다({header, body}). response.body 경로로만 찾으면 항상 null이 되는 버그가
  //   있었음(2026-09-08 실측으로 확인) - 두 경로 다 시도해서 안전하게 처리.
  const item = data?.body?.items?.item || data?.response?.body?.items?.item || null;
  return Array.isArray(item) ? item[0] : item;
}

// 조위관측소 최신 관측데이터 - 실측 풍속(wspd)/풍향(wndrct) 등. 파고는 없음(조위관측소는
// 파고를 관측하지 않음 - 파고는 fetchTwRecent 쪽 해양관측부이에서만 나옴).
// obsCode는 DT_RECENT_STATIONS 전용 코드만 유효 (기존 DT_STATIONS와 번호 체계 다름).
export async function fetchDtRecent(obsCode, reqDate) {
  const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=dtrecent&obsCode=${obsCode}&reqDate=${reqDate}&min=60`, 8000);
  const data = await res.json();
  if (!res.ok) return null;
  const item = data?.body?.items?.item || data?.response?.body?.items?.item || null;
  return Array.isArray(item) ? item[0] : item;
}

export { bearingToXY }; // predict.js 등에서 재사용 편의를 위한 re-export
