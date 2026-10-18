import { formatDMS } from "./geo.js";
import * as turf from "@turf/turf";
import { formatKst, finite } from "./model.js";
export const newCase = () => ({
  schemaVersion: 1,
  name: "현장 수색",
  createdAt: new Date().toISOString(),
  origin: null,
  observations: [],
  searches: [],
  predictions: [],
});
export function validateRecord(lat, lon, time) {
  if (
    !finite(lat) ||
    !finite(lon) ||
    Number(lat) < 0 ||
    Number(lat) > 90 ||
    Number(lon) < 0 ||
    Number(lon) > 180
  )
    throw new Error("기록 좌표를 확인하세요.");
  const d = new Date(time);
  if (!Number.isFinite(d.getTime()) || d > Date.now() + 60000)
    throw new Error("기록 시각을 확인하세요. 미래 시각은 기록할 수 없습니다.");
}
export function caseGeoJSON(c) {
  const features = [];
  for (const r of c.observations)
    features.push(turf.point([r.lon, r.lat], { kind: "observation", ...r }));
  for (const r of c.searches)
    features.push(
      turf.circle([r.lon, r.lat], r.radius / 1000, {
        steps: 48,
        units: "kilometers",
        properties: { kind: "search-record", ...r },
      }),
    );
  const p = c.predictions[0];
  if (p?.samples?.length > 1) {
    features.push(
      turf.lineString(
        p.samples.map((x) => [x.lon, x.lat]),
        {
          kind: "predicted-path",
          createdAt: p.createdAt,
          start: p.startDateTime,
          end: p.samples.at(-1).time,
          sources: p.sourceSteps,
          warnings: p.warnings,
        },
      ),
    );
    features.push(
      turf.circle(
        [p.finalPoint.lon, p.finalPoint.lat],
        p.finalErrorRadius / 1000,
        {
          units: "kilometers",
          steps: 64,
          properties: {
            kind: "heuristic-spread",
            radiusM: p.finalErrorRadius,
            probability: null,
          },
        },
      ),
    );
    if (p.simulationHull)
      features.push({
        ...p.simulationHull,
        properties: { kind: "simulation-envelope", probability: null },
      });
  }
  return turf.featureCollection(features);
}
export function operationReport(c, r) {
  return [
    "[해양 수색·현장 대응지원 — TideFinder]",
    `사건: ${c.name}`,
    `작성: ${formatKst(new Date())}`,
    r ? `계산 시각: ${formatKst(r.createdAt)} / 모델 ${r.modelVersion}` : null,
    r ? `기준 위치: ${formatDMS(r.inputLat,r.inputLon)}` : null,
    r
      ? `기준 시각: ${formatKst(r.startDateTime)} / 예측 종료: ${formatKst(r.samples.at(-1).time)}`
      : null,
    r
      ? `입력 예측시간: ${r.ahead}h / 실제 계산: ${r.actualHours.toFixed(2)}h${r.strandedAt !== null ? " (해안 도달 시 정지)" : ""}`
      : null,
    r
      ? `종료 위치: ${formatDMS(r.finalPoint.lat,r.finalPoint.lon)}`
      : null,
    r
      ? `직선거리: ${Math.round(r.netDistM)}m / 누적 경로: ${Math.round(r.totalPathM)}m`
      : null,
    r
      ? `추정 확산반경: ${r.finalErrorRadius}m (확률 미검증) / 초기 위치 오차 ${r.initialErrorM}m`
      : null,
    r
      ? `표류물 계수: ${r.leewayCoefVal} / 발산각 ${r.crosswindAngleDeg}°`
      : null,
    r
      ? `조류: ${r.currentSource} / 해안선: ${r.coastlineStatus.loaded ? "적용" : "미적용"}`
      : null,
    ...(r?.warnings || []).map((w) => `주의: ${w}`),
    ...(r?.sourceSteps || []).map(
      (s) =>
        `구간 ${s.hour}: 조류 ${s.current.source}, ${s.current.speed}cm/s / ${s.current.dir}°, ${formatKst(s.current.time)}, 조회점 거리 ${(s.current.distanceKm ?? 0).toFixed(1)}km; 바람 ${s.wind ? `${s.wind.source} ${s.wind.speed}m/s / ${s.wind.from}° (${formatKst(s.wind.time)})` : "미반영"}`,
    ),
    ...(c.observations.length ? ["", "[목격·검증 기록]", ...c.observations.map(o=>`${formatKst(o.time)} | ${formatDMS(o.lat,o.lon)} | ${o.kind} | ${o.note || "-"}`)] : []),
    ...(c.searches.length ? ["[수색 이력]", ...c.searches.map(s=>`${formatKst(s.time)} | ${s.method} | 중심 ${formatDMS(s.lat,s.lon)} / 반경 ${s.radius}m | ${s.result} | ${s.note || "-"}`)] : []),
    "※ 실측·예보·수동값을 구분한 참고 예측입니다. 확산반경과 입자 외곽은 발견 확률을 보장하지 않습니다. 수색 완료 표시는 확률을 자동으로 낮추지 않습니다.",
  ]
    .filter((v) => v !== null)
    .join("\n");
}
