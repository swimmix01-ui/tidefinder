// Pure validation, time and drift helpers. All operational times use Asia/Seoul.
import { distanceBetween } from "./geo.js";
export const KST_OFFSET = 9 * 3600000;
export const finite = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
export function parseKst(value) {
  if (value instanceof Date) return new Date(value);
  if (!value || typeof value !== "string") return new Date(NaN);
  let s = value.trim().replace(" ", "T");
  if (/^\d{14}$/.test(s))
    s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
  if (!/Z$|[+-]\d\d:\d\d$/.test(s)) s += "+09:00";
  return new Date(s);
}
export function kstParts(date) {
  const s = new Date(date.getTime() + KST_OFFSET).toISOString();
  return {
    date: s.slice(0, 10),
    compact: s.slice(0, 10).replaceAll("-", ""),
    hour: s.slice(11, 13),
    minute: s.slice(14, 16),
    local: s.slice(0, 16),
  };
}
export const formatKst = (date) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(date));
export function validateDms(d, m, s, max, name) {
  if (
    ![d, m, s].every(finite) ||
    !Number.isInteger(Number(d)) ||
    !Number.isInteger(Number(m)) ||
    d < 0 ||
    d > max ||
    m < 0 ||
    m >= 60 ||
    s < 0 ||
    s >= 60 ||
    (Number(d) === max && (Number(m) || Number(s)))
  )
    throw new Error(`${name}: 도·분·초 범위를 확인하세요.`);
  return Number(d) + Number(m) / 60 + Number(s) / 3600;
}
export function validateInput(input) {
  const {
    lat,
    lon,
    ahead,
    startDateTime,
    leewayCoefVal,
    crosswindAngleDeg = 20,
    manualCurrent,
    manualWind,
    initialErrorM = 100,
  } = input;
  if (
    ![lat, lon].every(Number.isFinite) ||
    lat < 0 ||
    lat > 90 ||
    lon < 0 ||
    lon > 180
  )
    throw new Error("위도·경도를 확인하세요.");
  if (!Number.isInteger(ahead) || ahead < 1 || ahead > 24)
    throw new Error("예측시간은 1~24시간의 정수로 입력하세요.");
  if (
    !(startDateTime instanceof Date) ||
    !Number.isFinite(startDateTime.getTime())
  )
    throw new Error("기준 일시를 확인하세요.");
  if (startDateTime.getTime() > Date.now() + 60000)
    throw new Error("사고·목격 시각은 현재보다 미래일 수 없습니다.");
  if (
    !Number.isFinite(leewayCoefVal) ||
    leewayCoefVal < 0 ||
    leewayCoefVal > 0.1 ||
    !Number.isFinite(crosswindAngleDeg) ||
    crosswindAngleDeg < 0 ||
    crosswindAngleDeg > 60
  )
    throw new Error("표류물 계수가 올바르지 않습니다.");
  if (
    !Number.isFinite(initialErrorM) ||
    initialErrorM < 0 ||
    initialErrorM > 10000
  )
    throw new Error("초기 위치 오차는 0~10,000m입니다.");
  for (const [name, v, max] of [
    ["유속", manualCurrent, 1000],
    ["풍속", manualWind, 100],
  ])
    if (
      v &&
      (!finite(v.speed) ||
        !finite(v.dir) ||
        v.speed < 0 ||
        v.speed > max ||
        v.dir < 0 ||
        v.dir >= 360)
    )
      throw new Error(`수동 ${name}·방향을 확인하세요.`);
  return input;
}
export function nearestForecast(items, category, date, maxGapMs = 3600000) {
  let best = null,
    gap = Infinity;
  for (const item of items || []) {
    if (item.category !== category || !finite(item.fcstValue)) continue;
    const value = Number(item.fcstValue);
    if (
      (category === "WSD" && (value < 0 || value > 100)) ||
      (category === "VEC" && (value < 0 || value > 360)) ||
      (category === "WAV" && (value < 0 || value > 30))
    )
      continue;
    const d = String(item.fcstDate),
      t = String(item.fcstTime).padStart(4, "0");
    const time = parseKst(
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00`,
    );
    const diff = Math.abs(time - date);
    if (diff < gap) {
      gap = diff;
      best = {
        value: Number(item.fcstValue),
        time: time.toISOString(),
        gapMs: diff,
      };
    }
  }
  return gap <= maxGapMs ? best : null;
}
// Magnitude shares, not directional attribution or probabilities. Cancellation is reported separately.
export function vectorShares(current, wind) {
  const c = Math.hypot(current.x, current.y),
    w = Math.hypot(wind.x, wind.y),
    sum = c + w;
  const currentPct = sum ? Math.round((c / sum) * 100) : 0;
  return {
    currentPct,
    windPct: sum ? 100 - currentPct : 0,
    cancellation: sum
      ? 1 - Math.hypot(current.x + wind.x, current.y + wind.y) / sum
      : 0,
  };
}
export function uncertaintyRadius(
  pathLengthM,
  windageM,
  hours,
  angle,
  wave = null,
  initialErrorM = 100,
) {
  return Math.round(
    initialErrorM +
      (0.15 + (finite(wave) ? Number(wave) * 0.02 : 0)) * pathLengthM +
      windageM * Math.tan((angle * Math.PI) / 180) +
      50 * Math.sqrt(hours),
  );
}
export function interpolatePath(result, date) {
  const samples = result.samples;
  if (!samples?.length) return null;
  const ms = new Date(date).getTime(),
    first = samples[0],
    last = samples.at(-1);
  if (!Number.isFinite(ms)) return null;
  if (ms < new Date(first.time).getTime() || ms > new Date(last.time).getTime())
    return null;
  let i = samples.findIndex((p) => new Date(p.time).getTime() >= ms);
  if (i <= 0) return { ...first };
  const a = samples[i - 1],
    b = samples[i],
    f = (ms - new Date(a.time)) / (new Date(b.time) - new Date(a.time));
  const lat = a.lat + (b.lat - a.lat) * f,
    lon = a.lon + (b.lon - a.lon) * f;
  return {
    lat,
    lon,
    time: new Date(ms).toISOString(),
    radius: a.radius + (b.radius - a.radius) * f,
  };
}
export function errorAtObservation(result, observation) {
  const p = interpolatePath(result, observation.time);
  return p
    ? {
        errorM: Math.round(
          distanceBetween(p.lat, p.lon, observation.lat, observation.lon),
        ),
        inside:
          distanceBetween(p.lat, p.lon, observation.lat, observation.lon) <=
          p.radius,
        predicted: p,
      }
    : null;
}
