import {
  newCase,
  validateRecord,
  caseGeoJSON,
  operationReport,
} from "./case.js";
import {
  parseKst,
  kstParts,
  formatKst,
  errorAtObservation,
  interpolatePath,
} from "./model.js";
import * as map from "./map.js";
const $ = (id) => document.getElementById(id);
let state = newCase(),
  current = null,
  callbacks;
export function download(name, content, type = "application/json") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([content], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountOperations(cbs) {
  callbacks = cbs;
  const section = document.createElement("section");
  section.className = "card";
  section.id = "operationsCard";
  section.innerHTML = `<h2>현장 기록·인계</h2><p class="help">기록은 이 화면에서 관리합니다. 기기 저장을 누른 경우에만 이 브라우저에 보관됩니다. 서버 동기화는 하지 않습니다.</p>
  <label>사건명·훈련명<input id="caseName" type="text" maxlength="80" value="현장 수색"></label>
  <div class="button-row"><button id="saveCase">이 기기에 저장</button><button id="restoreCase">저장 기록 불러오기</button><button id="newCase">새 사건</button><button id="resetOrigin">최초 사고 위치로 복귀</button></div><p id="caseStatus" role="status"></p>
  <details open><summary>목격·실제 표류위치 기록</summary><div class="two-col"><label>위도 (십진수)<input id="observationLat" type="number" step="any" min="0" max="90"></label><label>경도 (십진수)<input id="observationLon" type="number" step="any" min="0" max="180"></label></div>
  <label>확인 시각 (한국시간)<input id="observationTime" type="datetime-local"></label><label>기록 구분<select id="observationKind"><option>목격</option><option>훈련 검증</option><option>발견</option></select></label><label>출처·확인사항<input id="observationNote" type="text" maxlength="300" placeholder="예: 구조정 현장 확인, 신고자 목격"></label>
  <div class="button-row"><button id="useSelectedObservation">선택 좌표 사용</button><button id="addObservation">기록 추가</button><button id="useLatestObservation">마지막 확인 위치로 재예측 준비</button></div><ol id="observationList"></ol></details>
  <details><summary>수색 완료 구역 기록</summary><p class="help">현재 입력 좌표를 원형 수색구역 중심으로 기록합니다. 구역은 수색 실적 표시이며 탐지확률·미발견 확률을 계산하지 않습니다.</p><div class="two-col"><label>수색 반경 (m)<input id="searchRadius" type="number" min="1" max="20000" value="300"></label><label>수색 종료시각 (한국시간)<input id="searchTime" type="datetime-local"></label></div><div class="two-col"><label>수단<select id="searchMethod"><option>구조정</option><option>도보</option><option>드론</option><option>잠수</option><option>항공</option><option>기타</option></select></label><label>결과<select id="searchResult"><option>미발견</option><option>단서 발견</option><option>대상 발견</option><option>중단</option></select></label></div><label>현장 메모<input id="searchNote" maxlength="300" type="text"></label><button id="addSearch">현재 좌표 중심 수색 기록</button><ol id="searchList"></ol></details>
  <details><summary>예측 검증·이력</summary><label>비교할 예측<select id="validationPrediction"></select></label><div id="validationResults"></div><p class="help">관측 시각의 예측 위치와 비교합니다. 두 예측점 사이 위치는 시간 비례 보간값입니다. 표본이 적을 때 포함률을 시스템 신뢰도로 해석하지 마세요.</p></details>
  <div class="button-row"><button id="exportCase">사건 JSON 저장</button><button id="exportGeoJSON">지도 GeoJSON 저장</button><button id="exportReport">보고서 TXT 저장</button><button id="printReport">인쇄·PDF</button></div>`;
  $("searchCard").after(section);
  const bind = (id, fn) =>
    $(id).addEventListener("click", () => {
      try {
        fn();
      } catch (e) {
        $("caseStatus").textContent = e.message;
      }
    });
  const now = kstParts(new Date()).local;
  $("observationTime").value = now;
  $("searchTime").value = now;
  $("caseName").addEventListener("input", () => {
    state.name = $("caseName").value.trim() || "현장 수색";
  });
  bind("saveCase", () => {
    state.name = $("caseName").value.trim() || "현장 수색";
    localStorage.setItem("tidefinder.case.v1", JSON.stringify(state));
    $("caseStatus").textContent =
      "이 기기에 저장했습니다. 이후 변경사항은 다시 저장하세요.";
  });
  bind("restoreCase", () => {
    const raw = localStorage.getItem("tidefinder.case.v1");
    if (!raw) throw new Error("저장된 기록이 없습니다.");
    const c = JSON.parse(raw);
    if (
      c.schemaVersion !== 1 ||
      !Array.isArray(c.observations) ||
      !Array.isArray(c.searches) ||
      !Array.isArray(c.predictions)
    )
      throw new Error("저장 형식이 맞지 않습니다.");
    state = c;
    current = null;
    callbacks.invalidate();
    render();
    $("caseStatus").textContent =
      "저장 기록을 불러왔습니다. 현재 자료로 다시 계산하세요.";
  });
  bind("newCase", () => {
    if (
      !confirm(
        "화면의 사건을 새로 시작할까요? 필요한 기록은 먼저 저장하세요. 기기에 저장한 기록은 유지됩니다.",
      )
    )
      return;
    state = newCase();
    current = null;
    callbacks.invalidate();
    callbacks.resetOrigin();
    render();
    $("caseStatus").textContent = "새 사건을 시작했습니다.";
  });
  bind("resetOrigin", () => {
    if (!state.origin) throw new Error("최초 사고 정보가 없습니다.");
    callbacks.applyOrigin(state.origin);
  });
  bind("useSelectedObservation", () => {
    const p = callbacks.coords();
    $("observationLat").value = p.lat;
    $("observationLon").value = p.lon;
  });
  bind("addObservation", () => {
    if (state.observations.length >= 500)
      throw new Error("기록이 500건입니다. 내보낸 후 새 사건을 시작하세요.");
    const lat = $("observationLat").value,
      lon = $("observationLon").value,
      time = parseKst($("observationTime").value).toISOString();
    validateRecord(lat, lon, time);
    state.observations.push({
      lat: Number(lat),
      lon: Number(lon),
      time,
      kind: $("observationKind").value,
      note: $("observationNote").value.trim(),
      id: crypto.randomUUID(),
    });
    render();
  });
  bind("useLatestObservation", () => {
    const o = [...state.observations]
      .sort((a, b) => new Date(a.time) - new Date(b.time))
      .at(-1);
    if (!o) throw new Error("목격·확인 위치를 먼저 기록하세요.");
    callbacks.applyOrigin(o);
    $("caseStatus").textContent =
      "마지막 확인 위치·시각을 적용했습니다. 표류 예측을 다시 실행하세요.";
  });
  bind("addSearch", () => {
    const { lat, lon } = callbacks.coords(),
      time = parseKst($("searchTime").value).toISOString(),
      radius = Number($("searchRadius").value);
    validateRecord(lat, lon, time);
    if (!Number.isFinite(radius) || radius < 1 || radius > 20000)
      throw new Error("반경은 1~20,000m입니다.");
    if (state.searches.length >= 500)
      throw new Error(
        "수색 기록이 500건입니다. 내보낸 후 새 사건을 시작하세요.",
      );
    state.searches.push({
      lat,
      lon,
      time,
      radius,
      method: $("searchMethod").value,
      result: $("searchResult").value,
      note: $("searchNote").value.trim(),
    });
    render();
  });
  bind("exportCase", () =>
    download("tidefinder-case.json", JSON.stringify(state, null, 2)),
  );
  bind("exportGeoJSON", () =>
    download(
      "tidefinder-map.geojson",
      JSON.stringify(caseGeoJSON(state), null, 2),
      "application/geo+json",
    ),
  );
  bind("exportReport", () =>
    download(
      "tidefinder-report.txt",
      operationReport(state, current),
      "text/plain;charset=utf-8",
    ),
  );
  bind("printReport", () => {
    let p = $("printReportText");
    if (!p) {
      p = document.createElement("pre");
      p.id = "printReportText";
      document.body.append(p);
    }
    p.textContent = operationReport(state, current);
    window.print();
  });
  $("validationPrediction").addEventListener("change", renderValidation);
  $("predictionTime").addEventListener("input", () =>
    showAt(
      new Date(
        new Date(current.startDateTime).getTime() +
          Number($("predictionTime").value) * 60000,
      ),
    ),
  );
  bind("showNow", () => showAt(new Date()));
  bind("showArrival", () => {
    const m = Number($("arrivalMinutes").value);
    if (!Number.isFinite(m) || m < 0 || m > 1440)
      throw new Error("도착 예정시간은 0~1,440분입니다.");
    showAt(new Date(Date.now() + m * 60000));
  });
  render();
}
function showAt(date) {
  if (!current) {
    $("timelineMessage").textContent = "예측을 먼저 실행하세요.";
    return;
  }
  const p = interpolatePath(current, date);
  if (!p) {
    $("timelineMessage").textContent =
      `${formatKst(date)}는 계산 범위 밖입니다. 기준부터 도착 시각까지 포함하도록 예측시간을 조정하세요.`;
    return;
  }
  $("predictionTime").value = (date - new Date(current.startDateTime)) / 60000;
  $("timePosition").textContent =
    `${formatKst(date)} / ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} / 추정 반경 ${Math.round(p.radius)}m`;
  $("timelineMessage").textContent = "";
  map.showTimePosition(p);
}
function renderValidation() {
  const target =
      state.predictions[Number($("validationPrediction").value) || 0],
    box = $("validationResults");
  box.replaceChildren();
  if (!target) {
    box.textContent = "예측 후 목격·검증 위치를 기록하면 비교할 수 있습니다.";
    return;
  }
  let count = 0,
    inside = 0,
    sum = 0;
  for (const o of state.observations) {
    const r = errorAtObservation(target, o);
    const p = document.createElement("p");
    p.textContent = `${formatKst(o.time)} ${o.kind}: ${r ? `오차 ${r.errorM}m / 추정범위 ${r.inside ? "안" : "밖"}` : "예측 시간범위 밖"}`;
    box.append(p);
    if (r) {
      count++;
      inside += Number(r.inside);
      sum += r.errorM;
    }
  }
  if (count) {
    const p = document.createElement("p");
    p.textContent = `비교 ${count}건 · 평균 위치오차 ${Math.round(sum / count)}m · 범위 내 ${inside}건 (이 사건 표본 통계)`;
    box.prepend(p);
  }
}
function render() {
  $("caseName").value = state.name;
  for (const [id, items, fmt] of [
    [
      "observationList",
      state.observations,
      (o) =>
        `${formatKst(o.time)} / ${o.kind} / ${o.lat.toFixed(5)}, ${o.lon.toFixed(5)} / ${o.note}`,
    ],
    [
      "searchList",
      state.searches,
      (o) =>
        `${formatKst(o.time)} / ${o.method} / ${o.radius}m / ${o.result} / ${o.note}`,
    ],
  ]) {
    $(id).replaceChildren();
    for (const r of items) {
      const li = document.createElement("li");
      li.textContent = fmt(r);
      $(id).append(li);
    }
  }
  const select = $("validationPrediction");
  select.replaceChildren();
  state.predictions.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = `${formatKst(p.createdAt)} / 기준 ${formatKst(p.startDateTime)}`;
    select.append(o);
  });
  renderValidation();
  map.renderRecords(state.observations, state.searches);
}
export function recordPrediction(result, origin) {
  current = result;
  state.origin ||= origin;
  state.predictions.unshift(result);
  state.predictions = state.predictions.slice(0, 12);
  render();
  $("timelineCard").hidden = false;
  $("predictionTime").max = result.actualHours * 60;
  $("predictionTime").value = result.actualHours * 60;
  showAt(new Date(result.samples.at(-1).time));
}
export function invalidateOperationalResult() {
  current = null;
  $("timelineCard").hidden = true;
}
export const getOperationReport = () => operationReport(state, current);
