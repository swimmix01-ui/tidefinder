import * as api from "./api.js";
import * as ui from "./ui.js";
import {
  DT_STATIONS,
  DT_RECENT_STATIONS,
  HF_STATIONS,
  SF_STATIONS,
  TW_STATIONS,
  getKmaStnId,
} from "./constants.js";
import { distanceBetween } from "./geo.js";
import { kstParts, parseKst, formatKst, finite } from "./model.js";
const ids = [
  "marineWaterTemp",
  "marineAirTemp",
  "marineAirPress",
  "marineWaveHeight",
  "marineWind",
  "marineVisibility",
  "marineHfCurrent",
  "marineNextTide",
];
let generation = 0;
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const time = (v) =>
  v?.obsrvnDt || v?.record_time || v?.predcDt || v?.time || null;
const latest = (v) =>
  list(v).sort((a, b) => parseKst(time(b)) - parseKst(time(a)))[0];
const nearest = (items, lat, lon) =>
  [...items].sort(
    (a, b) =>
      distanceBetween(lat, lon, a.lat, a.lon) -
      distanceBetween(lat, lon, b.lat, b.lon),
  )[0];
const numeric = (v, keys) => {
  for (const k of keys) if (finite(v?.[k])) return Number(v[k]);
  return null;
};
export async function loadMarineStatus({ lat = 36.023, lon = 129.419 } = {}) {
  const request = ++generation;
  const set = (id, value) => {
    if (request === generation) document.getElementById(id).textContent = value;
  };
  const dt = nearest(DT_STATIONS, lat, lon),
    dtr = nearest(DT_RECENT_STATIONS, lat, lon),
    tw = nearest(TW_STATIONS, lat, lon),
    hf = nearest(HF_STATIONS, lat, lon),
    sf = nearest(SF_STATIONS, lat, lon);
  const date = kstParts(new Date()).compact;
  ids.forEach((id) => set(id, "조회 중…"));
  set("marineStationName", dt.name);
  set("marineObsTime", "항목별 시각 확인");
  set("marineFreshness", "항목별 시각 확인");
  for (const id of ["waveStatusPill", "windStatusPill", "marineAlertBox"]) {
    const el = document.getElementById(id);
    el.replaceChildren();
    if (id === "marineAlertBox") el.style.display = "none";
  }
  const note = (item, station) => {
    const t = parseKst(time(item)),
      d = (distanceBetween(lat, lon, station.lat, station.lon) / 1000).toFixed(
        1,
      );
    if (!Number.isFinite(t.getTime()))
      return `${station.name} · ${d}km · 관측시각 미확인`;
    const age = Math.round((Date.now() - t) / 60000);
    return `${station.name} · ${d}km · ${formatKst(t)}${age > 90 ? " · 갱신 지연" : age < 0 ? " · 미래시각 확인 필요" : ""}`;
  };
  const tasks = await Promise.allSettled([
    api.fetchMarineWeatherData(dt.code, date),
    api.fetchDtRecent(dtr.code, date),
    api.fetchTwRecent(tw.code, date),
    api.fetchWindData(lat, lon),
    api.fetchHfCurrentByStation(hf.code),
    api.fetchTideData(dt.code),
    api.fetchSeaFogData(sf.code, date),
    api.fetchAlertData(getKmaStnId(lat, lon)),
  ]);
  if (request !== generation) return;
  const val = (i) => (tasks[i].status === "fulfilled" ? tasks[i].value : null);
  const marine = val(0);
  if (marine)
    for (const [id, items, keys, unit] of [
      ["marineWaterTemp", marine.water, ["wtem", "water_temp"], "℃"],
      ["marineAirTemp", marine.air, ["artmp", "air_temp"], "℃"],
      ["marineAirPress", marine.press, ["atmpr", "air_pres"], "hPa"],
    ]) {
      const it = latest(items),
        n = numeric(it, keys);
      if (n !== null) set(id, `${n}${unit} (실측) / ${note(it, dt)}`);
    }
  const dtrItem = latest(val(1)),
    twItem = latest(val(2)),
    wind = val(3);
  let windItem = numeric(dtrItem, ["wspd"]) !== null ? dtrItem : twItem,
    windStation = windItem === dtrItem ? dtr : tw;
  const wspd = numeric(windItem, ["wspd"]),
    wdir = numeric(windItem, ["wndrct"]);
  if (wspd !== null)
    set(
      "marineWind",
      `${wdir ?? "미확인"}° / ${wspd}m/s (실측) / ${note(windItem, windStation)}`,
    );
  else if (wind && wind.windSpeedMS !== null)
    set(
      "marineWind",
      `${wind.windDirFrom ?? "미확인"}° / ${wind.windSpeedMS}m/s (기상청 단기예보·선택 격자)`,
    );
  const wave = numeric(twItem, ["wvhgt"]);
  if (wave !== null)
    set("marineWaveHeight", `${wave}m (실측) / ${note(twItem, tw)}`);
  else if (wind && wind.waveHeightM !== null)
    set("marineWaveHeight", `${wind.waveHeightM}m (기상청 단기예보·연안 참고)`);
  const hfItems = list(val(4))
      .filter((v) => finite(v.lat) && finite(v.lot))
      .sort(
        (a, b) =>
          distanceBetween(lat, lon, a.lat, a.lot) -
          distanceBetween(lat, lon, b.lat, b.lot),
      ),
    hit = hfItems[0];
  if (
    hit &&
    numeric(hit, ["crsp"]) !== null &&
    numeric(hit, ["crdir"]) !== null
  ) {
    const dist = (
      distanceBetween(lat, lon, Number(hit.lat), Number(hit.lot)) / 1000
    ).toFixed(1);
    set(
      "marineHfCurrent",
      `${hit.crdir}° / ${hit.crsp}cm/s (실측) / ${note(hit, hf)} / 관측점 ${dist}km`,
    );
  }
  const tide = list(val(5))
    .map((v) => ({ ...v, t: parseKst(v.predcDt) }))
    .filter((v) => Number.isFinite(v.t.getTime()) && v.t > Date.now())
    .sort((a, b) => a.t - b.t)[0];
  if (tide) {
    const kind = ["1", "2"].includes(String(tide.extrSe))
      ? "만조"
      : ["3", "4"].includes(String(tide.extrSe))
        ? "간조"
        : "조위 변화";
    set(
      "marineNextTide",
      `${kind} ${formatKst(tide.t)} / ${finite(tide.predcTdlvVl) ? tide.predcTdlvVl + "cm" : "조위 미수신"} / ${dt.name}`,
    );
  }
  const fog = latest(val(6)),
    visibility = numeric(fog, ["dtvsbV20kLen"]);
  if (visibility !== null)
    set(
      "marineVisibility",
      `${(visibility / 1000).toFixed(1)}km (실측) / ${note(fog, sf)}`,
    );
  const box = document.getElementById("marineAlertBox"),
    alerts = list(val(7));
  // This API returns announcements, not a normalized active-warning state. Never infer all-clear or current validity.
  const titles = alerts
    .map((v) => v.title || v.wrnVar || v.msg || "")
    .filter((v) => /풍랑|강풍|태풍|해일/.test(v));
  box.style.display = "block";
  box.textContent = titles.length
    ? `최근 기상특보 발표 목록 (현재 발효·해제 여부 원문 확인): ${titles.slice(0, 3).join(" / ")}`
    : "기상특보: 현재 발효 상태를 이 자료만으로 확정할 수 없습니다. 기상청 원문을 확인하세요.";
  ids.forEach((id) => {
    if (document.getElementById(id).textContent === "조회 중…")
      set(id, id === "marineNextTide" ? "다음 조석 자료 미확보" : "미수신");
  });
}
