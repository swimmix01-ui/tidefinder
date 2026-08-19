// ==========================================================================
// 순수 지리·수학 함수 모음 (Pure Functions)
// ※ 이 파일의 함수는 DOM, fetch, kakao maps SDK를 절대 참조하지 않는다.
//   같은 입력이면 항상 같은 출력이 나오는 "순수 함수"만 여기 둔다는 규칙을
//   지키면, 나중에 Vitest 같은 도구로 단위 테스트를 붙이기가 매우 쉬워진다.
// ==========================================================================

export function decimalToDMS(val) {
  const d = Math.floor(val);
  const mF = (val - d) * 60;
  const m = Math.floor(mF);
  const s = Math.round((mF - m) * 60);
  return { d, m, s };
}

export function dmsToDecimal(d, m, s) {
  return d + m / 60 + s / 3600;
}

export function formatDMS(lat, lon) {
  const la = decimalToDMS(lat);
  const lo = decimalToDMS(lon);
  return `${la.d}°${la.m}′${la.s}″N, ${lo.d}°${lo.m}′${lo.s}″E`;
}

export function bearingToCompass(deg) {
  const names = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// 시작좌표에서 방위각(deg)·거리(m)만큼 이동한 좌표를 반환 (구면삼각법)
export function destinationPoint(lat, lon, brngDeg, distM) {
  const R = 6371000;
  const brng = (brngDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distM / R) + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(distM / R) * Math.cos(lat1), Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

// 두 좌표 사이의 방위각(순이동방향)
export function bearingBetween(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180, phi2 = (lat2 * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// 두 좌표 사이의 대권거리(m) - Haversine 공식
export function haversineMeters(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180, phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export const distanceBetween = (lat1, lon1, lat2, lon2) => haversineMeters(lon1, lat1, lon2, lat2);

// 카카오 도법(LCC) 변환 - 기상청 격자좌표(nx, ny) 산출용
export function latLonToGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136, DEGRAD = Math.PI / 180.0;
  const re = RE / GRID, slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD, olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  const sf = (Math.pow(Math.tan(Math.PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1)) / sn;
  const ro = (re * sf) / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
  const ra = (re * sf) / Math.pow(Math.tan(Math.PI * 0.25 + (lat * DEGRAD) * 0.5), sn);
  let th = lon * DEGRAD - olon;
  if (th > Math.PI) th -= 2.0 * Math.PI;
  if (th < -Math.PI) th += 2.0 * Math.PI;
  th *= sn;
  return { nx: Math.floor(ra * Math.sin(th) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(th) + YO + 0.5) };
}

// 방위각(deg) + 크기 -> 직교좌표(x=동서, y=남북) 변환. 벡터 합성(조류+바람)에 사용.
export function bearingToXY(b, m) {
  const r = (b * Math.PI) / 180;
  return { x: m * Math.sin(r), y: m * Math.cos(r) };
}

// 직교좌표 -> 방위각 + 크기 (bearingToXY의 역변환)
export function xyToBearingMag(x, y) {
  let brg = (Math.atan2(x, y) * 180) / Math.PI;
  if (brg < 0) brg += 360;
  return { bearing: brg, magnitude: Math.sqrt(x * x + y * y) };
}

// 표준정규분포(Box-Muller 변환) 난수 생성기 - 몬테카를로 오차 모사용
export function gaussianRandom(mean, stdDev) {
  const u = 1 - Math.random(), v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

// ==========================================================================
// 순수 평면기하 선분교차 공식 (기존 turf.lineIntersect를 대체한 최적화 버전).
// 표준 선분교차 공식(파라메트릭 방정식)으로 직접 계산 - Turf.js 객체 생성·함수
// 호출 오버헤드 없이 동일한 수학적 결과를 낸다.
// ==========================================================================
export function segmentIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (d === 0) return null; // 평행(교차 없음)
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// 이전좌표->현재좌표 선분이 해안선(GeoJSON FeatureCollection)과 교차하는지 판별.
// ※ turf 의존성이 전혀 없다 - Web Worker 안에서도 무거운 라이브러리 없이
//   그대로 import해서 쓸 수 있도록 일부러 순수 함수로 여기 둔다.
//   (coastline.js의 checkSegmentCrossesCoastline은 이 함수의 얇은 래퍼일 뿐이다)
export function findCoastlineIntersection(prevLat, prevLon, curLat, curLon, dataset) {
  if (!dataset || !dataset.features) return null;
  let nearest = null, minDist = Infinity;
  for (const f of dataset.features) {
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const hit = segmentIntersection(prevLon, prevLat, curLon, curLat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
      if (hit) {
        const d = haversineMeters(prevLon, prevLat, hit[0], hit[1]);
        if (d < minDist) { minDist = d; nearest = { lat: hit[1], lon: hit[0] }; }
      }
    }
  }
  return nearest;
}
