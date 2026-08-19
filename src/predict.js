// ==========================================================================
// 표류 예측 메인 오케스트레이션
// ※ 이 파일이 기존 index.html의 거대한 runPrediction() 함수를 대체한다.
//   "무엇을 할지"의 순서만 여기 있고, "어떻게 계산할지"는 geo.js/api.js,
//   "어떻게 그릴지"는 map.js/ui.js에 위임한다 - 이 파일을 읽으면 예측
//   로직의 전체 흐름이 한눈에 들어오는 것이 목표다.
// ==========================================================================
import { HF_STATIONS, HF_COVERAGE_LIMIT_KM } from './modules/constants.js';
import {
  dmsToDecimal, bearingToXY, xyToBearingMag, destinationPoint,
  bearingBetween, distanceBetween, bearingToCompass,
} from './modules/geo.js';
import {
  fetchWithTimeout, fetchWindData, fetchKhoaCurrentAt, getForecastValueAtTime,
} from './modules/api.js';
import {
  getLocalCoastline, checkSegmentCrossesCoastline, getLocalSetnets, findNearbySetnets,
  getCoastlineStatus,
} from './modules/coastline.js';
import {
  runMonteCarloSimulationWorker, runMonteCarloSimulationFallback, computeConvexHull,
} from './modules/montecarlo.js';
import { calculateAdvancedRisk } from './modules/risk.js';
import * as mapModule from './modules/map.js';
import * as ui from './modules/ui.js';

function findNearestHFStation(targetLat, targetLon) {
  let nearest = HF_STATIONS[0], minDist = Infinity;
  HF_STATIONS.forEach((station) => {
    const d = Math.pow(station.lat - targetLat, 2) + Math.pow(station.lon - targetLon, 2);
    if (d < minDist) { minDist = d; nearest = station; }
  });
  return { ...nearest, distKm: Math.sqrt(minDist) * 111 };
}

/**
 * 표류 예측 전체 파이프라인을 실행한다.
 * @param {object} input - { lat, lon, ahead, startDateTime, leewayCoefVal }
 * @param {object} callbacks - { onStatus, onProgress } (선택)
 */
export async function runPrediction(input, callbacks = {}) {
  const { lat, lon, ahead, startDateTime, leewayCoefVal } = input;
  const { onStatus = () => {}, onProgress = () => {} } = callbacks;

  let speed = 5.0, dir = 90, usedWind = false, waveHeightM = null, windSpeedMS = null, windDirFrom = null, fcstItemsForHourly = null;
  let currentSource = 'KHOA 조류예측(기본값)', usedHf = false;

  // ===== ① 1순위: HF 레이더 실측 =====
  const hfStation = findNearestHFStation(lat, lon);
  try {
    const hfRes = await fetchWithTimeout(`/.netlify/functions/weather?mode=hfcurrent&obsCode=${hfStation.code}`, 8000);
    const hfData = await hfRes.json();
    const hfItems = hfData?.body?.items?.item || hfData?.response?.body?.items?.item;
    if (hfItems && hfItems.length > 0 && hfStation.distKm <= HF_COVERAGE_LIMIT_KM) {
      let minDist = Infinity, nearestHf = null;
      hfItems.forEach((p) => {
        const plat = parseFloat(p.lat), plon = parseFloat(p.lot);
        const d = Math.pow(plat - lat, 2) + Math.pow(plon - lon, 2);
        if (d < minDist) { minDist = d; nearestHf = p; }
      });
      if (nearestHf && !isNaN(parseFloat(nearestHf.crsp))) {
        speed = parseFloat(nearestHf.crsp);
        dir = parseFloat(nearestHf.crdir);
        usedHf = true;
        currentSource = `HF 레이더 실측(${hfStation.name}, ${Math.round(hfStation.distKm)}km)`;
        onStatus('ok', '✅ HF 레이더 실측 해류 사용');
      }
    }
  } catch (err) { /* HF 실패 시 조용히 KHOA로 폴백 */ }

  // ===== ② 2순위(폴백): KHOA 조류예측 격자 =====
  if (!usedHf) {
    try {
      const dateStr = `${startDateTime.getFullYear()}${String(startDateTime.getMonth() + 1).padStart(2, '0')}${String(startDateTime.getDate()).padStart(2, '0')}`;
      const hour = String(startDateTime.getHours()).padStart(2, '0');
      const minute = String(startDateTime.getMinutes()).padStart(2, '0');
      const minX = (lon - 0.05).toFixed(5), maxX = (lon + 0.05).toFixed(5), minY = (lat - 0.05).toFixed(5), maxY = (lat + 0.05).toFixed(5);
      const res = await fetchWithTimeout(`/.netlify/functions/weather?mode=khoacurrent&date=${dateStr}&hour=${hour}&minute=${minute}&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}`, 8000);
      const d = await res.json();
      const points = d.result.data;
      if (points && points.length > 0) {
        let minDist = Infinity, nearest = null;
        points.forEach((p) => {
          const dist = Math.pow(parseFloat(p.pre_lat) - lat, 2) + Math.pow(parseFloat(p.pre_lon) - lon, 2);
          if (dist < minDist) { minDist = dist; nearest = p; }
        });
        if (nearest) {
          speed = parseFloat(nearest.current_speed);
          dir = parseFloat(nearest.current_dir);
          currentSource = `KHOA 조류예측(격자, 최근접점 ${(Math.sqrt(minDist) * 111).toFixed(1)}km)`;
          onStatus('ok', '✅ 조류 수신 완료');
        }
      }
    } catch (err) { onStatus('warn', '⚠️ 기본값 연산 수행'); }
  }

  // ===== 기상청 바람 데이터 =====
  try {
    const w = await fetchWindData(lat, lon);
    windSpeedMS = w.windSpeedMS; windDirFrom = w.windDirFrom; waveHeightM = w.waveHeightM; fcstItemsForHourly = w.items;
    if (windSpeedMS !== null && windDirFrom !== null) usedWind = true;
  } catch (e) { /* 바람 데이터 없이 진행 */ }

  const curDisp = speed * 0.01 * 3600;
  const curXY = bearingToXY(dir, curDisp);
  let wXY = { x: 0, y: 0 };
  if (usedWind) {
    const windageDisp = windSpeedMS * 3600 * leewayCoefVal;
    wXY = bearingToXY((windDirFrom + 180) % 360, windageDisp);
  }

  // ===== 조류 시간별 재조회 (KHOA 폴백일 때만 - 반일주조 방향전환 반영) =====
  let hourlyCurrentXY = null;
  if (!usedHf) {
    hourlyCurrentXY = [curXY];
    for (let t = 1; t <= ahead; t++) {
      const targetTime = new Date(startDateTime.getTime() + t * 3600000);
      const c = await fetchKhoaCurrentAt(targetTime, lat, lon);
      hourlyCurrentXY.push(c && !isNaN(c.speed) ? bearingToXY(c.dir, c.speed * 0.01 * 3600) : hourlyCurrentXY[hourlyCurrentXY.length - 1]);
    }
  }

  // ===== 바람 시간별 사전계산 (500입자가 공유 - 성능 최적화, 정확도 영향 없음) =====
  let hourlyWindXY = null;
  if (usedWind && fcstItemsForHourly) {
    hourlyWindXY = [wXY];
    for (let t = 1; t <= ahead; t++) {
      const targetTime = new Date(startDateTime.getTime() + t * 3600000);
      const wsdT = getForecastValueAtTime(fcstItemsForHourly, 'WSD', targetTime);
      const vecT = getForecastValueAtTime(fcstItemsForHourly, 'VEC', targetTime);
      hourlyWindXY.push(
        wsdT !== null && vecT !== null
          ? bearingToXY((vecT + 180) % 360, wsdT * 3600 * leewayCoefVal)
          : hourlyWindXY[hourlyWindXY.length - 1]
      );
    }
  }

  // ===== 시간별 궤적 계산 + 해안선 좌초판정 =====
  const combSpeedRough = curDisp; // 버퍼 산정용 대략치
  const coastlineBufferKm = Math.max(20, ((combSpeedRough * ahead) / 1000) * 2 + 10);
  const localCoastline = getLocalCoastline(lat, lon, coastlineBufferKm);
  const localSetnets = getLocalSetnets(lat, lon, coastlineBufferKm);
  const setnetWarnings = [];
  const seenLcns = new Set();

  const cLine = [{ lat, lon }];
  let curLat = lat, curLon = lon;
  let cumWindageDisp = 0;
  const cumWindageByHour = [0];
  let strandedAt = null;

  for (let t = 1; t <= ahead; t++) {
    const currentVecT = hourlyCurrentXY ? hourlyCurrentXY[t] : curXY;
    let windVecT = wXY, windageMagT = 0;
    if (usedWind && fcstItemsForHourly) {
      const targetTime = new Date(startDateTime.getTime() + t * 3600000);
      const wsdT = getForecastValueAtTime(fcstItemsForHourly, 'WSD', targetTime);
      const vecT = getForecastValueAtTime(fcstItemsForHourly, 'VEC', targetTime);
      if (wsdT !== null && vecT !== null) {
        windageMagT = wsdT * 3600 * leewayCoefVal;
        windVecT = bearingToXY((vecT + 180) % 360, windageMagT);
      }
    }
    cumWindageDisp += windageMagT;
    cumWindageByHour.push(cumWindageDisp);

    const combT = xyToBearingMag(currentVecT.x + windVecT.x, currentVecT.y + windVecT.y);
    const next = destinationPoint(curLat, curLon, combT.bearing, combT.magnitude);

    const hit = checkSegmentCrossesCoastline(curLat, curLon, next.lat, next.lon, localCoastline);
    if (hit) {
      curLat = hit.lat; curLon = hit.lon;
      cLine.push({ lat: curLat, lon: curLon });
      strandedAt = t;
      break;
    }

    const nearby = findNearbySetnets(curLat, curLon, next.lat, next.lon, localSetnets, 300);
    nearby.forEach((sn) => {
      if (!seenLcns.has(sn.lcns_no)) { seenLcns.add(sn.lcns_no); setnetWarnings.push({ ...sn, hour: t }); }
    });

    curLat = next.lat; curLon = next.lon;
    cLine.push({ lat: curLat, lon: curLon });
  }

  const actualHours = cLine.length - 1;
  const netDistM = distanceBetween(lat, lon, curLat, curLon);
  const combBrng = bearingBetween(lat, lon, curLat, curLon);
  const combSpeed = netDistM / actualHours;

  // ===== 오차반경 (좌우발산 포함) =====
  const wFactor = waveHeightM ? waveHeightM * 0.02 : 0;
  const crosswindTan = Math.tan((20 * Math.PI) / 180); // TODO: 표류물 종류별 각도는 다음 단계에서 UI 연결
  const hourlyRadii = { 0: 0 };
  let finalErrorRadius = 0;
  cLine.slice(1).forEach((_, idx) => {
    const hourNum = idx + 1;
    const crosswindAdd = cumWindageByHour[hourNum] * crosswindTan;
    const r = 50 + (0.15 + wFactor) * (combSpeed * hourNum) + crosswindAdd;
    hourlyRadii[hourNum] = r;
    if (hourNum === actualHours) finalErrorRadius = Math.round(r);
  });

  // ===== 지도 렌더링 =====
  mapModule.renderPredictionPath({ startLat: lat, startLon: lon, pathPoints: cLine, hourlyRadii, strandedAt, finalErrorRadius });

  const finalPoint = cLine[cLine.length - 1];

  // ===== AI 분석 카드 데이터 =====
  const combX = curXY.x + wXY.x, combY = curXY.y + wXY.y;
  const projCurrent = combSpeedRough > 0 ? (curXY.x * combX + curXY.y * combY) / combSpeedRough : 0;
  const projWind = combSpeedRough > 0 ? (wXY.x * combX + wXY.y * combY) / combSpeedRough : 0;
  const underwaterMode = leewayCoefVal === 0;
  const currentPct = underwaterMode ? 100 : Math.max(0, Math.min(100, Math.round((projCurrent / combSpeedRough) * 100)));
  const windPct = underwaterMode ? 0 : Math.max(0, Math.min(100, Math.round((projWind / combSpeedRough) * 100)));
  const windSpeedPct = underwaterMode ? 0 : windSpeedMS !== null ? Math.min(100, Math.round((windSpeedMS / 15) * 100)) : 0;
  const wavePct = waveHeightM !== null ? Math.min(100, Math.round((waveHeightM / 3) * 100)) : 0;

  const risk = calculateAdvancedRisk(underwaterMode ? null : windSpeedMS, waveHeightM, null, null, null, null);

  ui.renderAIAnalysisCard({
    confidence: 80, currentPct, windPct, windSpeedPct, wavePct, underwaterMode, risk,
    explain: `현재 ${currentPct >= windPct ? '조류' : '바람(풍압)'}의 영향이 최종 이동방향에 가장 크게 기여하고 있습니다 (조류 ${currentPct}% / 바람 ${windPct}%).`,
  });

  ui.renderSearchRecommendationCard({ startLat: lat, startLon: lon, combinedBearing: combBrng, finalErrorRadius, finalPoint });

  // ===== 몬테카를로 시뮬레이션 (백그라운드) =====
  const monteCarloParams = { lat, lon, ahead, curXY, hourlyCurrentXY, usedWind, hourlyWindXY, wXY, localCoastline };
  try {
    const finalPoints = await runMonteCarloSimulationWorker(monteCarloParams, onProgress).catch(() =>
      runMonteCarloSimulationFallback(monteCarloParams, onProgress)
    );
    const hull = computeConvexHull(finalPoints);
    if (hull) mapModule.renderMonteCarloHull(hull);
  } catch (err) {
    console.warn('몬테카를로 시뮬레이션 실패(메인 예측 결과에는 영향 없음):', err);
  }

  return {
    combBrng, combSpeed, actualHours, finalErrorRadius, finalPoint, strandedAt,
    currentSource, setnetWarnings, coastlineStatus: getCoastlineStatus(),
  };
}
