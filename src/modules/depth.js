// ==========================================================================
// 얕은 수심 - 국립해양조사원 자연과학용 수심(150m 격자, 평균해면 기준)
//  - 서버 함수(mode=shallow)가 0.1°×0.1° 타일 단위로 수심 10m 이하 점만 추려서 준다.
//  - 지도 레이어(얕은 곳 색칠)와 항로 계산(구조정 최소수심 미만 회피)에 같이 쓴다.
//  ※ 150m 간격 격자라 작은 암초·좁은 여울은 빠질 수 있다. 평균해면 기준이라
//    저조 때는 표시값보다 조금(동해안 약 0.1~0.3m) 더 얕다.
// ==========================================================================

const TILE = 0.05;
const MAX_DEPTH = 10;
const tiles = new Map(); // "tx,ty" -> Promise<[[lat, lon, d], ...]>
let lastError = '';
export function getLastDepthError() { return lastError; }

function tileKey(tx, ty) { return `${tx},${ty}`; }

function fetchTile(tx, ty) {
  const k = tileKey(tx, ty);
  if (tiles.has(k)) return tiles.get(k);
  const p = fetch(`/.netlify/functions/weather?mode=shallow&tx=${tx}&ty=${ty}&maxDepth=${MAX_DEPTH}`)
    .then(async (r) => {
      if (r.ok) return r.json();
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j.error) msg = j.error; } catch { /* 본문 없음 */ }
      throw new Error(msg);
    })
    .then((j) => j.pts || [])
    .catch((err) => { tiles.delete(k); lastError = String(err.message || err); console.warn('수심 타일 실패', k, err); return null; });
  tiles.set(k, p);
  return p;
}

// 범위 안의 얕은 점들. 타일이 너무 많으면(넓은 범위) null - 호출부는 수심 없이 진행한다.
export async function getShallowPoints(latMin, latMax, lonMin, lonMax, maxTiles = 80) {
  const tx0 = Math.floor(lonMin / TILE), tx1 = Math.floor(lonMax / TILE);
  const ty0 = Math.floor(latMin / TILE), ty1 = Math.floor(latMax / TILE);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > maxTiles) return { pts: null, reason: '범위가 넓어 수심 생략' };
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(fetchTile(tx, ty));
  const res = await Promise.all(jobs);
  const failed = res.filter((r) => r === null).length;
  const pts = [];
  res.forEach((r) => { if (r) for (const p of r) if (p[0] >= latMin && p[0] <= latMax && p[1] >= lonMin && p[1] <= lonMax) pts.push(p); });
  return { pts, failed, total: res.length };
}

// ---------------------------------------------------------------------------
// 지도 레이어: 화면 범위의 얕은 곳을 150m 칸으로 색칠 (확대했을 때만)
// ---------------------------------------------------------------------------
let map = null;
let on = false;
let shapes = [];
let drawSeq = 0;
const MAX_LEVEL = 8; // 이보다 축소하면 칸이 너무 작아 생략

function colorFor(d) {
  if (d < 2) return ['#FF3B3B', 0.55];
  if (d < 5) return ['#FF9F1C', 0.42];
  return ['#FDE68A', 0.22];
}

function clearShapes() { shapes.forEach((s) => s.setMap(null)); shapes = []; }

async function redraw() {
  if (!map || !on) return;
  const seq = ++drawSeq;
  const note = document.getElementById('depthNote');
  if (map.getLevel() > MAX_LEVEL) {
    clearShapes();
    if (note) note.textContent = '수심: 지도를 더 확대하면 얕은 곳이 표시됩니다';
    return;
  }
  const b = map.getBounds();
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  if (note) note.textContent = '수심 불러오는 중…';
  const { pts, failed } = await getShallowPoints(sw.getLat(), ne.getLat(), sw.getLng(), ne.getLng(), 40);
  if (seq !== drawSeq) return; // 그 사이 지도가 또 움직였음
  clearShapes();
  if (!pts) { if (note) note.textContent = '수심: 더 확대해 주세요'; return; }
  const hLat = 0.00068, hLon = 0.00083; // 격자 반 칸(약 75m)
  pts.slice(0, 4000).forEach(([la, lo, d]) => {
    const [c, op] = colorFor(d);
    const r = new window.kakao.maps.Rectangle({
      bounds: new window.kakao.maps.LatLngBounds(new window.kakao.maps.LatLng(la - hLat, lo - hLon), new window.kakao.maps.LatLng(la + hLat, lo + hLon)),
      strokeWeight: 0, fillColor: c, fillOpacity: op, zIndex: 1,
    });
    r.setMap(map);
    shapes.push(r);
  });
  if (note) note.textContent = `수심(평균해면 기준): 빨강 2m 미만 · 주황 2~5m · 노랑 5~10m · 이 화면 ${pts.length}칸${failed ? ` · ${failed}개 구역 불러오기 실패 (${lastError.slice(0, 80)})` : ''}`;
}

export function initDepthLayer(kakaoMap) {
  map = kakaoMap;
  if (!map) return;
  window.kakao.maps.event.addListener(map, 'idle', () => { if (on) redraw(); });
}

export function setDepthVisible(v) {
  on = v;
  const note = document.getElementById('depthNote');
  if (!v) { clearShapes(); if (note) note.textContent = ''; return; }
  redraw();
}
