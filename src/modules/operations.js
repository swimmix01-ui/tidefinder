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
  const section = document.createElement("details");
  section.className = "card disclosure";
  section.id = "operationsCard";
  section.innerHTML = `<summary>현장 기록</summary>
  <div id="recordHome">
    <p class="record-intro">무엇을 기록할까요?</p>
    <div class="record-actions"><button id="startObservation"><strong>목격·발견 기록</strong><span>사람이나 단서를 확인한 위치</span></button><button id="startSearch"><strong>수색한 구역 기록</strong><span>수색 위치·범위·결과</span></button></div>
    <p class="record-storage-note">기록은 이 기기에 저장됩니다.</p>
  </div>
  <p id="caseStatus" role="status" aria-live="polite"></p>
  <section id="observationForm" class="record-form" hidden>
    <button id="backFromObservation" class="text-button">← 기록 목록</button><h3>목격·발견 기록</h3>
    <p class="record-step">1. 확인한 위치</p><button id="pickObservationLocation" class="location-choice">지도에서 위치 선택</button><p id="observationPosition" class="help">위치를 먼저 선택하세요.</p>
    <details class="manual-coordinates"><summary>좌표를 직접 입력하려면</summary><div class="two-col"><label>위도<input id="observationLat" type="number" step="any" min="0" max="90" placeholder="예: 36.023"></label><label>경도<input id="observationLon" type="number" step="any" min="0" max="180" placeholder="예: 129.419"></label></div><button id="useSelectedObservation">현재 지도 위치 사용</button></details>
    <p class="record-step">2. 확인한 내용</p>
    <label>확인 시각<input id="observationTime" type="datetime-local"></label><label>무엇을 확인했나요?<select id="observationKind"><option>목격</option><option>발견</option><option>훈련 검증</option></select></label><label>메모 (선택)<input id="observationNote" type="text" maxlength="300" placeholder="예: 신고자가 방파제 앞에서 목격"></label>
    <button id="addObservation" class="record-submit">목격 기록 저장</button>
  </section>
  <section id="searchForm" class="record-form" hidden>
    <button id="backFromSearch" class="text-button">← 기록 목록</button><h3>수색한 구역 기록</h3>
    <p class="record-step">1. 수색한 위치</p><button id="pickSearchLocation" class="location-choice">지도에서 수색 중심 선택</button><p id="searchPosition" class="help">위치를 먼저 선택하세요.</p>
    <label>수색 범위 · 반경 (m)<input id="searchRadius" type="number" min="1" max="20000" value="300"></label><p class="help">선택한 위치 주변을 원으로 표시합니다. 실제 이동 경로와는 다를 수 있습니다.</p>
    <p class="record-step">2. 수색 결과</p><label>수색 종료 시각<input id="searchTime" type="datetime-local"></label><div class="two-col"><label>수색 수단<select id="searchMethod"><option>구조정</option><option>도보</option><option>드론</option><option>잠수</option><option>항공</option><option>기타</option></select></label><label>결과<select id="searchResult"><option>미발견</option><option>단서 발견</option><option>대상 발견</option><option>중단</option></select></label></div><label>메모 (선택)<input id="searchNote" maxlength="300" type="text" placeholder="예: 방파제 외측 수색 완료"></label><button id="addSearch" class="record-submit">수색 기록 저장</button>
  </section>
  <div id="recordLists"><div class="record-list-heading"><h3>저장한 기록</h3><span id="recordCount">0건</span></div><p id="recordEmpty" class="help">아직 기록이 없습니다. 위에서 기록할 항목을 선택하세요.</p><ol id="observationList"></ol><ol id="searchList"></ol></div>
  <details id="recordTools"><summary>사건 관리·보고서</summary><label>사건명 (선택)<input id="caseName" type="text" maxlength="80" value="현장 수색"></label><div class="button-row"><button id="saveCase">지금 저장</button><button id="restoreCase">저장 기록 불러오기</button><button id="newCase">새 사건 시작</button></div><details><summary>보고서·파일 내보내기</summary><div class="button-row"><button id="printReport">인쇄·PDF</button><button id="exportReport">보고서 TXT</button><button id="exportCase">사건 JSON</button><button id="exportGeoJSON">지도 GeoJSON</button></div></details></details>
  <details id="recordAnalysis"><summary>기록으로 표류예측 갱신·검증</summary><p class="help">확인한 위치를 기준으로 다시 계산하려면 사용하세요.</p><div class="button-row"><button id="useLatestObservation">최근 확인 위치로 예측 준비</button><button id="resetOrigin">최초 사고 위치로 돌아가기</button></div><label>비교할 예측<select id="validationPrediction"></select></label><div id="validationResults"></div></details>`;
  $("searchCard").after(section);
  const bind = (id, fn) =>
    $(id).addEventListener("click", () => {
      try {
        fn();
      } catch (e) {
        $("caseStatus").textContent = e.message;
      }
    });
  let searchPoint = null;
  const form = kind => {
    $("recordHome").hidden = Boolean(kind);
    $("recordLists").hidden = Boolean(kind);
    $("recordTools").hidden = Boolean(kind);
    $("recordAnalysis").hidden = Boolean(kind);
    $("observationForm").hidden = kind !== "observation";
    $("searchForm").hidden = kind !== "search";
  };
  const positionText = (id,p) => { $(id).textContent = `${p.lat.toFixed(5)}°N, ${p.lon.toFixed(5)}°E · 지도에서 변경할 수 있습니다.`; };
  const askMap = kind => {
    callbacks.pickLocation?.(kind, point => {
      if (kind === "observation") { $("observationLat").value=point.lat;$("observationLon").value=point.lon;positionText("observationPosition",point); }
      else {searchPoint=point;positionText("searchPosition",point);}
      form(kind);
    });
  };
  const begin = kind => {
    $("caseStatus").textContent = "";
    if (kind === "observation") {
      $("observationLat").value="";$("observationLon").value="";$("observationNote").value="";
      $("observationPosition").textContent="확인한 위치를 지도에서 선택하세요.";
      $("observationTime").value=kstParts(new Date()).local;
    } else { searchPoint=null;$("searchPosition").textContent="수색한 구역의 중심을 지도에서 선택하세요.";$("searchNote").value="";$("searchTime").value=kstParts(new Date()).local; }
    form(kind);
  };
  bind("startObservation",()=>begin("observation"));bind("startSearch",()=>begin("search"));
  bind("pickObservationLocation",()=>askMap("observation"));bind("pickSearchLocation",()=>askMap("search"));
  bind("backFromObservation",()=>form(null));bind("backFromSearch",()=>form(null));
  const persist = next => { localStorage.setItem("tidefinder.case.v1",JSON.stringify(next)); state=next; };
  const now = kstParts(new Date()).local;
  $("observationTime").value=now;$("searchTime").value=now;
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
    positionText("observationPosition",p);
  });
  bind("addObservation", () => {
    if (state.observations.length >= 500)
      throw new Error("기록이 500건입니다. 내보낸 후 새 사건을 시작하세요.");
    if (!$("observationLat").value || !$("observationLon").value) throw new Error("지도에서 확인 위치를 먼저 선택하세요.");
    const lat = $("observationLat").value,
      lon = $("observationLon").value,
      date = parseKst($("observationTime").value);
    if (!Number.isFinite(+date)) throw new Error("확인 시각을 선택하세요.");
    const time=date.toISOString();
    validateRecord(lat, lon, time);
    const observation = {
      lat: Number(lat),
      lon: Number(lon),
      time,
      kind: $("observationKind").value,
      note: $("observationNote").value.trim(),
      id: crypto.randomUUID(),
    };
    persist({...state,observations:[...state.observations,observation]});
    render();form(null);$("caseStatus").textContent="목격 기록을 이 기기에 저장했습니다.";
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
    if (!searchPoint) throw new Error("지도에서 수색한 위치를 먼저 선택하세요.");
    const { lat, lon } = searchPoint,
      date = parseKst($("searchTime").value),
      radius = Number($("searchRadius").value);
    if (!Number.isFinite(+date)) throw new Error("수색 종료 시각을 선택하세요.");
    const time=date.toISOString();
    validateRecord(lat, lon, time);
    if (!Number.isFinite(radius) || radius < 1 || radius > 20000)
      throw new Error("반경은 1~20,000m입니다.");
    if (state.searches.length >= 500)
      throw new Error(
        "수색 기록이 500건입니다. 내보낸 후 새 사건을 시작하세요.",
      );
    const search = {
      lat,
      lon,
      time,
      radius,
      method: $("searchMethod").value,
      result: $("searchResult").value,
      note: $("searchNote").value.trim(),
    };
    persist({...state,searches:[...state.searches,search]});
    render();form(null);$("caseStatus").textContent="수색 기록을 이 기기에 저장했습니다.";
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
  const count=state.observations.length+state.searches.length;
  $("recordCount").textContent=`${count}건`;$("recordEmpty").hidden=count>0;
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
