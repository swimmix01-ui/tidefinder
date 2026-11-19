// ==========================================================================
// 몬테카를로 시뮬레이션 Web Worker
// ※ 메인 스레드와 분리된 별도 스레드에서 실행된다. 입자 계산식은 mcmodel.js에 있고
//   (폴백 경로와 같은 함수를 쓴다), 이 파일은 반복·진행률 보고만 한다.
//   turf는 일부러 import하지 않는다 - 워커 번들을 가볍게 유지.
// ==========================================================================
import { simulateParticle } from './modules/mcmodel.js';

const PROGRESS_REPORT_INTERVAL = 100;

self.onmessage = function (e) {
  const d = e.data;
  const finalPoints = [];
  for (let p = 0; p < d.particleCount; p++) {
    finalPoints.push(simulateParticle(d, p % 2 ? 1 : -1));
    if (p % PROGRESS_REPORT_INTERVAL === 0) self.postMessage({ type: 'progress', done: p });
  }
  self.postMessage({ type: 'done', finalPoints });
};
