// ==========================================================================
// 몬테카를로 시뮬레이션 오케스트레이션
// ※ Web Worker(별도 스레드)를 우선 시도하고, 워커 생성/실행이 안 되는
//   구형/제한된 환경에서만 메인 스레드 청크분할 방식으로 자동 폴백한다.
//   입자 1개 계산식은 mcmodel.js (워커와 공용).
// ==========================================================================
import * as turf from '@turf/turf';
import { simulateParticle } from './mcmodel.js';

const PARTICLE_COUNT = 1000;

function workerPayload(params) {
  return {
    lat: params.lat, lon: params.lon, ahead: params.ahead,
    hourlyCurrentXY: params.hourlyCurrentXY, hourlyWindXY: params.usedWind ? params.hourlyWindXY : null,
    crosswindDeg: params.crosswindDeg, posErrM: params.posErrM,
    localCoastline: params.localCoastline, particleCount: PARTICLE_COUNT,
  };
}

export function runMonteCarloSimulationWorker(params, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('이 브라우저는 Web Worker를 지원하지 않습니다'));
      return;
    }
    // Vite 워커 문법 - src/worker.js가 별도 번들로 묶여 워커 스레드에서 실행된다.
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
    worker.postMessage(workerPayload(params));
  });
}

// 폴백 경로 - 워커 생성이 실패하는 구형 환경용. 메인 스레드에서 한 틱씩 양보하며 계산.
export async function runMonteCarloSimulationFallback(params, onProgress) {
  const d = workerPayload(params);
  const CHUNK_SIZE = 100;
  const finalPoints = [];
  for (let start = 0; start < PARTICLE_COUNT; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, PARTICLE_COUNT);
    for (let p = start; p < end; p++) finalPoints.push(simulateParticle(d, p % 2 ? 1 : -1));
    onProgress?.(end, PARTICLE_COUNT);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return finalPoints;
}

// 입자 전체의 컨벡스헐 (예전 방식, 참고용으로 유지)
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

// 확률 수색구역: 입자 분포 중심에서 가까운 순(마할라노비스 거리)으로 50%·90%를 잘라
// 각각 볼록다각형으로 만든다. 1차 수색 = 50% 구역, 2차 = 90% 구역.
// 반환: { center, r50, r90, area50Km2, area90Km2, strandedPct }
export function computeSearchRegions(points) {
  if (!points || points.length < 10) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.lon, 0) / n;
  const my = points.reduce((s, p) => s + p.lat, 0) / n;
  const kx = 111320 * Math.cos((my * Math.PI) / 180), ky = 111320; // 도 → m
  let sxx = 0, syy = 0, sxy = 0;
  points.forEach((p) => {
    const dx = (p.lon - mx) * kx, dy = (p.lat - my) * ky;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  });
  sxx /= n; syy /= n; sxy /= n;
  const det = sxx * syy - sxy * sxy;
  const md = det > 1e-6
    ? (p) => { const dx = (p.lon - mx) * kx, dy = (p.lat - my) * ky; return (syy * dx * dx - 2 * sxy * dx * dy + sxx * dy * dy) / det; }
    : (p) => ((p.lon - mx) * kx) ** 2 + ((p.lat - my) * ky) ** 2;
  const sorted = points.slice().sort((a, b) => md(a) - md(b));
  const hullOf = (pts) => computeConvexHull(pts);
  const r50 = hullOf(sorted.slice(0, Math.ceil(n * 0.5)));
  const r90 = hullOf(sorted.slice(0, Math.ceil(n * 0.9)));
  const areaKm2 = (f) => { try { return f ? turf.area(f) / 1e6 : null; } catch { return null; } };
  // 50% 구역 안 입자들의 중심 = 수색 기준점(datum)
  const core = sorted.slice(0, Math.ceil(n * 0.5));
  const center = { lat: core.reduce((s, p) => s + p.lat, 0) / core.length, lon: core.reduce((s, p) => s + p.lon, 0) / core.length };
  const strandedPct = Math.round((points.filter((p) => p.stranded).length / n) * 100);
  return { center, r50, r90, area50Km2: areaKm2(r50), area90Km2: areaKm2(r90), strandedPct };
}
