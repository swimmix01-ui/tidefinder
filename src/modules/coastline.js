// ==========================================================================
// 해안선 마스킹(Land Masking) + 정치망 인접 경고
// ※ 상태(coastlineData 등)를 이 모듈 안에 캡슐화한다 - 다른 파일에서
//   직접 접근하지 않고 반드시 아래 export된 함수를 통해서만 조작한다.
// ==========================================================================
import { findCoastlineIntersection } from './geo.js';
import * as turf from '@turf/turf';

let coastlineData = null;
let coastlineLoadError = null;
let setnetData = null;
let setnetLoadError = null;

export function getCoastlineStatus() {
  return { loaded: !!coastlineData, error: coastlineLoadError };
}

// 해안선 GeoJSON을 비동기로 로드한다. 실패해도 예외를 던지지 않고 null로 유지
// -> 호출부가 "마스킹 기능 없음"으로 조용히 폴백한다 (통신 불안정 현장 가정).
export async function loadCoastlineGeoJSON() {
  try {
    const res = await fetch('/coastline-korea.geojson.gz');
    if (!res.ok) throw new Error(`coastline fetch HTTP ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    let jsonText = null;
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const decompressedStream = new Blob([buf]).stream().pipeThrough(ds);
        jsonText = await new Response(decompressedStream).text();
      } catch (gzErr) {
        jsonText = new TextDecoder('utf-8').decode(buf);
      }
    } else {
      jsonText = new TextDecoder('utf-8').decode(buf);
    }
    const data = JSON.parse(jsonText);
    if (!data || !data.type) throw new Error('coastline GeoJSON 형식 오류');
    coastlineData = data;
    coastlineLoadError = null;
    console.info('✅ 해안선 마스킹 데이터 로드 완료');
  } catch (err) {
    coastlineData = null;
    coastlineLoadError = String(err && err.message ? err.message : err);
    console.warn('⚠ 해안선 GeoJSON 로드 실패:', err);
  }
}

export async function loadSetnetGeoJSON() {
  try {
    const res = await fetch('/setnet-korea.geojson');
    if (!res.ok) throw new Error(`setnet fetch HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!data || !data.type) throw new Error('setnet GeoJSON 형식 오류');
    setnetData = data;
    setnetLoadError = null;
    console.info(`✅ 정치망 위치 데이터 로드 완료 (${data.features.length}건)`);
  } catch (err) {
    setnetData = null;
    setnetLoadError = String(err && err.message ? err.message : err);
    console.warn('⚠ 정치망 데이터 로드 실패:', err);
  }
}

// 사고지점 주변(버퍼 범위)의 해안선 조각만 추려서 반환 - 성능 최적화용
export function getLocalCoastline(centerLat, centerLon, bufferKm) {
  if (!coastlineData || !coastlineData.features) return null;
  const bufDeg = bufferKm / 111;
  const minLat = centerLat - bufDeg, maxLat = centerLat + bufDeg;
  const minLon = centerLon - bufDeg, maxLon = centerLon + bufDeg;
  const filtered = coastlineData.features.filter((f) => {
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords || coords.length === 0) return false;
    const samples = [coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]];
    return samples.some(([lon, lat]) => lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon);
  });
  return { type: 'FeatureCollection', features: filtered };
}

// 이전좌표->현재좌표 선분이 해안선과 교차하는지 판별 (실제 로직은 geo.js에 있음)
export function checkSegmentCrossesCoastline(prevLat, prevLon, curLat, curLon, dataset) {
  const data = dataset !== undefined ? dataset : coastlineData;
  try {
    return findCoastlineIntersection(prevLat, prevLon, curLat, curLon, data);
  } catch (err) {
    console.warn('해안선 교차판정 실패(무시하고 계속 진행):', err);
    return null;
  }
}

export function getLocalSetnets(centerLat, centerLon, bufferKm) {
  if (!setnetData || !setnetData.features) return [];
  const bufDeg = bufferKm / 111;
  return setnetData.features.filter((f) => {
    const p = f.properties;
    if (p.lat === undefined || p.lon === undefined) return false;
    return Math.abs(p.lat - centerLat) <= bufDeg && Math.abs(p.lon - centerLon) <= bufDeg;
  });
}

// 정치망 근접 판정은 여전히 turf(pointToLineDistance)를 사용한다.
// ※ 이 함수는 예측 시작 시 딱 한 번, localSetnets(최대 수백 건)에만 돌기
//   때문에 turf 오버헤드가 문제되지 않는다 - 몬테카를로처럼 500회 반복
//   호출되는 해안선 판정과는 성격이 다르므로 최적화 대상에서 제외했다.
export function findNearbySetnets(prevLat, prevLon, curLat, curLon, localSetnets, thresholdM) {
  if (!localSetnets || localSetnets.length === 0) return [];
  const found = [];
  try {
    const segment = turf.lineString([[prevLon, prevLat], [curLon, curLat]]);
    localSetnets.forEach((f) => {
      const p = f.properties;
      const pt = turf.point([p.lon, p.lat]);
      const dist = turf.pointToLineDistance(pt, segment, { units: 'meters' });
      if (dist <= thresholdM) found.push({ ...p, distM: Math.round(dist) });
    });
  } catch (err) {
    console.warn('정치망 근접판정 실패(무시하고 계속 진행):', err);
  }
  return found;
}
