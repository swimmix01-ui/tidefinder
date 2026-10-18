import { distanceBetween } from './geo.js';
import { finite, parseKst } from './model.js';
export const rows = value => Array.isArray(value) ? value : value ? [value] : [];
export const observationTime = v => v?.obsrvnDt || v?.record_time || null;
export function measurement(item, keys, min, max) {
  for (const k of keys) {
    const v = item?.[k];
    if (finite(v) && !(typeof v === 'string' && !v.trim()) && Number(v) >= min && Number(v) <= max) return Number(v);
  }
  return null;
}
export function latestMeasurement(items, keys, min, max, now = Date.now()) {
  return rows(items).filter(v => {
    const t = +parseKst(observationTime(v));
    return Number.isFinite(t) && t <= now + 5 * 60000 && measurement(v, keys, min, max) !== null;
  }).sort((a,b) => parseKst(observationTime(b)) - parseKst(observationTime(a)))[0] || null;
}
export function observationLocation(item, station) {
  const lat = measurement(item, ['lat'], -90, 90), lon = measurement(item, ['lot', 'lon'], -180, 180);
  return lat !== null && lon !== null ? { lat, lon, approximate: false } : { ...station, approximate: true };
}
export function observationQuality(item, station, point, now = Date.now()) {
  const location = observationLocation(item, station), t = +parseKst(observationTime(item));
  const distanceKm = distanceBetween(point.lat, point.lon, location.lat, location.lon) / 1000;
  const ageMinutes = (now - t) / 60000;
  // Product display thresholds, not provider QC flags or proof of local representativeness.
  const flags = [];
  if (!Number.isFinite(ageMinutes)) flags.push('시각 미확인');
  else if (ageMinutes < -5) flags.push('미래시각 오류');
  else if (ageMinutes > 90) flags.push('90분 초과 · 과거 관측');
  if (distanceKm > 30) flags.push('30km 초과 · 원거리 참고');
  if (location.approximate) flags.push('관측좌표 미수신 · 거리 근사');
  return { distanceKm, ageMinutes, flags, location };
}

// Display selection: fresh, positioned observations within the app's 30km threshold
// come first. This does not establish coastal representativeness or agency QC.
export function rankObservationCandidates(candidates, point, now=Date.now()) {
  const ranked=candidates.map(candidate=>({...candidate,quality:observationQuality(candidate.item,candidate.station,point,now)}))
    .filter(c=>Number.isFinite(c.quality.distanceKm)&&Number.isFinite(c.quality.ageMinutes)&&c.quality.ageMinutes>=-5);
  const tier=c=>!c.quality.flags.length&&c.definitionKnown!==false?0:c.quality.ageMinutes<=90?1:2;
  return ranked.sort((a,b)=>tier(a)-tier(b)||a.quality.distanceKm-b.quality.distanceKm||a.quality.ageMinutes-b.quality.ageMinutes);
}
