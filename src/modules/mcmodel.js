// ==========================================================================
// 몬테카를로 입자 1개 계산 (워커·폴백 공용 순수 함수)
//
// 2026-11-19 변경 - 예전 방식은 매 시간마다 오차를 새로 뽑았다. 그러면 시간이 갈수록
// 오차가 서로 상쇄돼서 입자들이 한곳에 몰리고, 수색구역(헐)이 너무 좁게 나왔다
// (시뮬레이션: 6시간 예측에서 실제 위치를 포함한 비율 약 10~20%).
// 실제 예보 오차는 "수 시간 내내 같은 쪽으로 치우치는" 편향 성격이 강하므로
//   ① 입자마다 유속·유향·잔차류·풍속·풍향 편향을 한 번 뽑아 끝까지 유지하고
//   ② 그 위에 시간별 작은 흔들림을 더하고
//   ③ 풍압계수 자체의 불확실성(±20%)과
//   ④ 풍압 좌우발산(입자 절반은 왼쪽, 절반은 오른쪽으로 계속 감 - Allen 1999)과
//   ⑤ 사고 좌표 자체의 오차
// 를 넣었다. 같은 시뮬레이션에서 90% 구역이 실제 위치를 85~95% 포함.
// ※ 오차 크기는 문헌·실무 관행 기준 가정값이다. 실제 사례로 보정하면 더 정확해진다.
// ==========================================================================
import { bearingToXY, xyToBearingMag, destinationPoint, gaussianRandom as g, findCoastlineIntersection } from './geo.js';

export const MC_PARAMS = {
  curSpeedBias: 0.2,   // 조류 유속 편향 표준편차 (±20%)
  curDirBias: 12,      // 조류 유향 편향 (°)
  residCms: 4,         // 예보에 없는 잔차류 (cm/s, 동서·남북 각각)
  hourSpeed: 0.08,     // 시간별 유속 흔들림
  hourDir: 5,          // 시간별 유향 흔들림 (°)
  leewayStd: 0.2,      // 풍압계수 불확실성 (±20%)
  windSpeedBias: 0.15, // 풍속 예보 편향
  windDirBias: 12,     // 풍향 예보 편향 (°)
  hourWindDir: 5,
  hourWindSpeed: 0.08,
  posErrM: 150,        // 사고 좌표 오차 (m)
};

/**
 * @param {object} d - { lat, lon, ahead, hourlyCurrentXY, hourlyWindXY, crosswindDeg, posErrM, localCoastline }
 *   hourlyCurrentXY / hourlyWindXY: 시간별 이동량 벡터(m/h). 바람은 이미 풍압계수가 곱해진 값.
 * @param {number} side - 좌우발산 방향 (-1 왼쪽, +1 오른쪽)
 */
export function simulateParticle(d, side) {
  const P = MC_PARAMS;
  const sB = 1 + g(0, P.curSpeedBias), dB = g(0, P.curDirBias);
  const uB = g(0, P.residCms) * 36, vB = g(0, P.residCms) * 36; // cm/s → m/h
  const lwF = Math.max(0, 1 + g(0, P.leewayStd));
  const wsB = 1 + g(0, P.windSpeedBias), wdB = g(0, P.windDirBias);
  const cw = (d.crosswindDeg || 0) * side;
  const posErr = d.posErrM ?? P.posErrM;
  const cosLat = Math.cos((d.lat * Math.PI) / 180);
  let pLat = d.lat + g(0, posErr) / 111320;
  let pLon = d.lon + g(0, posErr) / (111320 * cosLat);
  let stranded = false;

  for (let t = 1; t <= d.ahead; t++) {
    const bc = d.hourlyCurrentXY[t] || d.hourlyCurrentXY[d.hourlyCurrentXY.length - 1];
    const c0 = xyToBearingMag(bc.x, bc.y);
    let c = bearingToXY(c0.bearing + dB + g(0, P.hourDir), c0.magnitude * Math.max(0, sB + g(0, P.hourSpeed)));
    c = { x: c.x + uB, y: c.y + vB };

    let w = { x: 0, y: 0 };
    const bw = d.hourlyWindXY ? d.hourlyWindXY[t] : null;
    if (bw && (bw.x || bw.y)) {
      const w0 = xyToBearingMag(bw.x, bw.y);
      w = bearingToXY(w0.bearing + wdB + cw + g(0, P.hourWindDir), w0.magnitude * lwF * Math.max(0, wsB + g(0, P.hourWindSpeed)));
    }

    const comb = xyToBearingMag(c.x + w.x, c.y + w.y);
    const next = destinationPoint(pLat, pLon, comb.bearing, comb.magnitude);
    const hit = findCoastlineIntersection(pLat, pLon, next.lat, next.lon, d.localCoastline);
    if (hit) { pLat = hit.lat; pLon = hit.lon; stranded = true; break; }
    pLat = next.lat; pLon = next.lon;
  }
  return { lat: pLat, lon: pLon, stranded };
}
