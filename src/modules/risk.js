// Internal screening index; not an official warning, survival estimate or entry decision.
import { finite } from "./model.js";
export function calculateAdvancedRisk(
  wind,
  wave,
  period,
  tide,
  currentKn,
  waterTemp,
) {
  const missing = [];
  if (!finite(wind)) missing.push("풍속");
  if (!finite(wave)) missing.push("파고");
  if (!finite(currentKn)) missing.push("유속");
  if (!finite(waterTemp)) missing.push("수온");
  if (!finite(wind) || !finite(wave))
    return { score: null, label: "평가 불가", cls: "unknown", missing };
  let score = 0,
    maxScore = 0;
  const add = (weight, value) => {
    maxScore += weight;
    score += value;
  };
  add(20, wind >= 14 ? 20 : wind >= 10 ? 15 : wind >= 5 ? 10 : 5);
  add(20, wave >= 3 ? 20 : wave >= 1.5 ? 15 : wave >= 0.5 ? 10 : 5);
  if (finite(period)) add(10, period >= 8 ? 10 : period >= 5 ? 5 : 0);
  if (finite(currentKn))
    add(
      20,
      currentKn >= 3 ? 20 : currentKn >= 2 ? 15 : currentKn >= 1 ? 10 : 5,
    );
  if (finite(waterTemp))
    add(10, waterTemp <= 10 ? 10 : waterTemp <= 15 ? 6 : 2);
  const value = Math.round((score / maxScore) * 100);
  return {
    score: value,
    label:
      value >= 75
        ? "매우 높음"
        : value >= 50
          ? "높음"
          : value >= 30
            ? "보통"
            : "낮음",
    cls:
      value >= 75
        ? "veryhigh"
        : value >= 50
          ? "high"
          : value >= 30
            ? "medium"
            : "low",
    missing,
    rawScore: score,
    maxScore,
  };
}
