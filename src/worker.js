// ==========================================================================
// 몬테카를로 시뮬레이션 Web Worker
// ※ 이 파일은 메인 스레드와 완전히 분리된 별도 스레드에서 실행된다.
//   기존엔 문자열 배열을 Blob으로 감싸서 워커를 만들었는데, Vite에서는
//   `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`
//   문법으로 이 파일을 그대로 워커로 띄울 수 있다. 장점:
//     1) 문법 하이라이팅·자동완성이 그대로 적용된다
//     2) import로 geo.js의 순수 함수를 재사용할 수 있다 (코드 중복 제거)
//     3) 오타를 컴파일 타임(빌드 타임)에 잡아낼 수 있다
//   turf는 일부러 import하지 않는다 - geo.js의 findCoastlineIntersection이
//   turf 없는 순수 JS 버전이라, 워커 번들이 가볍게 유지된다.
// ==========================================================================
import { bearingToXY, xyToBearingMag, destinationPoint, gaussianRandom, findCoastlineIntersection } from './modules/geo.js';

const CURRENT_SPEED_STD = 0.125; // 조류 유속 오차 표준편차 ±12.5%
const CURRENT_DIR_STD_DEG = 6;   // 조류 유향 오차 표준편차
const WIND_SPEED_STD = 0.125;    // 바람 풍속 오차 표준편차
const WIND_DIR_STD_DEG = 8;      // 바람 풍향 오차 표준편차 (조류보다 변동성 큼)
const PROGRESS_REPORT_INTERVAL = 50; // 이만큼 입자를 처리할 때마다 진행률 보고

self.onmessage = function (e) {
  const d = e.data;
  const finalPoints = [];

  for (let p = 0; p < d.particleCount; p++) {
    let pLat = d.lat, pLon = d.lon;

    for (let t = 1; t <= d.ahead; t++) {
      // 조류벡터: runPrediction()에서 시간별로 미리 계산해 넘겨준 hourlyCurrentXY 재사용
      const baseCurXY = d.hourlyCurrentXY ? d.hourlyCurrentXY[t] : d.curXY;
      const baseCur = xyToBearingMag(baseCurXY.x, baseCurXY.y);
      const curSpeedFactor = Math.max(0, 1 + gaussianRandom(0, CURRENT_SPEED_STD));
      const curDirOffset = gaussianRandom(0, CURRENT_DIR_STD_DEG);
      const pCurXY = bearingToXY(baseCur.bearing + curDirOffset, baseCur.magnitude * curSpeedFactor);

      // 바람벡터: 마찬가지로 시간별 사전계산 배열(hourlyWindXY) 재사용
      // - 500개 입자가 매번 다시 계산하지 않고 동일한 기준값을 공유한다
      const baseWindXY = d.usedWind && d.hourlyWindXY ? d.hourlyWindXY[t] : d.wXY;
      const baseWind = xyToBearingMag(baseWindXY.x, baseWindXY.y);
      const windSpeedFactor = Math.max(0, 1 + gaussianRandom(0, WIND_SPEED_STD));
      const windDirOffset = gaussianRandom(0, WIND_DIR_STD_DEG);
      const pWindXY = baseWind.magnitude > 0
        ? bearingToXY(baseWind.bearing + windDirOffset, baseWind.magnitude * windSpeedFactor)
        : { x: 0, y: 0 };

      const combP = xyToBearingMag(pCurXY.x + pWindXY.x, pCurXY.y + pWindXY.y);
      const next = destinationPoint(pLat, pLon, combP.bearing, combP.magnitude);

      const hit = findCoastlineIntersection(pLat, pLon, next.lat, next.lon, d.localCoastline);
      if (hit) { pLat = hit.lat; pLon = hit.lon; break; } // 좌초 - 이 입자는 여기서 멈춤

      pLat = next.lat;
      pLon = next.lon;
    }

    finalPoints.push({ lat: pLat, lon: pLon });
    if (p % PROGRESS_REPORT_INTERVAL === 0) {
      self.postMessage({ type: 'progress', done: p });
    }
  }

  self.postMessage({ type: 'done', finalPoints });
};
