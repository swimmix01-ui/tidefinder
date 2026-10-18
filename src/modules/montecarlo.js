// ==========================================================================
// 몬테카를로 시뮬레이션 오케스트레이션
// ※ Web Worker(별도 스레드)를 우선 시도하고, 워커 생성/실행이 안 되는
//   구형/제한된 환경에서만 메인 스레드 청크분할 방식으로 자동 폴백한다.
// ==========================================================================
import * as turf from "@turf/turf";
import { simulateParticle } from "./particles.js";

const PARTICLE_COUNT = 500;

export function runMonteCarloSimulationWorker(params, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("이 브라우저는 Web Worker를 지원하지 않습니다"));
      return;
    }

    // ★ Vite 워커 문법: 이 한 줄이면 src/worker.js가 통째로 별도 번들로 묶여
    //   워커 스레드에서 실행된다. { type: 'module' }을 반드시 붙여야
    //   worker.js 안의 import 구문이 정상 동작한다.
    const worker = new Worker(new URL("../worker.js", import.meta.url), {
      type: "module",
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("몬테카를로 워커 시간 초과"));
    }, 25000);

    worker.onmessage = (e) => {
      if (e.data.type === "progress") {
        onProgress?.(e.data.done, PARTICLE_COUNT);
      } else if (e.data.type === "done") {
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

    worker.postMessage({ ...params, particleCount: PARTICLE_COUNT });
  });
}

// 폴백 경로 - 워커 생성이 실패하는 구형 환경용. 메인 스레드에서 setTimeout(0)으로
// 한 틱씩 양보(yield)해서 완전히 멈추진 않지만, 워커 방식만큼 매끄럽진 않다.
export async function runMonteCarloSimulationFallback(params, onProgress) {
  const finalPoints = [];
  for (let p = 0; p < PARTICLE_COUNT; p++) {
    finalPoints.push(simulateParticle(params));
    if (p % 25 === 0) {
      onProgress?.(p, PARTICLE_COUNT);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return finalPoints;
}

// 500개 입자의 최종 도달 위치로 컨벡스헐(볼록껍질)을 구해 시뮬레이션 외곽 다각형 (확률 보장 없음)을 만든다.
export function computeConvexHull(points) {
  if (points.length < 3) return null;
  try {
    const fc = turf.featureCollection(
      points.map((p) => turf.point([p.lon, p.lat])),
    );
    return turf.convex(fc);
  } catch (err) {
    console.warn("컨벡스헐 계산 실패:", err);
    return null;
  }
}
