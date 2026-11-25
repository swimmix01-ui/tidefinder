// ==========================================================================
// 경북 어항 - 구조정 진입·계류 가능 여부 (지도 레이어 "어항")
//  자료: 해양수산부 국립해양조사원 소형선항만안내(조사 2017년) 중 경상북도 45곳.
//  설명 글에 "항내 수심 2∼10m" 같은 문장이 있는 11곳만 수심 판정이 되고,
//  나머지는 접안 톤급·주의사항 문장만 보여준다(⚪ 정보 없음).
//  판정 기준: "필요 수심"(기본 1.5m = 구조정 흘수 0.56m + 선외기 하단·여유) - 출동 카드에서 바꿀 수 있음.
//  ※ 해도 수심은 기본수준면(약최저저조면) 기준이라 저조 때 값으로 본다. 2017년 조사라
//    준설·토사 유입으로 달라졌을 수 있다 → 최종 판단은 현장 확인.
// ==========================================================================
let map = null;
let data = null;
let visible = false;
let marks = [];
let info = null;
let ignoreUntil = 0;
const NEED_KEY = 'tf_harbor_need_depth';
export const BOAT = { name: '구조정', draftM: 0.56, lengthM: 12.5, gt: 8.6 };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function getNeedDepth() {
  try { const v = parseFloat(localStorage.getItem(NEED_KEY)); if (v > 0) return v; } catch { /* 기본값 */ }
  return 1.5;
}
export function setNeedDepth(v) {
  try { localStorage.setItem(NEED_KEY, String(v)); } catch { /* 무시 */ }
  redraw();
}
export function shouldIgnoreMapClick() { return Date.now() < ignoreUntil; }

// 🟢 수심 충분 / 🟡 일부 구역만 / 🔴 얕음 / ⚪ 정보 없음
export function judge(h, need = getNeedDepth()) {
  if (h.dmin == null || h.dmax == null) return { level: 'none', color: '#94A3B8', label: '수심 정보 없음' };
  if (h.dmin >= need) return { level: 'ok', color: '#22C55E', label: `계류 가능 (항내 최저 ${h.dmin}m ≥ 필요 ${need}m)` };
  if (h.dmax >= need) return { level: 'part', color: '#FBBF24', label: `일부 구역만 가능 (항내 ${h.dmin}~${h.dmax}m, 필요 ${need}m)` };
  return { level: 'no', color: '#EF4444', label: `진입 곤란 (항내 최대 ${h.dmax}m < 필요 ${need}m)` };
}

export async function loadHarbors() {
  try {
    const r = await fetch('/harbors-gb.json');
    if (!r.ok) return false;
    data = await r.json();
    console.info(`✅ 경북 어항 ${data.harbors.length}곳 로드`);
    return true;
  } catch { return false; }
}

function infoHtml(h) {
  const j = judge(h);
  const list = (arr) => arr.map((s) => `<div>· ${esc(s)}</div>`).join('');
  return `<div class="sea-info" style="max-width:260px">
    <div class="sea-info-head">⚓ ${esc(h.name)}</div>
    <div style="color:${j.color};font-weight:800">${esc(j.label)}</div>
    ${h.dnote ? `<div style="margin-top:3px">${esc(h.dnote)}</div>` : ''}
    ${h.berth && h.berth.length ? `<div style="margin-top:4px;font-weight:700">접안·묘박</div>${list(h.berth)}` : ''}
    ${h.warn && h.warn.length ? `<div style="margin-top:4px;font-weight:700;color:#FF8A8A">주의</div>${list(h.warn)}` : ''}
    ${!h.dnote && !(h.berth && h.berth.length) && h.intro ? `<div style="margin-top:3px">${esc(h.intro)}</div>` : ''}
    <div class="sea-info-sub">구조정 흘수 ${BOAT.draftM}m·전장 ${BOAT.lengthM}m · 소형선항만안내 ${esc(h.year)}년 조사 · 저조 기준 · 현장 확인 필수</div>
  </div>`;
}

function hideInfo() { if (info) { info.setMap(null); info = null; } }

function redraw() {
  marks.forEach((m) => m.setMap(null));
  marks = [];
  hideInfo();
  if (!map || !data) return;
  data.harbors.forEach((h) => {
    const j = judge(h);
    const pos = new window.kakao.maps.LatLng(h.lat, h.lon);
    const el = document.createElement('div');
    el.className = 'harbor-mark';
    el.innerHTML = `<i style="background:${j.color}"></i><span>${esc(h.name)}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ignoreUntil = Date.now() + 400;
      hideInfo();
      info = new window.kakao.maps.CustomOverlay({ position: pos, content: infoHtml(h), yAnchor: 1.12, zIndex: 31 });
      info.setMap(map);
    });
    const ov = new window.kakao.maps.CustomOverlay({ position: pos, content: el, zIndex: 7, clickable: true, xAnchor: 0.08, yAnchor: 0.5 });
    if (visible) ov.setMap(map);
    marks.push(ov);
  });
}

export function initHarbors(kakaoMap) {
  map = kakaoMap;
  if (!map) return;
  redraw();
  window.kakao.maps.event.addListener(map, 'zoom_changed', hideInfo);
  window.kakao.maps.event.addListener(map, 'click', hideInfo);
}

export function setHarborsVisible(on) {
  visible = on;
  marks.forEach((m) => m.setMap(on && map ? map : null));
  if (!on) hideInfo();
}
