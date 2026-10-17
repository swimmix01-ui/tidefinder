import { CROSSWIND_DIVERGENCE_FALLBACK_DEG } from "./modules/constants.js";
import {
  bearingToXY,
  xyToBearingMag,
  destinationPoint,
  bearingBetween,
  distanceBetween,
} from "./modules/geo.js";
import { fetchWindData, fetchKhoaCurrentAt } from "./modules/api.js";
import {
  ensureCoastlineReady,
  getCoastlineStatus,
  getLocalCoastline,
  checkSegmentCrossesCoastline,
  getLocalSetnets,
  findNearbySetnets,
} from "./modules/coastline.js";
import {
  runMonteCarloSimulationWorker,
  runMonteCarloSimulationFallback,
  computeConvexHull,
} from "./modules/montecarlo.js";
import { calculateAdvancedRisk } from "./modules/risk.js";
import {
  validateInput,
  nearestForecast,
  vectorShares,
  uncertaintyRadius,
} from "./modules/model.js";
import * as mapModule from "./modules/map.js";
import * as ui from "./modules/ui.js";

// Each step samples the current at the evolving centre position and interval midpoint.
// HF observations remain an independent comparison; a snapshot is never extended as a forecast.
export async function runPrediction(input, callbacks = {}) {
  validateInput(input);
  const {
    lat,
    lon,
    ahead,
    startDateTime,
    leewayCoefVal,
    manualCurrent,
    manualWind,
    allowNoCoastline = false,
    allowCurrentOnly = false,
    initialErrorM = 100,
    crosswindAngleDeg = CROSSWIND_DIVERGENCE_FALLBACK_DEG,
  } = input;
  const { onStatus = () => {}, onProgress = () => {} } = callbacks;
  await ensureCoastlineReady();
  const coastlineStatus = getCoastlineStatus();
  if (!coastlineStatus.loaded && !allowNoCoastline)
    throw new Error(
      "해안선 자료를 불러오지 못했습니다. 재시도하거나 해안선 미적용 허용을 선택하세요.",
    );
  const warnings = [];
  if (!coastlineStatus.loaded)
    warnings.push("해안선 미적용: 육지 통과·좌초 판정 없음");
  if (manualCurrent)
    warnings.push("수동 유속·유향을 전 기간에 고정 적용한 가정 시나리오");
  if (manualWind)
    warnings.push("수동 풍속·풍향을 전 기간에 고정 적용한 가정 시나리오");
  if (leewayCoefVal === 0)
    warnings.push(
      "수중 실종: 표층 조류만 사용한 참고 경로. 수심별 흐름·침강·부력 미반영",
    );
  let windData = null,
    windError = null;
  if (!manualWind && leewayCoefVal > 0) {
    try {
      windData = await fetchWindData(lat, lon);
    } catch (e) {
      windError = e.message;
    }
  }
  let curLat = lat,
    curLon = lon,
    strandedAt = null,
    totalPathM = 0,
    totalWindM = 0;
  const cLine = [{ lat, lon }],
    samples = [
      { lat, lon, time: startDateTime.toISOString(), radius: initialErrorM },
    ];
  const hourlyRadii = { 0: initialErrorM },
    hourlyCurrentXY = [{ x: 0, y: 0 }],
    hourlyWindXY = [{ x: 0, y: 0 }],
    sourceSteps = [];
  const currentTotal = { x: 0, y: 0 },
    windTotal = { x: 0, y: 0 };
  const setnetWarnings = [],
    seen = new Set();
  let firstCurrent = null,
    windMissing = false,
    waveHeightM = null,
    lastWindSpeed = null;
  for (let t = 1; t <= ahead; t++) {
    onStatus("busy", `⏳ ${t}/${ahead}시간 자료·경로 계산 중`);
    const targetTime = new Date(startDateTime.getTime() + (t - 0.5) * 3600000);
    const current = manualCurrent
      ? {
          ...manualCurrent,
          source: "현장 수동 입력",
          time: targetTime.toISOString(),
          distanceKm: 0,
        }
      : await fetchKhoaCurrentAt(targetTime, curLat, curLon);
    if (!current)
      throw new Error(
        `${t}시간 구간의 조류 자료가 없습니다. 임의 유속으로 대체하지 않습니다. 현장 실측값 수동 입력을 사용할 수 있습니다.`,
      );
    firstCurrent ||= current;
    const curXY = bearingToXY(current.dir, current.speed * 0.01 * 3600);
    let wXY = { x: 0, y: 0 },
      windSample = null;
    if (leewayCoefVal > 0) {
      const wsd = manualWind
        ? { value: manualWind.speed, time: targetTime.toISOString() }
        : nearestForecast(windData?.items, "WSD", targetTime);
      const vec = manualWind
        ? { value: manualWind.dir, time: targetTime.toISOString() }
        : nearestForecast(windData?.items, "VEC", targetTime);
      if (wsd && vec && wsd.value >= 0 && vec.value >= 0 && vec.value <= 360) {
        wXY = bearingToXY(
          (vec.value + 180) % 360,
          wsd.value * 3600 * leewayCoefVal,
        );
        lastWindSpeed = wsd.value;
        windSample = {
          speed: wsd.value,
          from: vec.value,
          time: wsd.time,
          source: manualWind ? "현장 수동 입력" : "기상청 단기예보",
        };
      } else {
        if (!allowCurrentOnly)
          throw new Error(
            `${t}시간 구간의 바람 자료가 없습니다. 조류만 계산하려면 바람 미반영 허용을 선택하세요.`,
          );
        windMissing = true;
      }
      waveHeightM =
        nearestForecast(windData?.items, "WAV", targetTime)?.value ??
        waveHeightM;
    }
    const comb = xyToBearingMag(curXY.x + wXY.x, curXY.y + wXY.y);
    const next = destinationPoint(curLat, curLon, comb.bearing, comb.magnitude);
    // Query each segment's full travel extent (including wind), not a fixed initial buffer.
    const bufferKm = Math.max(5, comb.magnitude / 1000 + 2);
    const coast = getLocalCoastline(curLat, curLon, bufferKm);
    const hit = checkSegmentCrossesCoastline(
      curLat,
      curLon,
      next.lat,
      next.lon,
      coast,
    );
    const end = hit || next;
    const fraction =
      hit && comb.magnitude > 0
        ? Math.min(
            1,
            distanceBetween(curLat, curLon, end.lat, end.lon) / comb.magnitude,
          )
        : 1;
    const nearby = findNearbySetnets(
      curLat,
      curLon,
      end.lat,
      end.lon,
      getLocalSetnets(curLat, curLon, bufferKm),
      300,
    );
    for (const sn of nearby)
      if (!seen.has(sn.lcns_no)) {
        seen.add(sn.lcns_no);
        setnetWarnings.push({ ...sn, hour: t - 1 + fraction });
      }
    totalPathM += distanceBetween(curLat, curLon, end.lat, end.lon);
    totalWindM += Math.hypot(wXY.x, wXY.y) * fraction;
    currentTotal.x += curXY.x * fraction;
    currentTotal.y += curXY.y * fraction;
    windTotal.x += wXY.x * fraction;
    windTotal.y += wXY.y * fraction;
    const elapsed = t - 1 + fraction;
    const radius = uncertaintyRadius(
      totalPathM,
      totalWindM,
      elapsed,
      crosswindAngleDeg,
      waveHeightM,
      initialErrorM,
    );
    hourlyRadii[t] = radius;
    curLat = end.lat;
    curLon = end.lon;
    cLine.push({ lat: curLat, lon: curLon });
    samples.push({
      lat: curLat,
      lon: curLon,
      time: new Date(startDateTime.getTime() + elapsed * 3600000).toISOString(),
      radius,
    });
    hourlyCurrentXY.push(curXY);
    hourlyWindXY.push(wXY);
    sourceSteps.push({
      hour: t,
      position: { lat: cLine[t - 1].lat, lon: cLine[t - 1].lon },
      current,
      wind: windSample,
    });
    if (hit) {
      strandedAt = elapsed;
      break;
    }
  }
  if (windMissing)
    warnings.push(
      `바람 미반영 구간 존재${windError ? " (기상 자료 수신 실패)" : ""}: 표류경로·확산구역이 과소평가될 수 있음`,
    );
  if (!manualWind && leewayCoefVal > 0)
    warnings.push(
      "바람은 사고 원점의 예보 격자를 시간별 적용. 이동 위치별 바람 재조회는 미적용",
    );
  const actualHours = (new Date(samples.at(-1).time) - startDateTime) / 3600000;
  const netDistM = distanceBetween(lat, lon, curLat, curLon),
    combBrng = bearingBetween(lat, lon, curLat, curLon),
    combSpeed = actualHours > 0 ? netDistM / actualHours : 0;
  const finalPoint = { lat: curLat, lon: curLon },
    finalErrorRadius = samples.at(-1).radius;
  const shares = vectorShares(currentTotal, windTotal);
  const risk = calculateAdvancedRisk(
    lastWindSpeed,
    waveHeightM,
    null,
    null,
    firstCurrent.speed / 51.4444,
    null,
  );
  const result = {
    combBrng,
    combSpeed,
    actualHours,
    finalErrorRadius,
    finalPoint,
    strandedAt,
    currentSource: firstCurrent.source,
    setnetWarnings,
    coastlineStatus,
    curSpeed: firstCurrent.speed,
    curDir: firstCurrent.dir,
    netDistM,
    totalPathM,
    samples,
    hourlyRadii,
    sourceSteps,
    warnings,
    inputLat: lat,
    inputLon: lon,
    startDateTime: startDateTime.toISOString(),
    ahead,
    manual: !!manualCurrent || !!manualWind,
    leewayCoefVal,
    crosswindAngleDeg,
    windMissing,
    initialErrorM,
    modelVersion: "3.0-field",
    createdAt: new Date().toISOString(),
    risk,
  };
  mapModule.renderPredictionPath({
    startLat: lat,
    startLon: lon,
    pathPoints: cLine,
    hourlyRadii,
    strandedAt,
    finalErrorRadius,
  });
  ui.renderAIAnalysisCard({
    qualityLabel: result.manual
      ? "수동 가정 포함"
      : windMissing || !coastlineStatus.loaded
        ? "제한 있음"
        : "자료 확보",
    ...shares,
    windSpeedPct:
      lastWindSpeed !== null
        ? Math.min(100, Math.round((lastWindSpeed / 15) * 100))
        : 0,
    wavePct:
      waveHeightM !== null
        ? Math.min(100, Math.round((waveHeightM / 3) * 100))
        : 0,
    underwaterMode: leewayCoefVal === 0,
    risk,
    explain: `누적 벡터 크기 비중: 조류 ${shares.currentPct}% / 풍압 ${shares.windPct}%. 서로 반대 방향이면 상쇄됩니다. 위치 적중 확률이 아닙니다.`,
  });
  ui.renderSearchRecommendationCard({
    startLat: lat,
    startLon: lon,
    combinedBearing: combBrng,
    finalErrorRadius,
    finalPoint,
  });
  const monteCarloParams = {
    lat,
    lon,
    ahead: cLine.length - 1,
    curXY: hourlyCurrentXY[1],
    hourlyCurrentXY,
    usedWind: leewayCoefVal > 0,
    hourlyWindXY,
    wXY: hourlyWindXY[1],
    localCoastline: getLocalCoastline(
      lat,
      lon,
      Math.max(20, (totalPathM / 1000) * 2 + finalErrorRadius / 1000 + 5),
    ),
    crosswindAngleDeg,
    initialErrorM,
    stepHours: samples
      .slice(1)
      .map((p, i) => (new Date(p.time) - new Date(samples[i].time)) / 3600000),
  };
  try {
    const pts = await runMonteCarloSimulationWorker(
      monteCarloParams,
      onProgress,
    ).catch(() =>
      runMonteCarloSimulationFallback(monteCarloParams, onProgress),
    );
    const hull = computeConvexHull(pts);
    result.simulationHull = hull;
    if (hull) mapModule.renderMonteCarloHull(hull);
  } catch (e) {
    warnings.push("입자 시뮬레이션 실패: 중심 경로만 표시");
  }
  return result;
}
