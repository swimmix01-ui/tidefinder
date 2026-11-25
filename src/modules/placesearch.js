// ==========================================================================
// 위치 검색 - "지경항", "영일대", "36 01.383 129 25.170" 무엇이든
//  1) 좌표 형식이면 바로 적용 (플로터 도·분 / 도분초 / 도 소수)
//  2) 경북 어항 45곳(소형선항만안내) 이름은 폰 안에서 바로 찾음 (오프라인 가능, 항내 좌표)
//  3) 그 밖의 지명은 카카오 장소검색 (지도에 쓰는 카카오 SDK 그대로, 검색어만 보냄)
//  ※ 카카오 결과는 건물·주소 기준이라 육상 좌표일 수 있음 → 선택 후 지도에서 정확한 사고 지점을 눌러 보정
// ==========================================================================
import { parseCoordText } from './geo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/항$/, '').toLowerCase();

let places = null;
function kakaoPlaces() {
  if (places) return places;
  if (window.kakao && window.kakao.maps && window.kakao.maps.services) places = new window.kakao.maps.services.Places();
  return places;
}

// 경북 어항 이름 매칭 - "지경", "지경항", "울릉" 모두
export function matchHarbors(list, q, max = 5) {
  const n = norm(q);
  if (!n || !list) return [];
  const starts = [], contains = [];
  list.forEach((h) => {
    const hn = norm(h.name);
    if (hn.startsWith(n)) starts.push(h);
    else if (hn.includes(n) || norm(h.addr).includes(n)) contains.push(h);
  });
  return starts.concat(contains).slice(0, max);
}

function kakaoSearch(q, center) {
  const svc = kakaoPlaces();
  if (!svc) return Promise.resolve([]);
  return new Promise((resolve) => {
    const opt = { size: 8 };
    if (center) opt.location = center;
    svc.keywordSearch(q, (data, status) => {
      if (status !== window.kakao.maps.services.Status.OK) return resolve([]);
      resolve(data.map((d) => ({ name: d.place_name, sub: d.road_address_name || d.address_name, lat: parseFloat(d.y), lon: parseFloat(d.x), src: 'kakao' })));
    }, opt);
  });
}

/**
 * @param {object} o - { input, list, note, getHarbors, getCenter, onPick(lat, lon, label, src) }
 */
export function initPlaceSearch(o) {
  const { input, list, note } = o;
  let seq = 0, timer = null, items = [];

  const close = () => { list.style.display = 'none'; list.innerHTML = ''; items = []; };
  const render = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) => `<button type="button" class="ps-item" data-i="${i}">
      <span class="ps-ico">${it.src === 'harbor' ? '⚓' : it.src === 'coord' ? '🎯' : '📍'}</span>
      <span class="ps-txt"><b>${esc(it.name)}</b><small>${esc(it.sub || '')}</small></span></button>`).join('');
    list.style.display = 'block';
  };
  const pick = (it) => {
    close();
    input.value = it.name;
    input.blur();
    o.onPick(it.lat, it.lon, it.name, it.src);
    note.textContent = it.src === 'kakao'
      ? `📍 ${it.name}로 이동 · 지명 위치라 육상일 수 있음 → 지도에서 정확한 사고 지점을 눌러 보정`
      : it.src === 'harbor' ? `⚓ ${it.name} 항내 좌표 입력` : `🎯 ${it.sub}`;
    note.style.color = it.src === 'kakao' ? 'var(--amber)' : 'var(--green)';
  };

  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (!q) { close(); note.textContent = ''; return; }
    const c = parseCoordText(q);
    if (c) {
      items = [{ name: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, sub: `${c.format} 좌표로 읽음`, lat: c.lat, lon: c.lon, src: 'coord' }];
      render();
      return;
    }
    const local = matchHarbors(o.getHarbors(), q).map((h) => ({
      name: h.name, sub: `경북 어항 · ${h.addr.replace('경상북도 ', '')}${h.dmin != null ? ` · 항내 ${h.dmin}~${h.dmax}m` : ''}`, lat: h.lat, lon: h.lon, src: 'harbor',
    }));
    items = local; render();
    if (q.length < 2) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const remote = await kakaoSearch(q, o.getCenter());
      if (my !== seq) return; // 그 사이 다시 입력함
      const seen = new Set(local.map((l) => norm(l.name)));
      items = local.concat(remote.filter((r) => !seen.has(norm(r.name)))).slice(0, 8);
      render();
      if (!items.length) { note.textContent = '검색 결과 없음 - 다른 이름이나 좌표로 넣어 보세요'; note.style.color = 'var(--amber)'; }
    }, 300);
  };

  input.addEventListener('input', () => { note.textContent = ''; run(); });
  input.addEventListener('focus', () => { if (input.value.trim()) run(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (items[0]) pick(items[0]); } });
  list.addEventListener('click', (e) => { const b = e.target.closest('.ps-item'); if (b) pick(items[+b.dataset.i]); });
  document.addEventListener('click', (e) => { if (!list.contains(e.target) && e.target !== input) close(); });

  return { clear: () => { input.value = ''; note.textContent = ''; close(); } };
}
