// ==========================================================================
// 표류 예측 메인 오케스트레이션
// ※ 이 파일이 기존 index.html의 거대한 runPrediction() 함수를 대체한다.
//   "무엇을 할지"의 순서만 여기 있고, "어떻게 계산할지"는 geo.js/api.js,
//   "어떻게 그릴지"는 map.js/ui.js에 위임한다 - 이 파일을 읽으면 예측
//   로직의 전체 흐름이 한눈에 들어오는 것이 목표다.
// ==========================================================================
import { HF_STATIONS, HF_COVERAGE_LIMIT_KM, CROSSWIND_DIVERGENCE_FALLBACK_DEG } from './modules/constants.js';
import {
  dmsToDecimal, bearingToXY, xyToBearingMag, destinationPoint,
  bearingBetween, distanceBetween, bearingToCompass,
} from './modules/geo.js';
import {
  fetchWithTimeout, fetchWindData, fetchKhoaCurrentAt, getForecastValueAtTime,
  fetchOpenMeteoMarine, seriesValueAt, fetchKmaSeaObs, nearestKmaSeaStation,
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

// HF 실측 비중 (시간 인덱스별). 0~1시간은 실측 그대로, 2·3시간째에 KHOA로 넘어가고
// 4시간째부터는 KHOA 시간별 예측만 쓴다.
const HF_WEIGHT_BY_HOUR = [1, 1, 0.67, 0.33];

// 기상청 부이 실측 바람의 시간별 비중(HF와 동일), 사용 거리 한도
const OBS_WEIGHT_BY_HOUR = [1, 1, 0.67, 0.33];
const OBS_MAX_KM = 50;

// 동시 요청 수를 제한한 병렬 처리 - 공공 API에 한꺼번에 수십 건을 쏘지 않기 위함.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i]); } catch (err) { results[i] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

// 예측 신뢰도(추정). 실제 받은 데이터의 출처·누락, 예측 시간, 해안선 데이터 여부로
// 점수를 깎는 방식 - 통계적으로 검증된 확률이 아니라 "이번 결과를 얼마나 믿어도
// 되는지"를 현장 판단용으로 보여주는 지표다. 감점 사유를 함께 반환해 화면에 표시한다.
export function computeConfidence({ usedHf, usedKhoaStart, khoaMissingHours, ahead, leewayCoefVal, usedWind, windSource, windObsLabel, coastlineLoaded, strandedAt }) {
  let score = 90;
  const reasons = [];

  if (usedHf) {
    reasons.push('해류: HF 레이더 실측(초기 2~3시간) + KHOA 예측');
  } else if (usedKhoaStart) {
    score -= 10;
    reasons.push('해류: KHOA 예측값(실측 아님)');
  } else {
    score -= 35;
    reasons.push('조류 데이터 수신 실패 - 기본값으로 계산');
  }

  if (ahead > 0 && khoaMissingHours > 0) {
    score -= Math.round((20 * khoaMissingHours) / ahead);
    reasons.push(`${khoaMissingHours}시간분 조류 예측 누락(직전 값으로 대체)`);
  }

  if (leewayCoefVal > 0) {
    if (!usedWind) {
      score -= 15;
      reasons.push('바람 데이터 없음 - 풍압 영향 미반영');
    } else if (windSource && windSource.startsWith('obs')) {
      if (windSource === 'obs' && ahead > 3) {
        score -= 8;
        reasons.push(`바람: 기상청 부이 실측(${windObsLabel}) - 예보 없음, 3시간 이후는 실측값 유지`);
      } else {
        reasons.push(`바람: 기상청 부이 실측(${windObsLabel}) → 이후 ${windSource.endsWith('openmeteo') ? 'Open-Meteo 해상' : '기상청'} 예보`);
        if (windSource.endsWith('kma') && ahead > 3) score -= 3;
      }
    } else if (windSource === 'openmeteo') {
      score -= 2;
      reasons.push('바람: Open-Meteo 해상 격자 예보(실측 아님)');
    } else {
      score -= 5;
      reasons.push('바람: 기상청 육상 격자 예보 기준(해상과 차이 가능)');
    }
  }

  if (ahead > 3) {
    score -= Math.min(25, (ahead - 3) * 2);
    reasons.push(`예측 ${ahead}시간 - 길수록 오차 누적`);
  }

  if (!coastlineLoaded) {
    score -= 10;
    reasons.push('해안선 데이터 미로드 - 좌초 판정 안 됨');
  }

  if (strandedAt) {
    score -= 5;
    reasons.push(`${strandedAt}시간째 해안 도달 - 연안 흐름은 불확실`);
  }

  score = Math.max(10, Math.min(95, score));
  const label = score >= 70 ? '높음' : score >= 45 ? '보통' : '낮음';
  return { score, label, reasons };
}

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
 * @param {object} input - { lat, lon, ahead, startDateTime, leewayCoefVal, crosswindAngleDeg }
 * @param {object} callbacks - { onStatus, onProgress } (선택)
 */
export async function runPrediction(input, callbacks = {}) {
  const { lat, lon, ahead, startDateTime, leewayCoefVal, crosswindAngleDeg = CROSSWIND_DIVERGENCE_FALLBACK_DEG } = input;
  const { onStatus = () => {}, onProgress = () => {} } = callbacks;

  let speed = 5.0, dir = 90, usedWind = false, waveHeightM = null, windSpeedMS = null, windDirFrom = null;
  let windSource = null, waveSource = null;
  let currentSource = 'KHOA 조류예측(기본값)', usedHf = false, usedKhoaStart = false;

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
          usedKhoaStart = true;
          onStatus('ok', '✅ 조류 수신 완료');
        }
      }
    } catch (err) { onStatus('warn', '⚠️ 기본값 연산 수행'); }
  }

  // ===== 바람·파고: Open-Meteo 해상 격자 예보 우선, 기상청 단기예보(육상 격자) 폴백 =====
  // 두 곳을 동시에 요청하고, Open-Meteo가 사고 시각의 풍향·풍속을 주면 그 시계열을 전 구간에
  // 쓴다. 섞어 쓰지 않는 이유: 모델이 다르면 같은 시각에도 값이 달라 궤적이 튈 수 있음.
  const endDateTime = new Date(startDateTime.getTime() + ahead * 3600000);
  // 기상청 부이 실측은 "지금" 값이라 사고 시각이 현재와 90분 넘게 차이나면 쓰지 않는다.
  const obsUsable = Math.abs(startDateTime.getTime() - Date.now()) <= 90 * 60000;
  const [omRes, kmaRes, obsRes] = await Promise.allSettled([
    fetchOpenMeteoMarine(lat, lon, startDateTime, endDateTime),
    fetchWindData(lat, lon),
    obsUsable ? fetchKmaSeaObs() : Promise.resolve([]),
  ]);
  const obsStations = obsRes.status === 'fulfilled' ? obsRes.value : [];
  const obsWind = nearestKmaSeaStation(obsStations, lat, lon, 'wind', OBS_MAX_KM);
  const obsWave = nearestKmaSeaStation(obsStations, lat, lon, 'wave', OBS_MAX_KM);
  const om = omRes.status === 'fulfilled' ? omRes.value : null;
  const kma = kmaRes.status === 'fulfilled' ? kmaRes.value : null;
  const omWindAt = (d) => {
    const sp = seriesValueAt(om?.windSpeed, d), dr = seriesValueAt(om?.windDirFrom, d);
    return sp !== null && dr !== null ? { speed: sp, dirFrom: dr } : null;
  };
  const kmaWindAt = (d) => {
    if (!kma?.items) return null;
    const sp = getForecastValueAtTime(kma.items, 'WSD', d), dr = getForecastValueAtTime(kma.items, 'VEC', d);
    return sp !== null && dr !== null && !isNaN(sp) && !isNaN(dr) ? { speed: sp, dirFrom: dr } : null;
  };
  const useOpenMeteoWind = omWindAt(startDateTime) !== null;
  const windAt = useOpenMeteoWind ? omWindAt : kmaWindAt;
  const w0 = useOpenMeteoWind
    ? omWindAt(startDateTime)
    : kma && kma.windSpeedMS !== null && kma.windDirFrom !== null ? { speed: kma.windSpeedMS, dirFrom: kma.windDirFrom } : null;
  const forecastWindSource = w0 ? (useOpenMeteoWind ? 'openmeteo' : 'kma') : null;
  if (obsWind) {
    // 초기 바람은 실측값. 이후 시간은 아래 시간별 계산에서 예보로 점차 넘긴다.
    windSpeedMS = obsWind.ws; windDirFrom = obsWind.wd; usedWind = true;
    windSource = forecastWindSource ? `obs+${forecastWindSource}` : 'obs';
  } else if (w0) {
    windSpeedMS = w0.speed; windDirFrom = w0.dirFrom; usedWind = true;
    windSource = forecastWindSource;
  }
  const windObsLabel = obsWind ? `${obsWind.name.trim()} ${Math.round(obsWind.distKm)}km` : null;
  const omWave = seriesValueAt(om?.waveHeight, startDateTime);
  if (obsWave) { waveHeightM = obsWave.wh; waveSource = 'obs'; }
  else if (omWave !== null) { waveHeightM = omWave; waveSource = 'openmeteo'; }
  else if (kma && kma.waveHeightM !== null && !isNaN(kma.waveHeightM)) { waveHeightM = kma.waveHeightM; waveSource = 'kma'; }

  const curDisp = speed * 0.01 * 3600;
  const curXY = bearingToXY(dir, curDisp);
  let wXY = { x: 0, y: 0 };
  if (usedWind) {
    const windageDisp = windSpeedMS * 3600 * leewayCoefVal;
    wXY = bearingToXY((windDirFrom + 180) % 360, windageDisp);
  }

  // ===== 조류 시간별 시계열 (반일주조 방향전환 반영) =====
  // HF 레이더는 "지금 이 순간"의 실측이라, 그 값 하나로 6시간 넘게 밀면 조류가
  // 반대로 바뀌는 걸 놓친다. 그래서 KHOA 시간별 예측은 HF 사용 여부와 상관없이
  // 항상 받아두고, HF를 썼다면 처음 몇 시간만 HF 비중을 두고 점차 KHOA로 넘긴다.
  // (조회는 동시에 최대 6개씩 - 예전엔 한 시간씩 차례로 기다려서 12시간 예측이면
  //  최악 12×8초가 걸렸다)
  const firstKhoaHour = usedHf ? 0 : 1;
  const khoaHours = [];
  for (let t = firstKhoaHour; t <= ahead; t++) khoaHours.push(t);
  const khoaResults = await mapWithConcurrency(khoaHours, 6, (t) =>
    fetchKhoaCurrentAt(new Date(startDateTime.getTime() + t * 3600000), lat, lon)
  );
  const khoaByHour = {};
  khoaHours.forEach((t, i) => {
    const c = khoaResults[i];
    khoaByHour[t] = c && !isNaN(c.speed) && !isNaN(c.dir) ? bearingToXY(c.dir, c.speed * 0.01 * 3600) : null;
  });
  if (!usedHf) khoaByHour[0] = curXY;

  const hourlyCurrentXY = [];
  let khoaMissingHours = 0;
  let prevXY = curXY;
  for (let t = 0; t <= ahead; t++) {
    const k = khoaByHour[t];
    if (t > 0 && !k) khoaMissingHours++;
    let v;
    if (usedHf) {
      const w = HF_WEIGHT_BY_HOUR[t] ?? 0;
      if (k) v = { x: w * curXY.x + (1 - w) * k.x, y: w * curXY.y + (1 - w) * k.y };
      else v = w > 0 ? curXY : prevXY; // KHOA 누락 시 직전 값 유지
    } else {
      v = k || prevXY;
    }
    hourlyCurrentXY.push(v);
    prevXY = v;
  }
  if (usedHf && khoaMissingHours < ahead && ahead > 1) currentSource += ' → 이후 KHOA 시간별 예측';

  // ===== 바람 시간별 사전계산 (궤적 계산과 500입자가 공유) =====
  let hourlyWindXY = null;
  // 실측이 있으면 0~1시간은 실측, 2·3시간째에 예보로 전환 (HF 조류와 같은 방식).
  // 예보가 아예 없으면 실측 구간이 끝난 뒤엔 직전 값을 유지한다.
  if (usedWind) {
    hourlyWindXY = [wXY];
    for (let t = 1; t <= ahead; t++) {
      const wt = windAt(new Date(startDateTime.getTime() + t * 3600000));
      const fc = wt ? bearingToXY((wt.dirFrom + 180) % 360, wt.speed * 3600 * leewayCoefVal) : null;
      const prev = hourlyWindXY[hourlyWindXY.length - 1];
      let v;
      if (obsWind) {
        const w = OBS_WEIGHT_BY_HOUR[t] ?? 0;
        v = fc ? { x: w * wXY.x + (1 - w) * fc.x, y: w * wXY.y + (1 - w) * fc.y } : w > 0 ? wXY : prev;
      } else {
        v = fc || prev;
      }
      hourlyWindXY.push(v);
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
    const currentVecT = hourlyCurrentXY[t];
    const windVecT = hourlyWindXY ? hourlyWindXY[t] : wXY;
    const windageMagT = Math.hypot(windVecT.x, windVecT.y);
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
  const crosswindTan = Math.tan((crosswindAngleDeg * Math.PI) / 180);
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
  // 조류·바람 기여도: 각 벡터를 합성 이동방향에 투영한 길이 ÷ 합성 이동속도.
  // (두 투영의 합 = 합성 속도라 두 값을 더하면 100%. 한쪽이 반대방향으로 밀면 그쪽은 0%로 표시)
  // ※ 이전엔 합성 속도 대신 조류 속도(combSpeedRough)로 나눠서 합이 100%가 아니었음 - 2026-11-16 수정
  const combX = curXY.x + wXY.x, combY = curXY.y + wXY.y;
  const combMag = Math.hypot(combX, combY);
  const projCurrent = combMag > 0 ? (curXY.x * combX + curXY.y * combY) / combMag : 0;
  const projWind = combMag > 0 ? (wXY.x * combX + wXY.y * combY) / combMag : 0;
  const underwaterMode = leewayCoefVal === 0;
  const currentPct = underwaterMode ? 100 : combMag > 0 ? Math.max(0, Math.min(100, Math.round((projCurrent / combMag) * 100))) : 0;
  const windPct = underwaterMode ? 0 : combMag > 0 ? Math.max(0, Math.min(100, Math.round((projWind / combMag) * 100))) : 0;
  const windSpeedPct = underwaterMode ? 0 : windSpeedMS !== null ? Math.min(100, Math.round((windSpeedMS / 15) * 100)) : 0;
  const wavePct = waveHeightM !== null ? Math.min(100, Math.round((waveHeightM / 3) * 100)) : 0;

  const risk = calculateAdvancedRisk(underwaterMode ? null : windSpeedMS, waveHeightM, null, null, null, null);

  const confidence = computeConfidence({
    usedHf, usedKhoaStart, khoaMissingHours, ahead, leewayCoefVal, usedWind, windSource, windObsLabel,
    coastlineLoaded: getCoastlineStatus().loaded, strandedAt,
  });

  ui.renderAIAnalysisCard({
    confidence, currentPct, windPct, windSpeedPct, wavePct, underwaterMode, risk,
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
    currentSource, windSource, windObsLabel, waveSource, setnetWarnings, coastlineStatus: getCoastlineStatus(),
    curSpeed: speed, curDir: dir, netDistM, confidence,
  };
}
