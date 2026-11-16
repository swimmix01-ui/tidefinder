// ==========================================================================
// 해상 위험물 레이어 - 어장(정치망·양식·마을어업), 간출암을 카카오맵 위에 표시
//
// 데이터
//  - /fishery-pohang.geojson : 국립해양조사원 어장정보(공공데이터포털, 2025-08 배포본)에서
//    포항·경주·영덕만 잘라 WGS84로 변환한 것. 속성 t = set(정치망) | farm(양식) | village(마을어업)
//    ※ 면허 구역(서류상 경계)이라 실제 부표·그물 위치와 다를 수 있다.
//  - /rocks-pohang.geojson   : 간출암(점). 파일이 없으면 조용히 건너뛴다.
//
// 이 모듈은 지도 표시와 "직선 항로가 위험물에 걸리는지" 판정을 함께 맡는다.
// ==========================================================================
import * as turf from '@turf/turf';

const STYLE = {
  set:     { label: '정치망',   stroke: '#FF4D4D', fill: '#FF4D4D', fillOpacity: 0.35, on: true },
  farm:    { label: '양식장',   stroke: '#FBBF24', fill: '#FBBF24', fillOpacity: 0.22, on: true },
  village: { label: '마을어업', stroke: '#34D399', fill: '#34D399', fillOpacity: 0.10, on: false },
  rock:    { label: '간출암',   on: true },
};

let map = null;
let fishery = null;   // FeatureCollection
let rocks = null;     // FeatureCollection
const shapes = { set: [], farm: [], village: [], rock: [] };
const visible = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.on]));
let infoOverlay = null;
let ignoreMapClickUntil = 0;

export function getLayerState() {
  return {
    loaded: { fishery: !!fishery, rocks: !!rocks },
    counts: {
      set: shapes.set.length, farm: shapes.farm.length, village: shapes.village.length, rock: shapes.rock.length,
    },
    visible: { ...visible },
  };
}

// 도형을 눌렀을 때 지도 클릭(=사고좌표 이동)까지 같이 일어나지 않게 막는 용도
export function shouldIgnoreMapClick() {
  return Date.now() < ignoreMapClickUntil;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.type === 'FeatureCollection' ? data : null;
  } catch {
    return null;
  }
}

export async function loadSeaLayers() {
  const [f, r] = await Promise.all([fetchJson('/fishery-pohang.geojson'), fetchJson('/rocks-pohang.geojson')]);
  fishery = f;
  rocks = r;
  if (f) console.info(`✅ 어장 데이터 로드 (${f.features.length}건)`);
  if (r) console.info(`✅ 간출암 데이터 로드 (${r.features.length}건)`);
  return { fishery: !!f, rocks: !!r };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtYmd(v) {
  const s = String(v || '');
  return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s || '-';
}

function fisheryInfoHtml(p) {
  const end = String(p.end || '');
  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const expired = end.length === 8 && end < todayStr;
  const st = STYLE[p.t] || STYLE.set;
  return `<div class="sea-info">
    <div class="sea-info-head" style="color:${st.stroke}">${esc(p.knd || st.label)}${p.mthd ? ` · ${esc(p.mthd)}` : ''}</div>
    ${p.farm ? `<div>대상: ${esc(p.farm)}</div>` : ''}
    <div>${esc(p.addr)}</div>
    <div>면허 ${esc(p.no || '-')} · ${p.area ?? '-'}ha</div>
    <div>면허기간 ~${fmtYmd(end)}${expired ? ' <b style="color:#FF8A8A">(만료)</b>' : ''}</div>
    <div class="sea-info-sub">구역도 기준 ${esc(p.yr || '-')}년 · 실제 위치와 다를 수 있음</div>
  </div>`;
}

function showInfo(latLng, html) {
  if (!map) return;
  if (infoOverlay) infoOverlay.setMap(null);
  infoOverlay = new window.kakao.maps.CustomOverlay({ position: latLng, content: html, yAnchor: 1.15, zIndex: 30 });
  infoOverlay.setMap(map);
}

export function hideInfo() {
  if (infoOverlay) { infoOverlay.setMap(null); infoOverlay = null; }
}

function ringToPath(ring) {
  return ring.map(([lon, lat]) => new window.kakao.maps.LatLng(lat, lon));
}

function drawFishery() {
  if (!fishery) return;
  fishery.features.forEach((f) => {
    const p = f.properties || {};
    const st = STYLE[p.t];
    if (!st || !f.geometry) return;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach((poly) => {
      const shape = new window.kakao.maps.Polygon({
        path: poly.map(ringToPath),
        strokeWeight: p.t === 'set' ? 2 : 1.2,
        strokeColor: st.stroke, strokeOpacity: 0.9,
        fillColor: st.fill, fillOpacity: st.fillOpacity,
        zIndex: p.t === 'set' ? 3 : 2,
      });
      window.kakao.maps.event.addListener(shape, 'click', (e) => {
        ignoreMapClickUntil = Date.now() + 400;
        showInfo(e.latLng, fisheryInfoHtml(p));
      });
      if (visible[p.t]) shape.setMap(map);
      shapes[p.t].push(shape);
    });
  });
}

function rockInfoHtml(p) {
  // 전자해도 수심값(VALSOU): 음수 = 기본수준면(약최저저조면) 위로 드러나는 높이, 양수 = 그 아래 수심
  const v = typeof p.valsou === 'number' ? p.valsou : null;
  let line = '저조 때 수면 근처로 드러나는 바위';
  if (v !== null && v < 0) line = `저조 때 약 ${Math.abs(v).toFixed(1)}m 드러남`;
  else if (v !== null && v > 0) line = `기본수준면 아래 ${v.toFixed(1)}m · 저조에도 얕게 잠김`;
  return `<div class="sea-info">
    <div class="sea-info-head" style="color:#FF8A3D">간출암</div>
    <div>${line}</div>
    <div class="sea-info-sub">전자해도 ${esc(p.chart || '')} · 고조 때는 물에 잠겨 안 보임</div>
  </div>`;
}

function drawRocks() {
  if (!rocks) return;
  rocks.features.forEach((f) => {
    if (!f.geometry || f.geometry.type !== 'Point') return;
    const [lon, lat] = f.geometry.coordinates;
    const pos = new window.kakao.maps.LatLng(lat, lon);
    const el = document.createElement('div');
    el.className = 'rock-mark';
    el.title = '간출암';
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ignoreMapClickUntil = Date.now() + 400;
      showInfo(pos, rockInfoHtml(f.properties || {}));
    });
    const ov = new window.kakao.maps.CustomOverlay({ position: pos, content: el, zIndex: 6, clickable: true });
    if (visible.rock) ov.setMap(map);
    shapes.rock.push(ov);
  });
}

export function initSeaLayers(kakaoMap) {
  map = kakaoMap;
  if (!map) return;
  drawFishery();
  drawRocks();
  window.kakao.maps.event.addListener(map, 'zoom_changed', hideInfo);
}

export function setLayerVisible(kind, on) {
  visible[kind] = on;
  shapes[kind].forEach((s) => s.setMap(on && map ? map : null));
  if (!on) hideInfo();
}

// ---------------------------------------------------------------------------
// 직선 항로 위험 판정: 출발지→목적지 직선을 bufferM 폭으로 넓혀서
// 정치망·양식장(면허 구역)과 간출암이 걸리는지 본다. 마을어업은 제외(연안 갯바위 구역).
// ---------------------------------------------------------------------------
export function findHazardsOnRoute(from, to, bufferM = 100) {
  const out = [];
  if (!fishery && !rocks) return { checked: false, hazards: out };
  let corridor;
  try {
    const line = turf.lineString([[from.lon, from.lat], [to.lon, to.lat]]);
    corridor = turf.buffer(line, bufferM, { units: 'meters' });
  } catch {
    return { checked: false, hazards: out };
  }
  const [minX, minY, maxX, maxY] = turf.bbox(corridor);
  const routeLen = turf.distance([from.lon, from.lat], [to.lon, to.lat], { units: 'meters' });

  if (fishery) {
    fishery.features.forEach((f) => {
      const p = f.properties || {};
      if (p.t !== 'set' && p.t !== 'farm') return;
      const [a, b, c, d] = turf.bbox(f);
      if (c < minX || a > maxX || d < minY || b > maxY) return;
      try {
        if (!turf.booleanIntersects(corridor, f)) return;
        const centre = turf.centroid(f).geometry.coordinates;
        out.push({
          kind: p.t, label: STYLE[p.t].label, name: p.knd + (p.mthd ? `(${p.mthd})` : ''), addr: p.addr, no: p.no,
          lat: centre[1], lon: centre[0],
          fromStartM: turf.distance([from.lon, from.lat], centre, { units: 'meters' }),
        });
      } catch { /* 형상 오류 1건은 건너뜀 */ }
    });
  }
  if (rocks) {
    rocks.features.forEach((f) => {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      const [lon, lat] = f.geometry.coordinates;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) return;
      if (!turf.booleanPointInPolygon([lon, lat], corridor)) return;
      out.push({
        kind: 'rock', label: '간출암', name: (f.properties && f.properties.name) || '간출암', lat, lon,
        fromStartM: turf.distance([from.lon, from.lat], [lon, lat], { units: 'meters' }),
      });
    });
  }
  out.sort((x, y) => x.fromStartM - y.fromStartM);
  return { checked: true, hazards: out, routeLen };
}
