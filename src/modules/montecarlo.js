// ==========================================================================
// 몬테카를로 시뮬레이션 오케스트레이션
// ※ Web Worker(별도 스레드)를 우선 시도하고, 워커 생성/실행이 안 되는
//   구형/제한된 환경에서만 메인 스레드 청크분할 방식으로 자동 폴백한다.
// ==========================================================================
import * as turf from '@turf/turf';
import { bearingToXY, xyToBearingMag, destinationPoint, gaussianRandom, findCoastlineIntersection } from './geo.js';

const PARTICLE_COUNT = 500;

export function runMonteCarloSimulationWorker(params, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('이 브라우저는 Web Worker를 지원하지 않습니다'));
      return;
    }

    // ★ Vite 워커 문법: 이 한 줄이면 src/worker.js가 통째로 별도 번들로 묶여
    //   워커 스레드에서 실행된다. { type: 'module' }을 반드시 붙여야
    //   worker.js 안의 import 구문이 정상 동작한다.
    const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('몬테카를로 워커 시간 초과'));
    }, 25000);

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onProgress?.(e.data.done, PARTICLE_COUNT);
      } else if (e.data.type === 'done') {
        clearTimeout(timer);
        worker.terminate();
        resolve(e.data.finalPoints);
      }
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    };

    worker.postMessage({
      lat: params.lat, lon: params.lon, ahead: params.ahead, curXY: params.curXY,
      hourlyCurrentXY: params.hourlyCurrentXY, usedWind: params.usedWind,
      hourlyWindXY: params.hourlyWindXY, wXY: params.wXY,
      localCoastline: params.localCoastline, particleCount: PARTICLE_COUNT,
    });
  });
}

// 폴백 경로 - 워커 생성이 실패하는 구형 환경용. 메인 스레드에서 setTimeout(0)으로
// 한 틱씩 양보(yield)해서 완전히 멈추진 않지만, 워커 방식만큼 매끄럽진 않다.
export async function runMonteCarloSimulationFallback(params, onProgress) {
  const { lat, lon, ahead, curXY, hourlyCurrentXY, usedWind, hourlyWindXY, wXY, localCoastline } = params;
  const CHUNK_SIZE = 50;
  const CURRENT_SPEED_STD = 0.125, CURRENT_DIR_STD_DEG = 6, WIND_SPEED_STD = 0.125, WIND_DIR_STD_DEG = 8;
  const finalPoints = [];

  for (let batchStart = 0; batchStart < PARTICLE_COUNT; batchStart += CHUNK_SIZE) {
    const batchEnd = Math.min(batchStart + CHUNK_SIZE, PARTICLE_COUNT);
    for (let p = batchStart; p < batchEnd; p++) {
      let pLat = lat, pLon = lon;
      for (let t = 1; t <= ahead; t++) {
        const baseCurXY = hourlyCurrentXY ? hourlyCurrentXY[t] : curXY;
        const baseCur = xyToBearingMag(baseCurXY.x, baseCurXY.y);
        const curSpeedFactor = Math.max(0, 1 + gaussianRandom(0, CURRENT_SPEED_STD));
        const curDirOffset = gaussianRandom(0, CURRENT_DIR_STD_DEG);
        const pCurXY = bearingToXY(baseCur.bearing + curDirOffset, baseCur.magnitude * curSpeedFactor);

        const baseWindXY = usedWind && hourlyWindXY ? hourlyWindXY[t] : wXY;
        const baseWind = xyToBearingMag(baseWindXY.x, baseWindXY.y);
        const windSpeedFactor = Math.max(0, 1 + gaussianRandom(0, WIND_SPEED_STD));
        const windDirOffset = gaussianRandom(0, WIND_DIR_STD_DEG);
        const pWindXY = baseWind.magnitude > 0
          ? bearingToXY(baseWind.bearing + windDirOffset, baseWind.magnitude * windSpeedFactor)
          : { x: 0, y: 0 };

        const combP = xyToBearingMag(pCurXY.x + pWindXY.x, pCurXY.y + pWindXY.y);
        const next = destinationPoint(pLat, pLon, combP.bearing, combP.magnitude);

        const hit = findCoastlineIntersection(pLat, pLon, next.lat, next.lon, localCoastline);
        if (hit) { pLat = hit.lat; pLon = hit.lon; break; }
        pLat = next.lat; pLon = next.lon;
      }
      finalPoints.push({ lat: pLat, lon: pLon });
    }
    onProgress?.(batchEnd, PARTICLE_COUNT);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return finalPoints;
}

// 500개 입자의 최종 도달 위치로 컨벡스헐(볼록껍질)을 구해 확률 수색구역 다각형을 만든다.
export function computeConvexHull(points) {
  if (points.length < 3) return null;
  try {
    const fc = turf.featureCollection(points.map((p) => turf.point([p.lon, p.lat])));
    return turf.convex(fc);
  } catch (err) {
    console.warn('컨벡스헐 계산 실패:', err);
    return null;
  }
}
