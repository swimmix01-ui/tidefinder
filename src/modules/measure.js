// ==========================================================================
// 지도 도구 "거리재기" - 지도를 차례로 누르면 구간·누적 거리(NM·km)와 방위를 표시
//  켜져 있는 동안엔 지도 클릭이 사고 좌표로 들어가지 않는다. 다시 누르면 끝내고 지운다.
// ==========================================================================
import { distanceBetween, bearingBetween } from './geo.js';

let map = null, active = false, pts = [], line = null, labels = [], noteEl = null;

const fmt = (m) => `${(m / 1852).toFixed(2)}NM (${m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(2) + 'km'})`;

function clearAll() {
  if (line) { line.setMap(null); line = null; }
  labels.forEach((l) => l.setMap(null));
  labels = []; pts = [];
}

export function initMeasure(kakaoMap, note) { map = kakaoMap; noteEl = note; }
export function isMeasuring() { return active; }

export function setMeasure(on) {
  active = on;
  clearAll();
  if (noteEl) noteEl.textContent = on ? '📏 거리재기: 지도를 차례로 누르세요 (다시 누르면 끝)' : '';
}

// 지도 클릭을 가져가면 true
export function handleMapClick(lat, lon) {
  if (!active || !map) return false;
  const p = new window.kakao.maps.LatLng(lat, lon);
  pts.push({ lat, lon });
  if (!line) {
    line = new window.kakao.maps.Polyline({ path: [p], strokeWeight: 3, strokeColor: '#F472B6', strokeOpacity: 0.95, strokeStyle: 'solid' });
    line.setMap(map);
  } else {
    line.setPath(pts.map((q) => new window.kakao.maps.LatLng(q.lat, q.lon)));
  }
  let html = '<div class="measure-label">시작</div>';
  if (pts.length > 1) {
    const a = pts[pts.length - 2];
    const seg = distanceBetween(a.lat, a.lon, lat, lon);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += distanceBetween(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    const brg = Math.round(bearingBetween(a.lat, a.lon, lat, lon));
    html = `<div class="measure-label">${String(brg).padStart(3, '0')}° · ${fmt(seg)}${pts.length > 2 ? `<br>누적 ${fmt(total)}` : ''}</div>`;
    if (noteEl) noteEl.textContent = `📏 누적 ${fmt(total)} · 마지막 구간 방위 ${String(brg).padStart(3, '0')}°`;
  }
  const ov = new window.kakao.maps.CustomOverlay({ position: p, content: html, yAnchor: 1.5, zIndex: 30 });
  ov.setMap(map);
  labels.push(ov);
  return true;
}
