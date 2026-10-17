// ==========================================================================
// DOM 조작 전담 모듈
// ※ "화면에 뭘 표시할지"만 담당한다. 데이터를 어떻게 계산할지는 이 파일의
//   책임이 아니다 - predict.js가 계산한 결과를 인자로 받아서 그리기만 한다.
// ==========================================================================
import { bearingToCompass, formatDMS } from "./geo.js";
import { parseKst } from "./model.js";

export function setStatus(kind, text) {
  const el = document.getElementById("status");
  el.className = kind;
  el.textContent = text;
}

export function showLoading(text) {
  const ov = document.getElementById("loadingOverlay");
  const t = document.getElementById("loadingText");
  ov.classList.add("show");
  t.style.opacity = "0";
  setTimeout(() => {
    t.textContent = text;
    t.style.opacity = "1";
  }, 120);
}

export function hideLoading() {
  document.getElementById("loadingOverlay").classList.remove("show");
}

export function animateCardIn(el) {
  el.style.display = "block";
  el.classList.remove("fade-in");
  void el.offsetWidth;
  el.classList.add("fade-in");
}

export function animateProgressBar(el, targetPct) {
  el.style.width = "0%";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.width = `${Math.max(0, Math.min(100, targetPct))}%`;
    });
  });
}

export function renderFreshness(obsDtStr) {
  const el = document.getElementById("marineFreshness");
  if (!obsDtStr) {
    el.textContent = "확인불가";
    return;
  }
  const parsed = parseKst(obsDtStr);
  if (isNaN(parsed.getTime())) {
    el.textContent = "확인불가";
    return;
  }
  const diffMin = Math.round((Date.now() - parsed.getTime()) / 60000);
  if (diffMin < 0) {
    el.textContent = "관측시각이 미래입니다 — 확인 필요";
    return;
  }
  if (diffMin <= 90) el.textContent = `🟢 ${diffMin}분 전 갱신`;
  else if (diffMin <= 360)
    el.textContent = `🟡 ${Math.round(diffMin / 60)}시간 전 갱신`;
  else el.textContent = `🔴 갱신 지연 (${Math.round(diffMin / 60)}시간+)`;
}

export function renderWaveStatusPill(waveHeightM) {
  const el = document.getElementById("waveStatusPill");
  if (waveHeightM === null || waveHeightM === undefined) {
    el.innerHTML = "";
    return;
  }
  let cls = "good",
    label = "낮음 (파고 기준)";
  if (waveHeightM >= 1.5) {
    cls = "warn";
    label = "높음 (파고 기준)";
  } else if (waveHeightM >= 0.7) {
    cls = "caution";
    label = "상승 (파고 기준)";
  }
  el.innerHTML = `<span class="status-pill ${cls}">${label}</span>`;
}

export function renderWindStatusPill(windSpeedMS) {
  const el = document.getElementById("windStatusPill");
  if (windSpeedMS === null || windSpeedMS === undefined) {
    el.innerHTML = "";
    return;
  }
  let cls = "good",
    label = "약함";
  if (windSpeedMS >= 10) {
    cls = "warn";
    label = "강함";
  } else if (windSpeedMS >= 5) {
    cls = "caution";
    label = "보통";
  }
  el.innerHTML = `<span class="status-pill ${cls}">${label}</span>`;
}

// 풍랑/강풍/태풍 등 해상 특보가 발효 중이면, 숫자만 보고 계산된 "양호/보통" 배지가
// 반대로 안심시키는 걸 막기 위해 파고·풍속 배지를 무조건 경고 상태로 덮어쓴다.
// (파고·풍속 수치 자체는 신뢰도가 낮을 수 있어도, 특보 발효 여부는 기상청이 확정한 사실이다)
export function forceAlertPills() {
  const waveEl = document.getElementById("waveStatusPill");
  const windEl = document.getElementById("windStatusPill");
  const warnHtml = `<span class="status-pill warn">⚠ 특보중</span>`;
  if (waveEl) waveEl.innerHTML = warnHtml;
  if (windEl) windEl.innerHTML = warnHtml;
}

export function renderAIAnalysisCard({
  qualityLabel,
  currentPct,
  windPct,
  windSpeedPct,
  wavePct,
  explain,
  risk,
  underwaterMode,
}) {
  document.getElementById("aiConfidence").textContent = qualityLabel;
  document.getElementById("factorCurrentPct").textContent = `${currentPct}%`;
  document.getElementById("factorWindPct").textContent = underwaterMode
    ? "해당없음"
    : `${windPct}%`;
  document.getElementById("factorWindSpeedPct").textContent = underwaterMode
    ? "해당없음"
    : `${windSpeedPct}%`;
  document.getElementById("factorWavePct").textContent = `${wavePct}%`;

  animateProgressBar(document.getElementById("factorCurrentBar"), currentPct);
  animateProgressBar(document.getElementById("factorWindBar"), windPct);
  animateProgressBar(
    document.getElementById("factorWindSpeedBar"),
    windSpeedPct,
  );
  animateProgressBar(document.getElementById("factorWaveBar"), wavePct);

  document.getElementById("aiExplain").textContent = explain;

  const badge = document.getElementById("riskBadge");
  badge.className = `risk-badge ${risk.cls}`;
  badge.textContent = `해황 참고지수: ${risk.label}${risk.score === null ? "" : ` (${risk.score}점, 일부 항목)`}`;

  animateCardIn(document.getElementById("aiCard"));
}

export function renderSearchRecommendationCard({
  startLat,
  startLon,
  combinedBearing,
  finalErrorRadius,
  finalPoint,
}) {
  const compassName = bearingToCompass(combinedBearing);
  const r1 = Math.round(finalErrorRadius * 0.5);
  const r2 = finalErrorRadius;

  document.getElementById("searchStart").textContent = formatDMS(
    finalPoint.lat,
    finalPoint.lon,
  );
  document.getElementById("searchDir").textContent =
    `${combinedBearing.toFixed(0)}° (${compassName})`;
  document.getElementById("searchR1").textContent = `${r1}m`;
  document.getElementById("searchR2").textContent = `${r2}m`;
  document.getElementById("searchEnd").textContent = formatDMS(
    finalPoint.lat,
    finalPoint.lon,
  );
  document.getElementById("searchOrder").innerHTML =
    `<b>추천 수색 순서</b><br>선택한 예측 종료시각의 중심 위치 기준입니다. 안쪽 ${r1}m와 바깥 ${r2}m는 참고 범위이며 우선 발견 확률을 뜻하지 않습니다. 현재·도착 시각은 시간 선택에서 확인하고, 현장 지휘와 수색 이력을 함께 반영하세요.`;

  animateCardIn(document.getElementById("searchCard"));
}

// "예측 결과 요약" 카드 - 상황 보고서 복사 버튼이 이 카드 안에 있으므로,
// 이 카드가 표시돼야 그 버튼도 화면에 나타난다.
// 1kn = 1852m/h = 51.4444cm/s
const MS_PER_KNOT_HOUR = 1852; // m/h
const CMS_PER_KNOT = 51.4444; // cm/s

export function renderResultCard({
  curSpeed,
  curDir,
  netDistM,
  actualHours,
  combSpeed,
  finalErrorRadius,
  finalPoint,
}) {
  const curSpeedKn = curSpeed / CMS_PER_KNOT;
  const combSpeedKn = combSpeed / MS_PER_KNOT_HOUR;

  document.getElementById("statSpeed").textContent =
    `${curSpeedKn.toFixed(2)}kn (${curSpeed.toFixed(1)}cm/s)`;
  document.getElementById("statDir").textContent =
    `${bearingToCompass(curDir)} (${Math.round(curDir)}°)`;
  document.getElementById("statDist").textContent = `${Math.round(netDistM)}m`;
  document.getElementById("statHours").textContent =
    `${actualHours.toFixed(2)}시간`;
  document.getElementById("statAvgSpeed").textContent =
    `${combSpeedKn.toFixed(2)}kn`;
  document.getElementById("statErrorRadius").textContent =
    `${Math.round(finalErrorRadius)}m`;
  document.getElementById("driftSummary").innerHTML =
    `예측 종료 지점: <b>${formatDMS(finalPoint.lat, finalPoint.lon)}</b><br>` +
    `${actualHours.toFixed(2)}시간 동안 약 ${Math.round(netDistM)}m 이동 (평균 ${combSpeedKn.toFixed(2)}kn), 추정 확산반경 ${Math.round(finalErrorRadius)}m`;

  animateCardIn(document.getElementById("resultCard"));
}

export function refreshInputCheckmarks() {
  const val = (id) => document.getElementById(id).value !== "";
  const latOk = val("latD") && val("latM") && val("latS");
  const lonOk = val("lonD") && val("lonM") && val("lonS");
  document.getElementById("checkLat").classList.toggle("filled", latOk);
  document.getElementById("checkLon").classList.toggle("filled", lonOk);
  document
    .getElementById("checkDate")
    .classList.toggle("filled", val("dateInput"));
  document
    .getElementById("checkTime")
    .classList.toggle("filled", val("hourInput") && val("minuteInput"));
  document
    .getElementById("checkHours")
    .classList.toggle("filled", val("hoursAhead"));
}
