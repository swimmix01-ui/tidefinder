// ==========================================================================
// 지도 레이어 "조류" - 국립해양조사원 조류예측 격자를 화살표로 표시 (안전해 '해수유동'과 같은 개념)
//  · 화살표 방향 = 흘러가는 방향, 색·길이 = 세기 (kn)
//  · 지금 시각 기준. 지도를 옮기거나 확대하면 그 범위를 다시 받음 (확대 단계 9 이하에서만)
//  · 한 번에 너무 많이 그리면 폰이 느려지므로 격자를 솎아서 최대 MAX개
// ==========================================================================
const MAX = 140;
const CM_PER_KN = 51.44;
let map = null, visible = false, overlays = [], timer = null, seq = 0, noteEl = null;

const colorOf = (kn) => (kn < 0.5 ? '#60A5FA' : kn < 1 ? '#22D3EE' : kn < 1.5 ? '#FBBF24' : kn < 2 ? '#FB923C' : '#EF4444');

function arrowHtml(dir, kn) {
  const len = Math.round(16 + Math.min(kn, 3) * 9); // 16~43px
  const c = colorOf(kn);
  return `<div class="cur-arrow" style="transform:rotate(${dir}deg)"><svg width="14" height="${len}" viewBox="0 0 14 ${len}">
    <line x1="7" y1="${len}" x2="7" y2="6" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M7 0 L13 9 L1 9 Z" fill="${c}"/></svg></div>`;
}

function clear() { overlays.forEach((o) => o.setMap(null)); overlays = []; }

function setNote(t) { if (noteEl) noteEl.textContent = t; }

async function refresh() {
  if (!map || !visible) return;
  const my = ++seq;
  if (map.getLevel() > 9) { clear(); setNote('조류 화살표: 지도를 더 확대하면 표시됩니다'); return; }
  const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
  const cLat = (sw.getLat() + ne.getLat()) / 2, cLon = (sw.getLng() + ne.getLng()) / 2;
  const hy = Math.min(0.15, (ne.getLat() - sw.getLat()) / 2), hx = Math.min(0.18, (ne.getLng() - sw.getLng()) / 2);
  const now = new Date();
  const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(Math.floor(now.getMinutes() / 10) * 10).padStart(2, '0');
  setNote('조류 화살표 불러오는 중…');
  try {
    const url = `/.netlify/functions/weather?mode=khoacurrent&date=${ds}&hour=${hh}&minute=${mi}`
      + `&minX=${(cLon - hx).toFixed(4)}&maxX=${(cLon + hx).toFixed(4)}&minY=${(cLat - hy).toFixed(4)}&maxY=${(cLat + hy).toFixed(4)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (my !== seq || !visible) return;
    let pts = (d && d.result && d.result.data) || [];
    pts = pts.map((p) => ({ lat: +p.pre_lat, lon: +p.pre_lon, kn: +p.current_speed / CM_PER_KN, dir: +p.current_dir }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.dir) && Number.isFinite(p.kn));
    if (pts.length > MAX) { const step = Math.ceil(pts.length / MAX); pts = pts.filter((_, i) => i % step === 0); }
    clear();
    pts.forEach((p) => {
      const ov = new window.kakao.maps.CustomOverlay({ position: new window.kakao.maps.LatLng(p.lat, p.lon), content: arrowHtml(p.dir, p.kn), zIndex: 4, xAnchor: 0.5, yAnchor: 0.5 });
      ov.setMap(map);
      overlays.push(ov);
    });
    const maxKn = pts.reduce((m, p) => Math.max(m, p.kn), 0);
    setNote(pts.length
      ? `조류 화살표 ${hh}:${mi} 예측 · 최대 ${maxKn.toFixed(1)}kn · 파랑 <0.5 · 청록 <1 · 노랑 <1.5 · 주황 <2 · 빨강 ≥2kn`
      : '조류 화살표: 이 범위엔 조류예측 자료가 없습니다');
  } catch {
    if (my === seq) setNote('조류 화살표를 불러오지 못했습니다 (통신 오류)');
  }
}

export function initCurrentArrows(kakaoMap, note) {
  map = kakaoMap; noteEl = note;
  if (!map) return;
  window.kakao.maps.event.addListener(map, 'idle', () => { if (!visible) return; clearTimeout(timer); timer = setTimeout(refresh, 600); });
}

export function setCurrentArrowsVisible(on) {
  visible = on;
  if (on) refresh(); else { seq++; clear(); setNote(''); }
}
