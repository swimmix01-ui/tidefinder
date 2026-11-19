// ==========================================================================
// DOM 조작 전담 모듈
// ※ "화면에 뭘 표시할지"만 담당한다. 데이터를 어떻게 계산할지는 이 파일의
//   책임이 아니다 - predict.js가 계산한 결과를 인자로 받아서 그리기만 한다.
// ==========================================================================
import { bearingToCompass, formatDMS } from './geo.js';

export function setStatus(kind, text) {
  const el = document.getElementById('status');
  el.className = kind;
  el.textContent = text;
}

export function showLoading(text) {
  const ov = document.getElementById('loadingOverlay');
  const t = document.getElementById('loadingText');
  ov.classList.add('show');
  t.style.opacity = '0';
  setTimeout(() => { t.textContent = text; t.style.opacity = '1'; }, 120);
}

export function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

export function animateCardIn(el) {
  el.style.display = 'block';
  el.classList.remove('fade-in');
  void el.offsetWidth;
  el.classList.add('fade-in');
}

export function animateProgressBar(el, targetPct) {
  el.style.width = '0%';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { el.style.width = `${Math.max(0, Math.min(100, targetPct))}%`; });
  });
}

export function renderFreshness(obsDtStr) {
  const el = document.getElementById('marineFreshness');
  if (!obsDtStr) { el.textContent = '확인불가'; return; }
  const parsed = new Date(obsDtStr.replace(' ', 'T'));
  if (isNaN(parsed.getTime())) { el.textContent = '확인불가'; return; }
  const diffMin = Math.round((Date.now() - parsed.getTime()) / 60000);
  if (diffMin < 0) { el.textContent = '실시간'; return; }
  if (diffMin <= 90) el.textContent = `🟢 ${diffMin}분 전 갱신`;
  else if (diffMin <= 360) el.textContent = `🟡 ${Math.round(diffMin / 60)}시간 전 갱신`;
  else el.textContent = `🔴 갱신 지연 (${Math.round(diffMin / 60)}시간+)`;
}

export function renderWaveStatusPill(waveHeightM) {
  const el = document.getElementById('waveStatusPill');
  if (waveHeightM === null || waveHeightM === undefined) { el.innerHTML = ''; return; }
  let cls = 'good', label = '양호';
  if (waveHeightM >= 1.5) { cls = 'warn'; label = '경보'; }
  else if (waveHeightM >= 0.7) { cls = 'caution'; label = '주의'; }
  el.innerHTML = `<span class="status-pill ${cls}">${label}</span>`;
}

export function renderWindStatusPill(windSpeedMS) {
  const el = document.getElementById('windStatusPill');
  if (windSpeedMS === null || windSpeedMS === undefined) { el.innerHTML = ''; return; }
  let cls = 'good', label = '약함';
  if (windSpeedMS >= 10) { cls = 'warn'; label = '강함'; }
  else if (windSpeedMS >= 5) { cls = 'caution'; label = '보통'; }
  el.innerHTML = `<span class="status-pill ${cls}">${label}</span>`;
}

// 풍랑/강풍/태풍 등 해상 특보가 발효 중이면, 숫자만 보고 계산된 "양호/보통" 배지가
// 반대로 안심시키는 걸 막기 위해 파고·풍속 배지를 무조건 경고 상태로 덮어쓴다.
// (파고·풍속 수치 자체는 신뢰도가 낮을 수 있어도, 특보 발효 여부는 기상청이 확정한 사실이다)
export function forceAlertPills() {
  const waveEl = document.getElementById('waveStatusPill');
  const windEl = document.getElementById('windStatusPill');
  const warnHtml = `<span class="status-pill warn">⚠ 특보중</span>`;
  if (waveEl) waveEl.innerHTML = warnHtml;
  if (windEl) windEl.innerHTML = warnHtml;
}

export function renderAIAnalysisCard({ confidence, currentPct, windPct, windSpeedPct, wavePct, explain, risk, underwaterMode }) {
  document.getElementById('aiConfidence').textContent = `${confidence.score}% · ${confidence.label}`;
  const noteEl = document.getElementById('aiConfidenceNote');
  if (noteEl) noteEl.innerHTML = confidence.reasons.map((r) => `<li>${r}</li>`).join('');
  document.getElementById('factorCurrentPct').textContent = `${currentPct}%`;
  document.getElementById('factorWindPct').textContent = underwaterMode ? '해당없음' : `${windPct}%`;
  document.getElementById('factorWindSpeedPct').textContent = underwaterMode ? '해당없음' : `${windSpeedPct}%`;
  document.getElementById('factorWavePct').textContent = `${wavePct}%`;

  animateProgressBar(document.getElementById('factorCurrentBar'), currentPct);
  animateProgressBar(document.getElementById('factorWindBar'), windPct);
  animateProgressBar(document.getElementById('factorWindSpeedBar'), windSpeedPct);
  animateProgressBar(document.getElementById('factorWaveBar'), wavePct);

  document.getElementById('aiExplain').textContent = explain;

  const badge = document.getElementById('riskBadge');
  badge.className = `risk-badge ${risk.cls}`;
  badge.textContent = `위험도: ${risk.label} (${risk.score}점)`;

  animateCardIn(document.getElementById('aiCard'));
}

// 수색 권고 카드. 몬테카를로 구역이 있으면 그걸 기준으로(1차 50%, 2차 90%),
// 없으면 예전처럼 오차반경 원 기준으로 안내한다.
const fmtKm2 = (v) => (v === null || v === undefined ? '-' : v < 1 ? `${(v * 100).toFixed(0)}ha (${v.toFixed(2)}km²)` : `${v.toFixed(1)}km²`);
// 같은 면적의 정사각형 한 변 - "대략 몇 km 사방"인지 감 잡기용
const sideKm = (v) => (v ? Math.sqrt(v).toFixed(1) : '-');

export function renderSearchRecommendationCard({ startLat, startLon, combinedBearing, finalErrorRadius, finalPoint, regions, actualHours, startDateTime }) {
  const compassName = bearingToCompass(combinedBearing);
  const endTime = startDateTime ? new Date(startDateTime.getTime() + actualHours * 3600000) : null;
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const timeTxt = endTime ? ` (${hhmm(endTime)} 기준)` : '';

  document.getElementById('searchStart').textContent = formatDMS(startLat, startLon);
  document.getElementById('searchDir').textContent = `${combinedBearing.toFixed(0)}° (${compassName})`;

  if (regions) {
    document.getElementById('searchDatumLabel').textContent = `수색 기준점${timeTxt}`;
    document.getElementById('searchEnd').textContent = formatDMS(regions.center.lat, regions.center.lon);
    document.getElementById('searchR1Label').textContent = '1차 구역 (50%, 노랑)';
    document.getElementById('searchR1').textContent = `${fmtKm2(regions.area50Km2)} · 약 ${sideKm(regions.area50Km2)}km 사방`;
    document.getElementById('searchR2Label').textContent = '2차 구역 (90%, 빨강)';
    document.getElementById('searchR2').textContent = `${fmtKm2(regions.area90Km2)} · 약 ${sideKm(regions.area90Km2)}km 사방`;
    const strandTxt = regions.strandedPct >= 5 ? `<br>⚠ 시뮬레이션 입자의 <b>${regions.strandedPct}%</b>가 해안에 닿음 → 인근 해안·갯바위 수색 병행` : '';
    document.getElementById('searchOrder').innerHTML =
      `<b>추천 수색 순서</b><br>① 수색 기준점에서 시작해 <b>노란 구역(50%)</b> 우선 수색 → ② 못 찾으면 <b>빨간 구역(90%)</b>으로 확대 → ③ 시간이 지날수록 구역이 ${compassName} 쪽으로 이동하므로 예측을 다시 돌려 갱신${strandTxt}` +
      `<div style="font-size:11.5px;margin-top:6px;opacity:.85">50%·90%는 조류·바람 예보 오차를 가정해 1,000번 돌린 결과 중 그 비율이 들어간 범위입니다(실측 보정 전 추정치).</div>`;
  } else {
    const r1 = Math.round(finalErrorRadius * 0.5);
    document.getElementById('searchDatumLabel').textContent = `예상 도달 위치${timeTxt}`;
    document.getElementById('searchEnd').textContent = formatDMS(finalPoint.lat, finalPoint.lon);
    document.getElementById('searchR1Label').textContent = '1차 탐색 반경';
    document.getElementById('searchR1').textContent = `${r1}m`;
    document.getElementById('searchR2Label').textContent = '2차 탐색 반경';
    document.getElementById('searchR2').textContent = `${finalErrorRadius}m`;
    document.getElementById('searchOrder').innerHTML =
      `<b>추천 수색 순서</b><br>① 예측 종료점 중심 ${r1}m 우선 수색 → ② ${compassName} 방향(이동방향 전방) 확인 → ③ 반경 ${finalErrorRadius}m 정밀 수색`;
  }
  animateCardIn(document.getElementById('searchCard'));
}

// "예측 결과 요약" 카드 - 상황 보고서 복사 버튼이 이 카드 안에 있으므로,
// 이 카드가 표시돼야 그 버튼도 화면에 나타난다.
// 1kn = 1852m/h = 51.4444cm/s
const MS_PER_KNOT_HOUR = 1852; // m/h
const CMS_PER_KNOT = 51.4444; // cm/s

export function renderResultCard({ curSpeed, curDir, netDistM, alongM, actualHours, combSpeed, finalErrorRadius, finalPoint }) {
  const curSpeedKn = curSpeed / CMS_PER_KNOT;
  const combSpeedKn = combSpeed / MS_PER_KNOT_HOUR;

  document.getElementById('statSpeed').textContent = `${curSpeedKn.toFixed(2)}kn (${curSpeed.toFixed(1)}cm/s)`;
  document.getElementById('statDir').textContent = `${bearingToCompass(curDir)} (${Math.round(curDir)}°)`;
  document.getElementById('statDist').textContent = `${Math.round(netDistM)}m`;
  document.getElementById('statHours').textContent = `${actualHours}시간`;
  document.getElementById('statAvgSpeed').textContent = `${combSpeedKn.toFixed(2)}kn`;
  document.getElementById('statErrorRadius').textContent = `${Math.round(finalErrorRadius)}m`;
  document.getElementById('driftSummary').innerHTML =
    `예측 종료 지점: <b>${formatDMS(finalPoint.lat, finalPoint.lon)}</b><br>` +
    `${actualHours}시간 동안 시작점에서 약 ${Math.round(netDistM)}m 이동` +
    (alongM && alongM > netDistM * 1.3 ? ` (실제로 떠다닌 거리는 약 ${Math.round(alongM)}m - 조류가 바뀌며 왕복)` : '') +
    `, 오차반경 ±${Math.round(finalErrorRadius)}m`;

  animateCardIn(document.getElementById('resultCard'));
}

export function refreshInputCheckmarks() {
  const val = (id) => document.getElementById(id).value !== '';
  const latOk = val('latD') && val('latM') && val('latS');
  const lonOk = val('lonD') && val('lonM') && val('lonS');
  document.getElementById('checkLat').classList.toggle('filled', latOk);
  document.getElementById('checkLon').classList.toggle('filled', lonOk);
  document.getElementById('checkTime').classList.toggle('filled', val('dateInput') && val('hourInput') && val('minuteInput'));
  document.getElementById('checkHours').classList.toggle('filled', val('hoursAhead'));
}
