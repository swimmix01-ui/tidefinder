import {
  bearingToXY,
  xyToBearingMag,
  destinationPoint,
  gaussianRandom,
  findCoastlineIntersection,
} from "./geo.js";
// Exploratory ensemble only. These uncertainty parameters are not calibrated containment probabilities.
export function simulateParticle(d) {
  const initial = destinationPoint(
    d.lat,
    d.lon,
    Math.random() * 360,
    Math.sqrt(Math.random()) * (d.initialErrorM ?? 100),
  );
  let pLat = initial.lat,
    pLon = initial.lon;
  const curFactor = Math.max(0, 1 + gaussianRandom(0, 0.125)),
    curAngle = gaussianRandom(0, 6);
  const windFactor = Math.max(0, 1 + gaussianRandom(0, 0.125));
  const windAngle =
    (Math.random() < 0.5 ? -1 : 1) * (d.crosswindAngleDeg ?? 20) +
    gaussianRandom(0, 8);
  for (let t = 1; t <= d.ahead; t++) {
    const c = xyToBearingMag(d.hourlyCurrentXY[t].x, d.hourlyCurrentXY[t].y);
    const w = xyToBearingMag(d.hourlyWindXY[t].x, d.hourlyWindXY[t].y);
    const dt = d.stepHours?.[t - 1] ?? 1;
    const cxy = bearingToXY(c.bearing + curAngle, c.magnitude * curFactor * dt);
    const wxy = bearingToXY(
      w.bearing + windAngle,
      (w.magnitude * windFactor * dt) /
        Math.cos(((d.crosswindAngleDeg ?? 20) * Math.PI) / 180),
    );
    const v = xyToBearingMag(cxy.x + wxy.x, cxy.y + wxy.y),
      next = destinationPoint(pLat, pLon, v.bearing, v.magnitude);
    const hit = findCoastlineIntersection(
      pLat,
      pLon,
      next.lat,
      next.lon,
      d.localCoastline,
    );
    if (hit) return hit;
    pLat = next.lat;
    pLon = next.lon;
  }
  return { lat: pLat, lon: pLon };
}
