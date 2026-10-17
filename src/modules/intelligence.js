import {
  fetchWithTimeout,
  fetchRomsData,
  fetchHfCurrentByStation,
} from "./api.js";
import { HF_STATIONS } from "./constants.js";
import { parseKst, formatKst, kstParts, finite } from "./model.js";
import { distanceBetween } from "./geo.js";
const $ = (id) => document.getElementById(id);
function text(tag, value, parent) {
  const el = document.createElement(tag);
  el.textContent = value;
  parent.append(el);
  return el;
}
const unit = (data, key) => data?.hourly_units?.[key] || "";
function at(data, key, index) {
  const v = data?.hourly?.[key]?.[index];
  return finite(v) ? Number(v) : null;
}
function nearIndex(data, date = Date.now()) {
  let best = -1,
    gap = Infinity;
  for (const [i, t] of (data?.hourly?.time || []).entries()) {
    const d = Math.abs(t * 1000 - date);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  return gap <= 3600000 ? best : -1;
}
export function parseNavigationXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("항행경보 응답 형식 오류");
  const code = doc
    .querySelector("resultCode,returnReasonCode")
    ?.textContent?.trim();
  if (!code || !["00", "0", "000"].includes(code))
    throw new Error(
      "항행경보 자료 수신 실패: 활용승인·인증 상태를 확인하세요.",
    );
  return {
    total: Number(doc.querySelector("totalCount")?.textContent || 0),
    items: [...doc.querySelectorAll("item")].map((node) =>
      Object.fromEntries(
        [...node.children].map((c) => [c.tagName, c.textContent]),
      ),
    ),
  };
}
export function mountIntelligence(getCoords) {
  let generation = 0;
  const active = new Set();
  const fresh = (p, g) => {
    const c = getCoords();
    return (
      generation === g &&
      Math.abs(c.lat - p.lat) < 1e-8 &&
      Math.abs(c.lon - p.lon) < 1e-8
    );
  };
  const run = (id, fn) =>
    $(id).addEventListener("click", async () => {
      if (active.has(id)) return;
      const btn = $(id);
      btn.disabled = true;
      active.add(id);
      try {
        const coords = getCoords();
        await fn(coords, generation);
      } catch (e) {
        $("contextStatus").textContent = e.message;
      } finally {
        active.delete(id);
        btn.disabled = false;
      }
    });
  run("loadContext", async (p, g) => {
    $("contextStatus").textContent = "보조모델 자료 조회 중…";
    $("contextValues").replaceChildren();
    $("contextForecast").replaceChildren();
    const r = await fetchWithTimeout(
        `/.netlify/functions/field-context?lat=${p.lat}&lon=${p.lon}`,
        12000,
      ),
      data = await r.json();
    if (!fresh(p, g)) return;
    const m = data.marine,
      w = data.weather,
      mi = nearIndex(m),
      wi = nearIndex(w);
    text(
      "p",
      `기준 좌표 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} / 수신 ${formatKst(data.fetchedAt)} / 보조 수치모델 예보`,
      $("contextValues"),
    );
    for (const [d, i, label, key] of [
      [m, mi, "유의파고", "wave_height"],
      [m, mi, "파주기", "wave_period"],
      [m, mi, "너울 높이", "swell_wave_height"],
      [m, mi, "너울 주기", "swell_wave_period"],
      [m, mi, "너울 방향 (오는 방향)", "swell_wave_direction"],
      [m, mi, "표층 수온", "sea_surface_temperature"],
      [m, mi, "해류 속도 (모델)", "ocean_current_velocity"],
      [m, mi, "해류 방향 (가는 방향)", "ocean_current_direction"],
      [m, mi, "평균해수면 기준 높이", "sea_level_height_msl"],
      [w, wi, "시정 (모델)", "visibility"],
      [w, wi, "돌풍", "wind_gusts_10m"],
      [w, wi, "강수량", "precipitation"],
    ]) {
      const box = document.createElement("div");
      box.className = "stat-box";
      text("div", label, box).className = "label";
      const v = i >= 0 ? at(d, key, i) : null;
      text(
        "div",
        v === null
          ? "미수신"
          : `${v} ${unit(d, key)} / ${formatKst(d.hourly.time[i] * 1000)}`,
        box,
      ).className = "value";
      $("contextValues").append(box);
    }
    if (w?.daily?.time) {
      const today = kstParts(new Date()).date;
      const i = w.daily.time.findIndex(
        (t) => kstParts(new Date(t * 1000)).date === today,
      );
      if (i >= 0)
        text(
          "p",
          `오늘 일출 ${formatKst(w.daily.sunrise[i] * 1000)} / 일몰 ${formatKst(w.daily.sunset[i] * 1000)}`,
          $("contextValues"),
        );
    }
    const table = document.createElement("table");
    table.innerHTML =
      "<caption>향후 12시간 보조모델 변화</caption><thead><tr><th>시각</th><th>파고 m</th><th>너울 m</th><th>파주기 s</th></tr></thead><tbody></tbody>";
    for (
      let j = Math.max(0, mi);
      j < Math.min((m?.hourly?.time || []).length, Math.max(0, mi) + 13);
      j += 2
    ) {
      const row = document.createElement("tr");
      text("td", formatKst(m.hourly.time[j] * 1000), row);
      for (const key of ["wave_height", "swell_wave_height", "wave_period"])
        text("td", at(m, key, j) ?? "미수신", row);
      table.tBodies[0].append(row);
    }
    $("contextForecast").append(table);
    $("contextStatus").textContent =
      `${data.errors?.join(" / ") || "보조모델 수신 완료"} · 표류 계산에는 자동 혼합하지 않습니다.`;
    for (const [label, d] of [
      ["해양", m],
      ["기상", w],
    ])
      if (d)
        text(
          "p",
          `${label} 모델 격자 ${d.latitude}, ${d.longitude} / 선택점 거리 ${(distanceBetween(p.lat, p.lon, d.latitude, d.longitude) / 1000).toFixed(1)}km`,
          $("contextValues"),
        );
  });
  run("loadNavWarnings", async (p, g) => {
    $("navigationWarnings").replaceChildren();
    text(
      "p",
      "국립해양조사원 항행경보 발행 목록 조회 중…",
      $("navigationWarnings"),
    );
    const r = await fetchWithTimeout(
        `/.netlify/functions/weather?mode=navwarnings&date=${kstParts(new Date()).compact}`,
        12000,
      ),
      data = parseNavigationXml(await r.text());
    if (!fresh(p, g)) return;
    const box = $("navigationWarnings");
    box.replaceChildren();
    text("h3", "전국 항행경보 발행 목록", box);
    text(
      "p",
      `오늘 발행 ${data.total}건 / 최대 100건 표시. 선택 좌표 주변으로 필터링한 목록이 아니며, 미조회·미발행은 위험 없음이 아닙니다. 경보의 유효기간·구역은 원문을 확인하세요.`,
      box,
    );
    for (const item of data.items) {
      const el = document.createElement("details");
      text("summary", `${item.doc_num || ""} ${item.title || "항행경보"}`, el);
      text(
        "p",
        `${item.app_cat || ""} / ${item.noti_cat || ""} / 구역 ${item.area || "원문 확인"}`,
        el,
      );
      text("p", item.content || "", el);
      box.append(el);
    }
    const a = text("a", "항행경보 자료·이용 안내 ↗", box);
    a.href = "https://www.data.go.kr/data/15057792/openapi.do";
    a.target = "_blank";
    a.rel = "noopener";
  });
  run("loadRoms", async (p, g) => {
    const box = $("romsInfo");
    box.replaceChildren();
    text("p", "ROMS·HF 독립 자료 조회 중…", box);
    const station = [...HF_STATIONS].sort(
      (a, b) =>
        distanceBetween(p.lat, p.lon, a.lat, a.lon) -
        distanceBetween(p.lat, p.lon, b.lat, b.lon),
    )[0];
    const results = await Promise.allSettled([
      fetchRomsData(p.lat, p.lon),
      fetchHfCurrentByStation(station.code),
    ]);
    if (!fresh(p, g)) return;
    box.replaceChildren();
    text("h3", "ROMS·HF 비교 (표류 계산과 별도)", box);
    const roms = results[0].status === "fulfilled" ? results[0].value : null;
    if (roms) {
      const candidates = roms.items
        .map((v) => ({ ...v, time: parseKst(v.predcDt) }))
        .filter((v) => Number.isFinite(v.time.getTime()))
        .sort(
          (a, b) =>
            Math.abs(a.time - Date.now()) - Math.abs(b.time - Date.now()),
        );
      const it = candidates[0];
      if (it && Math.abs(it.time - Date.now()) <= 3600000)
        text(
          "p",
          `ROMS 예보 ${formatKst(it.time)} / 격자 거리 ${roms.distanceKm.toFixed(1)}km / 유향 ${it.crdir}° / 수온 ${it.wtem ?? "미수신"}℃. 유속 단위의 공식 명세 대조 전이므로 ROMS 유속은 계산에 적용하지 않습니다.`,
          box,
        );
      else text("p", "ROMS: 현재 시각에 맞는 자료 없음", box);
    } else text("p", "ROMS 미수신: 활용승인·자료 제공 상태를 확인하세요.", box);
    const h = results[1].status === "fulfilled" ? results[1].value : null;
    const list = (Array.isArray(h) ? h : h ? [h] : [])
      .filter(
        (v) =>
          finite(v.lat) && finite(v.lot) && finite(v.crsp) && finite(v.crdir),
      )
      .sort(
        (a, b) =>
          distanceBetween(p.lat, p.lon, a.lat, a.lot) -
          distanceBetween(p.lat, p.lon, b.lat, b.lot),
      );
    const it = list[0];
    if (it) {
      const t = parseKst(it.obsrvnDt),
        age = Number.isFinite(t.getTime())
          ? Math.round((Date.now() - t) / 60000)
          : null;
      const dist =
        distanceBetween(p.lat, p.lon, Number(it.lat), Number(it.lot)) / 1000;
      text(
        "p",
        `HF 실측 ${station.name} / 관측점 거리 ${dist.toFixed(1)}km / ${it.crdir}° · ${it.crsp}cm/s / ${age === null ? "관측시각 확인 불가" : `${formatKst(t)} (${age}분 전)`}${age === null || age > 90 || age < 0 || dist > 15 ? " · 시간·거리 대표성 주의" : ""}. 현재 한 시점의 실측이므로 전 기간 예측값으로 연장하지 않습니다.`,
        box,
      );
    } else text("p", "HF 실측 미수신", box);
  });
  const resources = document.createElement("section");
  resources.className = "card";
  resources.id = "resourceHub";
  resources.innerHTML =
    '<h2>공개 해양정보 바로가기</h2><p class="help">실측·예보·통계의 용도를 구분해 활용하세요. 아래 링크는 외부 자료이며 자동으로 수색 예측에 반영되지 않습니다.</p>';
  for (const [name, url, note] of [
    [
      "기상청 해양기상부이",
      "https://www.weather.go.kr/w/obs-climate/sea/buoy-obs.do",
      "실측 파고·풍향·풍속",
    ],
    [
      "기상청 파고부이",
      "https://www.weather.go.kr/w/obs-climate/sea/buoy-cosmos.do",
      "연안 파고 확인",
    ],
    [
      "국립수산과학원 실시간 관측",
      "https://www.nifs.go.kr/risa/main.do",
      "수온 등 해양환경 보조 확인",
    ],
    [
      "국립해양조사원 ROMS",
      "https://www.data.go.kr/data/15142227/openapi.do",
      "표층 해류·수온 예측 / 활용신청",
    ],
    [
      "국립해양조사원 항행경보",
      "https://www.data.go.kr/data/15057792/openapi.do",
      "사격훈련·수중·표류 장애물",
    ],
    [
      "해양경찰청 해상조난 인명 통계",
      "https://www.data.go.kr/data/15104130/fileData.do",
      "연간 통계 / 실시간 사고 정보 아님",
    ],
    [
      "OpenDrift Leeway",
      "https://opendrift.github.io/autoapi/opendrift/models/leeway/index.html",
      "수색구조 모델·계수 참고자료",
    ],
  ]) {
    const line = document.createElement("p"),
      a = text("a", name + " ↗", line);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    text("small", " — " + note, line);
    resources.append(line);
  }
  $("operationsCard").after(resources);
  return () => {
    generation++;
    for (const id of [
      "contextValues",
      "contextForecast",
      "romsInfo",
      "navigationWarnings",
    ])
      $(id).replaceChildren();
    $("contextStatus").textContent =
      "선택 위치가 바뀌었습니다. 새 좌표로 다시 조회하세요.";
  };
}
