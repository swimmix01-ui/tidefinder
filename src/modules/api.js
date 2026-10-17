// ==========================================================================
// 외부 API 호출 전담 모듈
// ※ 이 파일은 fetch만 하고 반환한다 - DOM을 직접 건드리지 않는다.
//   "이 데이터를 화면에 어떻게 보여줄지"는 ui.js/predict.js의 책임이고,
//   이 파일의 책임은 오직 "데이터를 정확하게 받아오는 것"이다.
//   이렇게 분리해두면, 4단계(API 캐싱/재시도)에서 이 파일만 건드리면 된다.
// ==========================================================================
import { bearingToXY, latLonToGrid, distanceBetween } from "./geo.js";
import { kstParts, nearestForecast, finite } from "./model.js";

// 타임아웃이 있는 fetch. 외부 공공 API 응답이 느리거나 아예 안 올 때,
// await가 무한정 멈추는 걸 막는 안전장치.
export async function fetchWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`자료 수신 실패 (HTTP ${res.status})`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function getKmaBaseDateTime() {
  // Wait 15 minutes after a published cycle; never depend on the device timezone.
  const now = new Date(Date.now() - 15 * 60000),
    p = kstParts(now);
  let hour = [2, 5, 8, 11, 14, 17, 20, 23]
    .filter((h) => h <= Number(p.hour))
    .at(-1);
  if (hour === undefined)
    return {
      base_date: kstParts(new Date(now - 86400000)).compact,
      base_time: "2300",
    };
  return {
    base_date: p.compact,
    base_time: String(hour).padStart(2, "0") + "00",
  };
}

// 특정 시각에 가장 가까운 예보값을 카테고리별로 조회 (VEC/WSD/WAV 등)
export function getForecastValueAtTime(items, category, targetDate) {
  return nearestForecast(items, category, targetDate)?.value ?? null;
}

// 기상청 단기예보(풍향/풍속/파고) 조회 - 위경도 -> 격자좌표 변환 포함
export async function fetchWindData(lat, lon) {
  const { nx, ny } = latLonToGrid(lat, lon);
  const { base_date, base_time } = getKmaBaseDateTime();
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?nx=${nx}&ny=${ny}&base_date=${base_date}&base_time=${base_time}`,
    8000,
  );
  const data = await res.json();
  const items = data.response.body.items.item;
  // ※ 예보 배치는 3시간 간격으로 여러 시각의 값을 함께 담고 있어서, 배열의 첫 항목이
  //   아니라 "지금"과 가장 가까운 시각의 값을 골라야 한다 (안 그러면 새로고침 시점에 따라
  //   base_time 배치가 바뀌면서 값이 들쭉날쭉하게 보인다).
  const now = new Date();
  return {
    windDirFrom: getForecastValueAtTime(items, "VEC", now),
    windSpeedMS: getForecastValueAtTime(items, "WSD", now),
    waveHeightM: getForecastValueAtTime(items, "WAV", now),
    items, // 시간별 예보 전체 - 시간대별 벡터 변동 계산에 재사용 (추가 API 호출 없음)
    nx,
    ny,
    base_date,
    base_time,
  };
}

// KHOA 조류예측(격자) - 특정 미래 시각 재조회 (밀물/썰물 반전 반영용)
export async function fetchKhoaCurrentAt(targetDate, latC, lonC) {
  const { compact: ds, hour: hh, minute: mi } = kstParts(targetDate);
  const minXc = (lonC - 0.05).toFixed(5),
    maxXc = (lonC + 0.05).toFixed(5);
  const minYc = (latC - 0.05).toFixed(5),
    maxYc = (latC + 0.05).toFixed(5);
  try {
    const res = await fetchWithTimeout(
      `/.netlify/functions/weather?mode=khoacurrent&date=${ds}&hour=${hh}&minute=${mi}&minX=${minXc}&maxX=${maxXc}&minY=${minYc}&maxY=${maxYc}`,
      8000,
    );
    const d = await res.json();
    const points = d.result.data;
    if (!points || points.length === 0) return null;
    let minDist = Infinity,
      nearest = null;
    points.forEach((p) => {
      const dist =
        Math.pow(parseFloat(p.pre_lat) - latC, 2) +
        Math.pow(parseFloat(p.pre_lon) - lonC, 2);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    });
    if (!nearest) return null;
    const speed = Number(nearest.current_speed),
      dir = Number(nearest.current_dir);
    const distanceKm =
      distanceBetween(
        latC,
        lonC,
        Number(nearest.pre_lat),
        Number(nearest.pre_lon),
      ) / 1000;
    if (
      !finite(nearest.current_speed) ||
      !finite(nearest.current_dir) ||
      speed < 0 ||
      speed > 1000 ||
      dir < 0 ||
      dir > 360 ||
      distanceKm > 15
    )
      return null;
    return {
      speed,
      dir: dir % 360,
      distanceKm,
      time: targetDate.toISOString(),
      source: "KHOA 수치조류도 예측",
    };
  } catch (err) {
    return null; // 조회 실패 시 호출부에서 직전 시간대 값으로 대체
  }
}

// HF 레이더 실측 표층해류 조회 (특정 관측소)
export async function fetchHfCurrentByStation(stationCode) {
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=hfcurrent&obsCode=${stationCode}`,
    8000,
  );
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
  const ymin = (lat - buf).toFixed(5),
    ymax = (lat + buf).toFixed(5);
  const xmin = (lon - buf).toFixed(5),
    xmax = (lon + buf).toFixed(5);
  const reqUrl = `/.netlify/functions/weather?mode=roms&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}`;

  const res = await fetchWithTimeout(reqUrl, 8000);
  if (!res.ok) throw new Error(`ROMS HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  const items = data?.body?.items?.item || data?.response?.body?.items?.item;
  if (!items || items.length === 0) throw new Error("ROMS 데이터 없음");

  // 요청 좌표와 가장 가까운 격자점 하나를 찾는다
  let nearestPoint = null,
    minPointDist = Infinity;
  items.forEach((it) => {
    const ilat = parseFloat(it.lat),
      ilot = parseFloat(it.lot);
    if (isNaN(ilat) || isNaN(ilot)) return;
    const d = Math.pow(ilat - lat, 2) + Math.pow(ilot - lon, 2);
    if (d < minPointDist) {
      minPointDist = d;
      nearestPoint = { lat: ilat, lot: ilot };
    }
  });
  if (!nearestPoint) throw new Error("ROMS 격자점 좌표 파싱 실패");

  // 동일 격자점(허용오차 0.0001도 ≈ 11m)의 시계열만 추출
  const sameLocationItems = items.filter((it) => {
    const ilat = parseFloat(it.lat),
      ilot = parseFloat(it.lot);
    return (
      Math.abs(ilat - nearestPoint.lat) < 0.0001 &&
      Math.abs(ilot - nearestPoint.lot) < 0.0001
    );
  });

  return {
    items: sameLocationItems.length > 0 ? sameLocationItems : items,
    nearestPoint,
    distanceKm: Math.sqrt(minPointDist) * 111,
  };
}

// 조석예보(고조·저조) 조회
export async function fetchTideData(
  stationCode,
  reqDate = kstParts(new Date()).compact,
) {
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=tide&obsCode=${stationCode}&reqDate=${reqDate}`,
    8000,
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.body?.items?.item || data?.response?.body?.items?.item || null;
}

// 기상특보 조회
export async function fetchAlertData(stnId) {
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=alert&stnId=${stnId}`,
    8000,
  );
  const data = await res.json();
  return data?.response?.body?.items?.item || data?.body?.items?.item || null;
}

// 조위관측소 실측(수온/기온/기압) 조회 - 3개를 동시에
export async function fetchMarineWeatherData(obsCode, reqDate) {
  const [waterRes, airRes, pressRes] = await Promise.all([
    fetchWithTimeout(
      `/.netlify/functions/weather?mode=watertemp&obsCode=${obsCode}&reqDate=${reqDate}`,
    ),
    fetchWithTimeout(
      `/.netlify/functions/weather?mode=airtemp&obsCode=${obsCode}&reqDate=${reqDate}`,
    ),
    fetchWithTimeout(
      `/.netlify/functions/weather?mode=airpress&obsCode=${obsCode}&reqDate=${reqDate}`,
    ),
  ]);
  const [wData, aData, pData] = await Promise.all([
    waterRes.json(),
    airRes.json(),
    pressRes.json(),
  ]);
  return {
    water: wData?.body?.items?.item || wData?.response?.body?.items?.item,
    air: aData?.body?.items?.item || aData?.response?.body?.items?.item,
    press: pData?.body?.items?.item || pData?.response?.body?.items?.item,
  };
}

export async function fetchSeaFogData(obsCode, reqDate) {
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=seafog&obsCode=${obsCode}&reqDate=${reqDate}`,
  );
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
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=scuba&placeCode=${placeCode}&reqDate=${reqDate}`,
    8000,
  );
  const data = await res.json();
  if (!res.ok) return { httpError: res.status, detail: data };
  const item =
    data?.body?.items?.item || data?.response?.body?.items?.item || null;
  if (item) return item;
  return { rawResponse: data };
}

// 해양관측부이 최신 관측데이터 - 실측 파고(wvhgt)/풍향(wndrct)/풍속(wspd) 등.
// 스킨스쿠버 예보(폐기됨)를 대신하는 실측 소스. obsCode는 TW_ 관측소 코드만 유효.
export async function fetchTwRecent(obsCode, reqDate) {
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=twrecent&obsCode=${obsCode}&reqDate=${reqDate}&min=60`,
    8000,
  );
  const data = await res.json();
  if (!res.ok) return null;
  // ※ 이 API는 XML 응답과 달리 JSON 응답엔 최상위 <response> 래핑이 없다 - body가 루트에
  //   바로 온다({header, body}). response.body 경로로만 찾으면 항상 null이 되는 버그가
  //   있었음(2026-09-08 실측으로 확인) - 두 경로 다 시도해서 안전하게 처리.
  const item =
    data?.body?.items?.item || data?.response?.body?.items?.item || null;
  return Array.isArray(item) ? item[0] : item;
}

// 조위관측소 최신 관측데이터 - 실측 풍속(wspd)/풍향(wndrct) 등. 파고는 없음(조위관측소는
// 파고를 관측하지 않음 - 파고는 fetchTwRecent 쪽 해양관측부이에서만 나옴).
// obsCode는 DT_RECENT_STATIONS 전용 코드만 유효 (기존 DT_STATIONS와 번호 체계 다름).
export async function fetchDtRecent(obsCode, reqDate) {
  const res = await fetchWithTimeout(
    `/.netlify/functions/weather?mode=dtrecent&obsCode=${obsCode}&reqDate=${reqDate}&min=60`,
    8000,
  );
  const data = await res.json();
  if (!res.ok) return null;
  const item =
    data?.body?.items?.item || data?.response?.body?.items?.item || null;
  return Array.isArray(item) ? item[0] : item;
}

export { bearingToXY }; // predict.js 등에서 재사용 편의를 위한 re-export
