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

export function renderAIAnalysisCard({ confidence, currentPct, windPct, windSpeedPct, wavePct, explain, risk, underwaterMode }) {
  document.getElementById('aiConfidence').textContent = `${confidence}%`;
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

export function renderSearchRecommendationCard({ startLat, startLon, combinedBearing, finalErrorRadius, finalPoint }) {
  const compassName = bearingToCompass(combinedBearing);
  const r1 = Math.round(finalErrorRadius * 0.5);
  const r2 = finalErrorRadius;

  document.getElementById('searchStart').textContent = formatDMS(startLat, startLon);
  document.getElementById('searchDir').textContent = `${combinedBearing.toFixed(0)}° (${compassName})`;
  document.getElementById('searchR1').textContent = `${r1}m`;
  document.getElementById('searchR2').textContent = `${r2}m`;
  document.getElementById('searchEnd').textContent = formatDMS(finalPoint.lat, finalPoint.lon);
  document.getElementById('searchOrder').innerHTML =
    `<b>추천 수색 순서</b><br>① 예측 종료점 중심 ${r1}m 우선 수색 → ② ${compassName} 방향(이동방향 전방) 확인 → ③ 좌우 확산 구역 포함 반경 ${r2}m 정밀 수색`;

  animateCardIn(document.getElementById('searchCard'));
}

export function refreshInputCheckmarks() {
  const val = (id) => document.getElementById(id).value !== '';
  const latOk = val('latD') && val('latM') && val('latS');
  const lonOk = val('lonD') && val('lonM') && val('lonS');
  document.getElementById('checkLat').classList.toggle('filled', latOk);
  document.getElementById('checkLon').classList.toggle('filled', lonOk);
  document.getElementById('checkDate').classList.toggle('filled', val('dateInput'));
  document.getElementById('checkTime').classList.toggle('filled', val('hourInput') && val('minuteInput'));
  document.getElementById('checkHours').classList.toggle('filled', val('hoursAhead'));
}
