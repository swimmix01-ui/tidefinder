import "./field.css";
import "./workspace.css";
import { mountWorkspace } from "./modules/workspace.js";
import { decimalToDMS } from "./modules/geo.js";
import {
  validateDms,
  validateInput,
  parseKst,
  kstParts,
  formatKst,
  finite,
} from "./modules/model.js";
import {
  ensureCoastlineReady,
  loadSetnetGeoJSON,
} from "./modules/coastline.js";
import * as map from "./modules/map.js";
import * as ui from "./modules/ui.js";
import { runPrediction } from "./predict.js";
import { loadMarineStatus, invalidateMarineStatus } from "./modules/marine.js";
import {
  mountOperations,
  recordPrediction,
  invalidateOperationalResult,
  getOperationReport,
} from "./modules/operations.js";
import { mountIntelligence } from "./modules/intelligence.js";
const $ = (id) => document.getElementById(id);
let running = false,
  lastResult = null,
  resetIntelligence = () => {};
function coords() {
  return {
    lat: validateDms(
      $("latD").value,
      $("latM").value,
      $("latS").value,
      90,
      "위도",
    ),
    lon: validateDms(
      $("lonD").value,
      $("lonM").value,
      $("lonS").value,
      180,
      "경도",
    ),
  };
}
function setCoords(lat, lon) {
  for (const [prefix, n] of [
    ["lat", lat],
    ["lon", lon],
  ]) {
    const p = decimalToDMS(n);
    $(prefix + "D").value = p.d;
    $(prefix + "M").value = p.m;
    $(prefix + "S").value = p.s;
  }
  map.setMarkerPosition(lat, lon);
  document.dispatchEvent(new window.Event("tidefinder:location-changed"));
  ui.refreshInputCheckmarks();
}
function invalidate() {
  lastResult = null;
  invalidateOperationalResult();
  map.clearPrediction();
  for (const id of ["aiCard", "resultCard", "searchCard"])
    $(id).style.display = "none";
  $("dataQuality").hidden = true;
  $("timelineMessage").textContent = "";
}
function applyOrigin(o) {
  invalidate();
  setCoords(o.lat, o.lon);
  const p = kstParts(parseKst(o.time));
  $("dateInput").value = p.date;
  $("hourInput").value = Number(p.hour);
  $("minuteInput").value = Number(p.minute);
  $("originNote").textContent =
    `기준 위치 갱신: ${formatKst(o.time)} / ${o.kind || "최초 사고"}. 다시 계산하세요.`;
  map.centerMap(o.lat, o.lon);
  resetIntelligence();
  loadMarineStatus({ lat: o.lat, lon: o.lon });
}
function readInput() {
  const p = coords(),
    hour = $("hourInput").value,
    minute = $("minuteInput").value,
    date = $("dateInput").value;
  if (
    !finite(hour) ||
    !finite(minute) ||
    !Number.isInteger(Number(hour)) ||
    !Number.isInteger(Number(minute)) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  )
    throw new Error("기준 날짜·시·분을 확인하세요.");
  const startDateTime = parseKst(
    `${date}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00`,
  );
  if (!Number.isFinite(startDateTime.getTime()))
    throw new Error("기준 날짜가 올바르지 않습니다.");
  if (kstParts(startDateTime).date !== date)
    throw new Error("존재하지 않는 날짜입니다.");
  const selected = $("leewayCoef").selectedOptions[0];
  const input = {
    ...p,
    ahead: Number($("hoursAhead").value),
    startDateTime,
    leewayCoefVal: Number(selected.value),
    crosswindAngleDeg: Number(selected.dataset.cwangle),
    allowNoCoastline: $("allowNoCoastline").checked,
    allowCurrentOnly: $("allowCurrentOnly").checked,
    initialErrorM: Number($("initialErrorM").value),
  };
  if (
    !finite($("initialErrorM").value) ||
    input.initialErrorM < 0 ||
    input.initialErrorM > 10000
  )
    throw new Error("초기 위치 오차는 0~10,000m입니다.");
  for (const [kind, id] of [
    ["manualCurrent", "manualCurrent"],
    ["manualWind", "manualWind"],
  ])
    if ($(id + "Enabled").checked) {
      if (!finite($(id + "Speed").value) || !finite($(id + "Dir").value))
        throw new Error("수동 속도·방향을 입력하세요.");
      input[kind] = {
        speed: Number($(id + "Speed").value),
        dir: Number($(id + "Dir").value),
      };
    }
  return validateInput(input);
}
function showSources(r) {
  $("dataQuality").hidden = false;
  $("sourceSummary").textContent =
    `기준 ${formatKst(r.startDateTime)} → 종료 ${formatKst(r.samples.at(-1).time)} / 계산 ${formatKst(r.createdAt)} / ${r.currentSource} / 해안선 ${r.coastlineStatus.loaded ? "적용" : "미적용"}`;
  $("predictionWarnings").replaceChildren();
  for (const note of [
    ...r.warnings,
    "추정 확산반경은 경험식입니다. 보라색 500입자 외곽도 90%·95% 발견구역을 의미하지 않습니다.",
  ]) {
    const li = document.createElement("li");
    li.textContent = note;
    $("predictionWarnings").append(li);
  }
  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>구간</th><th>조류 시각</th><th>자료</th><th>조회 거리</th><th>바람</th></tr></thead><tbody></tbody>";
  for (const step of r.sourceSteps) {
    const row = document.createElement("tr");
    for (const v of [
      step.hour,
      formatKst(step.current.time),
      step.current.source,
      `${(step.current.distanceKm ?? 0).toFixed(1)}km`,
      step.wind
        ? `${step.wind.source} / ${formatKst(step.wind.time)}`
        : "미반영",
    ]) {
      const td = document.createElement("td");
      td.textContent = v;
      row.append(td);
    }
    table.tBodies[0].append(row);
  }
  $("sourceTable").replaceChildren(table);
  $("debugBox").textContent = JSON.stringify(
    {
      modelVersion: r.modelVersion,
      totalPathM: r.totalPathM,
      netDistM: r.netDistM,
      actualHours: r.actualHours,
      coastlineStatus: r.coastlineStatus,
      setnetWarnings: r.setnetWarnings,
    },
    null,
    2,
  );
  if (r.setnetWarnings.length) {
    const p = document.createElement("p");
    p.textContent = `정치망 300m 이내 접근 예상 ${r.setnetWarnings.length}건. 현장 위치와 일치 여부를 확인하세요.`;
    $("sourceSummary").append(p);
  }
}
async function handleRunPrediction() {
  if (running) return;
  let input;
  try {
    input = readInput();
  } catch (e) {
    ui.setStatus("warn", e.message);
    return;
  }
  running = true;
  invalidate();
  ui.showLoading("자료·경로 분석 중…");
  document.querySelector("main").inert = true;
  $("runPredictionBtn").disabled = true;
  try {
    const r = await runPrediction(input, {
      onStatus: (kind, text) => {
        ui.setStatus(kind, text);
        $("loadingText").textContent = text;
      },
      onProgress: (done, total) => {
        ui.setStatus("busy", `입자 시뮬레이션 ${done}/${total}`);
        $("loadingText").textContent = `입자 시뮬레이션 ${done}/${total}`;
      },
    });
    lastResult = r;
    document.dispatchEvent(new window.Event("tidefinder:prediction-ready"));
    ui.renderResultCard(r);
    showSources(r);
    recordPrediction(r, {
      lat: input.lat,
      lon: input.lon,
      time: input.startDateTime.toISOString(),
      kind: "최초 사고",
    });
    ui.setStatus(
      r.manual || r.windMissing || !r.coastlineStatus.loaded ? "warn" : "ok",
      r.manual
        ? "수동 가정 포함 예측 완료 — 적용 조건을 확인하세요."
        : r.windMissing || !r.coastlineStatus.loaded
          ? "제한 조건 포함 예측 완료 — 자료 상태를 확인하세요."
          : "예측 완료 — 확산범위는 확률 미검증 참고값입니다.",
    );
  } catch (e) {
    invalidate();
    ui.setStatus("warn", `예측 중단: ${e.message}`);
  } finally {
    running = false;
    ui.hideLoading();
    document.querySelector("main").inert = false;
    $("runPredictionBtn").disabled = false;
  }
}
window.copyOperationReport = async () => {
  if (!lastResult) {
    ui.setStatus("warn", "현재 입력으로 예측을 실행하세요.");
    return;
  }
  try {
    await navigator.clipboard.writeText(getOperationReport());
    ui.setStatus("ok", "자료 출처·제한 조건을 포함한 보고서를 복사했습니다.");
  } catch (e) {
    ui.setStatus("warn", "복사할 수 없습니다. 보고서 TXT 저장을 이용하세요.");
  }
};
window.openCoastView = () => {
  try {
    const p = coords();
    window.open(
      `/coastview.html?lat=${p.lat}&lon=${p.lon}`,
      "_blank",
      "noopener",
    );
  } catch (e) {
    ui.setStatus("warn", e.message);
  }
};
async function init() {
  const p = kstParts(new Date());
  $("dateInput").value = p.date;
  $("hourInput").value = Number(p.hour);
  $("minuteInput").value = Number(p.minute);
  await map.initMap("map", (lat, lon) => {
    invalidate();
    setCoords(lat, lon);
    resetIntelligence();
    ui.setStatus("ok", "선택 좌표를 입력했습니다. 예측을 다시 실행하세요.");
    loadMarineStatus({ lat, lon });
  });
  mountOperations({
    pickLocation: (kind,onPick) => {
      document.dispatchEvent(new window.CustomEvent("tidefinder:record-map-pick",{detail:{kind,onPick}}));
    },
    coords,
    applyOrigin,
    invalidate,
    resetOrigin: () => {
      const p = kstParts(new Date());
      setCoords(36.023, 129.419);
      $("dateInput").value = p.date;
      $("hourInput").value = Number(p.hour);
      $("minuteInput").value = Number(p.minute);
      $("originNote").textContent = "최초 사고 위치·시각 기준";
      resetIntelligence();
      loadMarineStatus(coords());
    },
  });
  resetIntelligence = mountIntelligence(coords);
  mountWorkspace(coords);
  ensureCoastlineReady();
  loadSetnetGeoJSON();
  loadMarineStatus(coords());
  for (const id of [
    "latD",
    "latM",
    "latS",
    "lonD",
    "lonM",
    "lonS",
    "dateInput",
    "hourInput",
    "minuteInput",
    "hoursAhead",
    "leewayCoef",
    "initialErrorM",
    "manualCurrentEnabled",
    "manualWindEnabled",
    "manualCurrentDir",
    "manualCurrentSpeed",
    "manualWindDir",
    "manualWindSpeed",
    "allowNoCoastline",
    "allowCurrentOnly",
  ]) {
    $(id).addEventListener("input", () => {
      invalidate();
      ui.refreshInputCheckmarks();
      if (id.startsWith("lat") || id.startsWith("lon")) { resetIntelligence(); invalidateMarineStatus(); document.dispatchEvent(new window.Event("tidefinder:location-changed")); }
      ui.setStatus("warn", "입력이 변경됐습니다. 다시 계산하세요.");
    });
  }
  for (const id of ["latD", "latM", "latS", "lonD", "lonM", "lonS"]) {
    $(id).addEventListener("change", () => {
      try { loadMarineStatus(coords()); } catch { /* Wait for valid coordinates. */ }
    });
  }
  $("runPredictionBtn").addEventListener("click", handleRunPrediction);
  $("headerRefreshBtn").addEventListener("click", async () => {
    try {
      await loadMarineStatus(coords());
      ui.setStatus(
        "ok",
        "현재 관측자료 조회 완료. 미수신 항목은 별도 확인하세요.",
      );
    } catch (e) {
      ui.setStatus("warn", e.message);
    }
  });
  $("resetMapBtn").addEventListener("click", () => {
    invalidate();
    map.resetMapView();
    ui.setStatus("warn", "예측 표시를 지웠습니다. 입력 좌표는 유지됩니다.");
  });
  $("useLocationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) {
      ui.setStatus("warn", "위치 기능을 지원하지 않습니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        invalidate();
        setCoords(pos.coords.latitude, pos.coords.longitude);
        $("initialErrorM").value = Math.min(
          10000,
          Math.max(1, Math.round(pos.coords.accuracy)),
        );
        map.centerMap(pos.coords.latitude, pos.coords.longitude);
        resetIntelligence();
        loadMarineStatus(coords());
        ui.setStatus(
          "ok",
          `현재 위치 입력 (오차 약 ${Math.round(pos.coords.accuracy)}m). 사고 위치가 맞는지 확인하세요.`,
        );
      },
      (e) => ui.setStatus("warn", `위치 확인 실패: ${e.message}`),
      { timeout: 10000 },
    );
  });
  ui.refreshInputCheckmarks();
  ui.setStatus("ok", "지도 준비 완료 · 실측·예보·수동값을 구분해 사용하세요.");
}
init().catch((e) => ui.setStatus("warn", `초기화 오류: ${e.message}`));
