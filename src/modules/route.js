// ==========================================================================
// 해상 항로 계산 - 육지를 가로지르지 않고, 정치망·양식장·간출암을 피해서 가는 길
//
// 방식(격자 A*)
//  1. 출발지·사고지점을 감싸는 범위를 50~150m 격자로 나눈다(최대 약 20만 칸).
//  2. 해안선(전자해도 해안선 선형)을 격자에 벽으로 그린다. 선 사이로 새지 않게
//     대각선으로 넘어가는 칸은 양옆 칸까지 막는다.
//  3. 정치망·양식장 면허구역은 한 칸 더 넓혀서 막고, 간출암은 반경 120m를 막는다.
//  4. 사고지점에서 퍼져 나가 닿는 칸 = 같은 바다. 출발지가 육지(사무실·부두 안쪽)면
//     그 바다에서 가장 가까운 칸을 출발점으로 잡는다.
//  5. A*로 최단 경로를 찾고, 서로 보이는 점끼리 이어서 지그재그를 편다.
//
// ※ 한계: 방파제·교량 같은 인공구조물은 해안선 자료에 없을 수 있다. 어장은 서류상
//   면허구역이라 실제 부표와 다를 수 있다. 수심(얕은 곳)은 아직 반영 안 됨.
// ==========================================================================
import { getCoastlineData } from './coastline.js';
import { getHazardData } from './sealayers.js';
import { distanceBetween } from './geo.js';
import { getShallowPoints } from './depth.js';

const FREE = 0, COAST = 1, HAZARD = 2, SHALLOW = 3;
const MAX_CELLS = 200000;

let coastIndex = null;
let land = null; // 동해안 육지 폴리곤(통계청 시군구 경계 2013 기반) - 해안선 자료가 빠진 포항~영덕 보완용

export async function loadLandPolygons() {
  try {
    const res = await fetch('/land-east.geojson');
    if (!res.ok) return false;
    const d = await res.json();
    if (!d || !d.features) return false;
    land = d.features.map((f) => {
      const ring = f.geometry.coordinates[0];
      let a = Infinity, b = Infinity, x = -Infinity, y = -Infinity;
      for (const [lon, lat] of ring) { if (lon < a) a = lon; if (lon > x) x = lon; if (lat < b) b = lat; if (lat > y) y = lat; }
      return { a, b, x, y, ring };
    });
    console.info(`✅ 동해안 육지 폴리곤 로드 (${land.length}개)`);
    return true;
  } catch {
    return false;
  }
}
let coastIndexSrc = null;

function buildCoastIndex(data) {
  coastIndex = [];
  coastIndexSrc = data;
  for (const f of data.features) {
    const g = f && f.geometry;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const c of lines) {
      if (!c || c.length < 2) continue;
      let a = Infinity, b = Infinity, x = -Infinity, y = -Infinity;
      for (const [lon, lat] of c) { if (lon < a) a = lon; if (lon > x) x = lon; if (lat < b) b = lat; if (lat > y) y = lat; }
      coastIndex.push({ a, b, x, y, c });
    }
  }
}

function featureBBox(f) {
  if (f._bb) return f._bb;
  let a = Infinity, b = Infinity, x = -Infinity, y = -Infinity;
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const [lon, lat] of poly[0]) {
    if (lon < a) a = lon; if (lon > x) x = lon; if (lat < b) b = lat; if (lat > y) y = lat;
  }
  f._bb = [a, b, x, y];
  return f._bb;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 작은 binary heap (A* 열린 목록)
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0]; const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// 격자 범위(planOnce와 같은 식) - 수심 타일을 미리 받기 위해 따로 계산
function gridBounds(from, to, scale) {
  const lat0 = (from.lat + to.lat) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const tx = (to.lon - from.lon) * kx, ty = (to.lat - from.lat) * ky;
  const margin = Math.max(4000, Math.hypot(tx, ty) * 0.35) * scale;
  return {
    lonMin: from.lon + (Math.min(0, tx) - margin) / kx, lonMax: from.lon + (Math.max(0, tx) + margin) / kx,
    latMin: from.lat + (Math.min(0, ty) - margin) / ky, latMax: from.lat + (Math.max(0, ty) + margin) / ky,
  };
}

// 범위가 좁으면 만(灣) 출구가 격자 밖이라 길이 끊길 수 있다 → 범위를 넓혀 다시 시도
// opts: { avoidHazards, minDepth(m, 0이면 수심 무시) }
export async function planSeaRoute(from, to, opts = {}) {
  let best = null;
  for (const scale of [1, 2.5, 5]) {
    let depth = { pts: null, reason: '' };
    if (opts.minDepth > 0) {
      const b = gridBounds(from, to, scale);
      try { depth = await getShallowPoints(b.latMin, b.latMax, b.lonMin, b.lonMax, 80); } catch { depth = { pts: null, reason: '수심 불러오기 실패' }; }
    }
    const r = planOnce(from, to, opts, scale, depth.pts);
    r.depthUsed = !!depth.pts;
    r.depthNote = depth.pts ? (depth.failed ? `수심 일부 구역 누락(${depth.failed}/${depth.total})` : '') : (opts.minDepth > 0 ? (depth.reason || '수심 자료 없음') : '');
    if (r.ok && r.startOnLandM < 1500) return r;
    if (r.ok && (!best || !best.ok || r.startOnLandM < best.startOnLandM)) best = r;
    if (!best) best = r;
  }
  return best;
}

function planOnce(from, to, { avoidHazards = true, minDepth = 0 } = {}, scale = 1, depthPts = null) {
  const coast = getCoastlineData();
  if (!coast && !land) return { ok: false, reason: '해안선 자료를 아직 불러오지 못했습니다' };
  if (coast && coastIndexSrc !== coast) buildCoastIndex(coast);

  // 출발지 기준 평면 좌표(m)
  const lat0 = (from.lat + to.lat) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const toX = (lon) => (lon - from.lon) * kx;
  const toY = (lat) => (lat - from.lat) * ky;
  const tx = toX(to.lon), ty = toY(to.lat);
  const span = Math.hypot(tx, ty);
  const margin = Math.max(4000, span * 0.35) * scale;
  const x0 = Math.min(0, tx) - margin, x1 = Math.max(0, tx) + margin;
  const y0 = Math.min(0, ty) - margin, y1 = Math.max(0, ty) + margin;
  const cell = Math.max(50, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_CELLS)));
  const W = Math.ceil((x1 - x0) / cell), H = Math.ceil((y1 - y0) / cell);
  const grid = new Uint8Array(W * H);
  const ci = (x) => Math.floor((x - x0) / cell), cj = (y) => Math.floor((y - y0) / cell);
  const inb = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
  const lonMin = from.lon + x0 / kx, lonMax = from.lon + x1 / kx;
  const latMin = from.lat + y0 / ky, latMax = from.lat + y1 / ky;

  const mark = (i, j, val) => { if (inb(i, j) && grid[j * W + i] < val) grid[j * W + i] = val; };
  // 선분을 칸으로 그리기 - 대각 이동이면 옆 칸도 막아 틈을 없앤다
  function rasterSeg(ax, ay, bx, by, val) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / (cell / 3)));
    let pi = ci(ax), pj = cj(ay); mark(pi, pj, val);
    for (let s = 1; s <= n; s++) {
      const i = ci(ax + ((bx - ax) * s) / n), j = cj(ay + ((by - ay) * s) / n);
      if (i !== pi && j !== pj) { mark(i, pj, val); mark(pi, j, val); }
      mark(i, j, val); pi = i; pj = j;
    }
  }

  // 1-a) 육지 폴리곤: 테두리는 벽으로, 안쪽은 행 단위로 채운다(scanline)
  if (land) {
    const rows = Array.from({ length: H }, () => []);
    for (const L of land) {
      if (L.x < lonMin || L.a > lonMax || L.y < latMin || L.b > latMax) continue;
      const r = L.ring;
      for (let k = 0; k < r.length - 1; k++) {
        const ax = toX(r[k][0]), ay = toY(r[k][1]), bx = toX(r[k + 1][0]), by = toY(r[k + 1][1]);
        rasterSeg(ax, ay, bx, by, COAST);
        if (ay === by) continue;
        const lo = Math.min(ay, by), hi = Math.max(ay, by);
        const jA = Math.max(0, Math.ceil((lo - y0) / cell - 0.5)), jB = Math.min(H - 1, Math.floor((hi - y0) / cell - 0.5));
        for (let j = jA; j <= jB; j++) {
          const yc = y0 + (j + 0.5) * cell;
          if (yc < lo || yc >= hi) continue;
          rows[j].push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
        }
      }
    }
    for (let j = 0; j < H; j++) {
      const xs = rows[j]; if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const iA = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), iB = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
        for (let i = iA; i <= iB; i++) grid[j * W + i] = COAST;
      }
    }
  }

  // 1-b) 전자해도 해안선(선형)
  if (coastIndex) for (const s of coastIndex) {
    if (s.x < lonMin || s.a > lonMax || s.y < latMin || s.b > latMax) continue;
    const c = s.c;
    for (let k = 0; k < c.length - 1; k++) rasterSeg(toX(c[k][0]), toY(c[k][1]), toX(c[k + 1][0]), toY(c[k + 1][1]), COAST);
  }

  // 2) 어장(정치망·양식장)·간출암
  let hazardCount = 0;
  if (avoidHazards) {
    const { fishery, rocks } = getHazardData();
    const hz = new Uint8Array(W * H);
    if (fishery) for (const f of fishery.features) {
      const t = f.properties && f.properties.t;
      if ((t !== 'set' && t !== 'farm') || !f.geometry) continue;
      const [a, b, x, y] = featureBBox(f);
      if (x < lonMin || a > lonMax || y < latMin || b > latMax) continue;
      hazardCount++;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        const ring = poly[0].map(([lon, lat]) => [toX(lon), toY(lat)]);
        for (let k = 0; k < ring.length - 1; k++) {
          // 테두리(작은 구역이 칸보다 작아도 빠지지 않게)
          const len = Math.hypot(ring[k + 1][0] - ring[k][0], ring[k + 1][1] - ring[k][1]);
          const n = Math.max(1, Math.ceil(len / (cell / 3)));
          for (let s = 0; s <= n; s++) {
            const i = ci(ring[k][0] + ((ring[k + 1][0] - ring[k][0]) * s) / n), j = cj(ring[k][1] + ((ring[k + 1][1] - ring[k][1]) * s) / n);
            if (inb(i, j)) hz[j * W + i] = 1;
          }
        }
        // 내부
        const i0 = Math.max(0, ci(toX(a))), i1 = Math.min(W - 1, ci(toX(x)));
        const j0 = Math.max(0, cj(toY(b))), j1 = Math.min(H - 1, cj(toY(y)));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          if (pointInRing(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, ring)) hz[j * W + i] = 1;
        }
      }
    }
    if (rocks) for (const f of rocks.features) {
      if (!f.geometry || f.geometry.type !== 'Point') continue;
      const [lon, lat] = f.geometry.coordinates;
      if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) continue;
      hazardCount++;
      const px = toX(lon), py = toY(lat), r = 120, rc = Math.ceil(r / cell) + 1;
      const pi = ci(px), pj = cj(py);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = pi + di, j = pj + dj;
        if (inb(i, j) && Math.hypot(x0 + (i + 0.5) * cell - px, y0 + (j + 0.5) * cell - py) <= r + cell * 0.5) hz[j * W + i] = 1;
      }
    }
    // 어장 여유폭: 한 칸 넓힘(≥50m)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!hz[j * W + i]) continue;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) mark(i + di, j + dj, HAZARD);
    }
  }

  // 3) 얕은 곳: 구조정 최소수심보다 얕은 150m 격자점 주변(반경 80m)을 막는다
  let shallowCount = 0;
  if (depthPts && minDepth > 0) {
    const r = 80, rc = Math.ceil(r / cell) + 1;
    for (const [la, lo, d] of depthPts) {
      if (d >= minDepth) continue;
      shallowCount++;
      const px = toX(lo), py = toY(la), pi = ci(px), pj = cj(py);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = pi + di, j = pj + dj;
        if (inb(i, j) && Math.hypot(x0 + (i + 0.5) * cell - px, y0 + (j + 0.5) * cell - py) <= r + cell * 0.5 && grid[j * W + i] === FREE) grid[j * W + i] = SHALLOW;
      }
    }
  }
  // 사고지점 자체가 얕은 곳인지(가장 가까운 격자점이 최소수심 미만)
  let targetShallow = false;
  if (depthPts && minDepth > 0) {
    let bd = Infinity, bdep = null;
    for (const [la, lo, d] of depthPts) {
      const dd = Math.hypot(toX(lo) - tx, toY(la) - ty);
      if (dd < bd) { bd = dd; bdep = d; }
    }
    targetShallow = bd <= 110 && bdep !== null && bdep < minDepth;
  }

  const free = (i, j) => inb(i, j) && grid[j * W + i] === FREE;

  // 육지·위험물 바로 옆 칸은 막지는 않되(좁은 항구 입구가 닫히지 않게) 비용을 높여 가급적 떨어져 가게 한다
  const near = new Uint8Array(W * H); // 1 = 바로 옆, 2 = 두 칸 옆
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (grid[j * W + i] === FREE) continue;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const a = i + di, b = j + dj;
      if (!inb(a, b) || grid[b * W + a] !== FREE) continue;
      const lvl = Math.max(Math.abs(di), Math.abs(dj)) <= 1 ? 1 : 2;
      const id = b * W + a;
      if (!near[id] || near[id] > lvl) near[id] = lvl;
    }
  }
  const stepCost = (id) => (near[id] === 1 ? 3 : near[id] === 2 ? 1.6 : 1);

  // 가장 가까운 조건 만족 칸 찾기
  function nearest(i, j, ok, maxR) {
    if (ok(i, j)) return [i, j];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let d = -r; d <= r; d++) {
        for (const [a, b] of [[i + d, j - r], [i + d, j + r], [i - r, j + d], [i + r, j + d]]) {
          if (ok(a, b)) { const dd = (a - i) ** 2 + (b - j) ** 2; if (dd < bd) { bd = dd; best = [a, b]; } }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // 4) 사고지점 쪽 바다 찾기. 사고지점이 육지·어장 안이면 가장 가까운 빈 칸에서 시작하되,
  //    갇힌 웅덩이(조각난 칸)가 아니라 격자 가장자리(먼바다)까지 이어진 바다여야 한다.
  const sea = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  const tried = new Uint8Array(W * H);
  function fillFrom(i0, j0) {
    let qh = 0, qt = 0, edge = false;
    sea.fill(0);
    sea[j0 * W + i0] = 1; q[qt++] = j0 * W + i0;
    while (qh < qt) {
      const id = q[qh++], i = id % W, j = (id - i) / W;
      tried[id] = 1;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) edge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (free(a, b) && !sea[b * W + a]) { sea[b * W + a] = 1; q[qt++] = b * W + a; }
      }
    }
    return edge;
  }
  let tgt = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const cand = nearest(ci(tx), cj(ty), (a, b) => free(a, b) && !tried[b * W + a], 80);
    if (!cand) break;
    if (fillFrom(cand[0], cand[1])) { tgt = cand; break; }
  }
  if (!tgt) return { ok: false, reason: '사고지점 주변에 먼바다로 이어지는 바다가 없습니다' };
  const src = nearest(ci(0), cj(0), (a, b) => inb(a, b) && sea[b * W + a] === 1, Math.max(W, H));
  if (!src) return { ok: false, reason: '출발지에서 사고지점까지 바다로 이어지지 않습니다' };

  // 5) A*
  const N = W * H;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const sId = src[1] * W + src[0], tId = tgt[1] * W + tgt[0];
  const hfn = (i, j) => { // 비용이 1 이상이라 그대로 허용 가능한 추정치
    const dx = Math.abs(i - tgt[0]), dy = Math.abs(j - tgt[1]); return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy); };
  const heap = new Heap();
  g[sId] = 0; heap.push(hfn(src[0], src[1]), sId);
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  while (heap.size) {
    const id = heap.pop();
    if (closed[id]) continue;
    if (id === tId) { found = true; break; }
    closed[id] = 1;
    const i = id % W, j = (id - i) / W;
    for (const [di, dj, c] of DIRS) {
      const a = i + di, b = j + dj;
      if (!free(a, b)) continue;
      if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue; // 모서리 파고들기 금지
      const nid = b * W + a, ng = g[id] + c * stepCost(nid);
      if (ng < g[nid]) { g[nid] = ng; came[nid] = id; heap.push(ng + hfn(a, b), nid); }
    }
  }
  if (!found) return { ok: false, reason: '바다 길을 찾지 못했습니다' };

  const cells = [];
  for (let id = tId; id !== -1; id = came[id]) cells.push(id);
  cells.reverse();

  // 6) 지그재그 펴기: 서로 보이면(사이에 막힌 칸 없으면) 바로 잇는다
  const cx = (id) => x0 + ((id % W) + 0.5) * cell, cy = (id) => y0 + (Math.floor(id / W) + 0.5) * cell;
  const onPath = new Set(cells);
  function los(aId, bId) {
    const ax = cx(aId), ay = cy(aId), bx = cx(bId), by = cy(bId);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 3)));
    let pi = ci(ax), pj = cj(ay);
    for (let s = 1; s <= n; s++) {
      const i = ci(ax + ((bx - ax) * s) / n), j = cj(ay + ((by - ay) * s) / n);
      if (!free(i, j)) return false;
      if (near[j * W + i] === 1 && !onPath.has(j * W + i)) return false; // 펴면서 육지에 바짝 붙지 않게
      if (i !== pi && j !== pj && (!free(i, pj) || !free(pi, j))) return false;
      pi = i; pj = j;
    }
    return true;
  }
  const keep = [cells[0]];
  let k = 0;
  while (k < cells.length - 1) {
    let far = k + 1;
    // 멀리 있는 점부터 거꾸로 확인(긴 직선 우선)
    for (let m = cells.length - 1; m > k + 1; m -= Math.max(1, Math.floor((m - k) / 16))) {
      if (los(cells[k], cells[m])) { far = m; break; }
    }
    keep.push(cells[far]);
    k = far;
  }

  const toLL = (x, y) => ({ lat: from.lat + y / ky, lon: from.lon + x / kx });
  const seaPts = keep.map((id) => toLL(cx(id), cy(id)));
  seaPts[seaPts.length - 1] = { lat: to.lat, lon: to.lon }; // 마지막은 실제 사고지점
  const srcLL = seaPts[0];
  const startOnLandM = distanceBetween(from.lat, from.lon, srcLL.lat, srcLL.lon);
  // 출발지가 바다 위면(차이가 격자 1~2칸 이내) 실제 출발점에서 바로 시작
  if (startOnLandM <= cell * 2) seaPts[0] = { lat: from.lat, lon: from.lon };

  let distM = 0;
  for (let i = 0; i < seaPts.length - 1; i++) distM += distanceBetween(seaPts[i].lat, seaPts[i].lon, seaPts[i + 1].lat, seaPts[i + 1].lon);
  return {
    ok: true,
    points: seaPts,
    distM,
    straightM: distanceBetween(from.lat, from.lon, to.lat, to.lon),
    startOnLandM: startOnLandM > cell * 2 ? startOnLandM : 0,
    // 사고지점이 최소수심보다 얕은 곳이면: 구조정이 갈 수 있는 마지막 지점 → 사고지점 거리
    shallowLastLegM: targetShallow && seaPts.length >= 2
      ? distanceBetween(seaPts[seaPts.length - 2].lat, seaPts[seaPts.length - 2].lon, to.lat, to.lon) : 0,
    shallowCount,
    cellM: cell,
    hazardCount,
  };
}
