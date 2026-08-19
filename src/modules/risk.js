// ==========================================================================
// 고도화된 위험도(Risk) 산출 엔진 (100점 정규화 버전)
// ※ 주기(wavePeriod)·조위(tideLevel)는 아직 실시간 데이터 연동이 안 된 항목이라
//   값이 없으면 배점 자체를 제외하고, 확보된 항목들만으로 100점 만점 정규화한다.
// ==========================================================================
export function calculateAdvancedRisk(windSpdMS, waveHgtM, wavePeriod, tideLevel, hfSpdKnot, waterTemp) {
  let score = 0, maxScore = 0;

  maxScore += 20; // 1. 풍속 영향
  if (windSpdMS !== null && windSpdMS !== undefined) {
    if (windSpdMS >= 14) score += 20;
    else if (windSpdMS >= 10) score += 15;
    else if (windSpdMS >= 5) score += 10;
    else score += 5;
  }

  maxScore += 20; // 2. 파고 영향
  if (waveHgtM !== null && waveHgtM !== undefined) {
    if (waveHgtM >= 3.0) score += 20;
    else if (waveHgtM >= 1.5) score += 15;
    else if (waveHgtM >= 0.5) score += 10;
    else score += 5;
  }

  if (wavePeriod !== null && wavePeriod !== undefined) { // 3. 파주기 (미연동 시 배점 제외)
    maxScore += 10;
    if (wavePeriod >= 8) score += 10;
    else if (wavePeriod >= 5) score += 5;
  }

  if (tideLevel !== null && tideLevel !== undefined) { // 4. 조위 (미연동 시 배점 제외)
    maxScore += 10;
    score += 5;
  }

  if (hfSpdKnot !== null && hfSpdKnot !== undefined) { // 5. 유속(HF 실측) 영향
    maxScore += 20;
    if (hfSpdKnot >= 3.0) score += 20;
    else if (hfSpdKnot >= 2.0) score += 15;
    else if (hfSpdKnot >= 1.0) score += 10;
    else score += 5;
  }

  maxScore += 10; // 6. 수온 (저체온증 위험, 없으면 20도로 가정)
  const wTemp = waterTemp !== null && waterTemp !== undefined ? waterTemp : 20;
  if (wTemp <= 10) score += 10;
  else if (wTemp <= 15) score += 6;
  else score += 2;

  const normalized = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  let label = 'LOW', cls = 'low';
  if (normalized >= 75) { label = 'CRITICAL'; cls = 'veryhigh'; }
  else if (normalized >= 50) { label = 'HIGH'; cls = 'high'; }
  else if (normalized >= 30) { label = 'MEDIUM'; cls = 'medium'; }

  return { score: normalized, label, cls, rawScore: score, maxScore };
}
