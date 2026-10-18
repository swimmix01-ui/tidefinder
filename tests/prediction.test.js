import test, { mock } from "node:test";
import assert from "node:assert/strict";
const calls = [];
let currentMode = "valid",
  windMode = "valid",
  coastLoaded = true;
const today = new Date();
today.setUTCMinutes(0, 0, 0);
const start = new Date(today.getTime() - 3600000);
const windItems = [];
for (let i = 0; i < 5; i++) {
  const d = new Date(start.getTime() + i * 3600000 + 9 * 3600000),
    date = d.toISOString().slice(0, 10).replaceAll("-", ""),
    time = d.toISOString().slice(11, 16).replace(":", "");
  for (const [category, fcstValue] of [
    ["WSD", "4"],
    ["VEC", "90"],
    ["WAV", ".4"],
  ])
    windItems.push({ category, fcstValue, fcstDate: date, fcstTime: time });
}
mock.module("../src/modules/map.js", {
  namedExports: { renderPredictionPath: () => {}, renderMonteCarloHull: () => {} },
});
mock.module("../src/modules/ui.js", {
  namedExports: {
    renderAIAnalysisCard: () => {},
    renderSearchRecommendationCard: () => {},
  },
});
mock.module("../src/modules/api.js", {
  namedExports: {
    fetchWindData: async () => ({
      items: windMode === "valid" ? windItems : [],
    }),
    fetchKhoaCurrentAt: async (time, lat, lon) => {
      calls.push({ time, lat, lon });
      return currentMode === "valid"
        ? {
            speed: 10,
            dir: 90,
            source: "test",
            time: time.toISOString(),
            distanceKm: 1,
          }
        : null;
    },
  },
});
mock.module("../src/modules/coastline.js", {
  namedExports: {
    ensureCoastlineReady: async () => {},
    getCoastlineStatus: () => ({ loaded: coastLoaded }),
    getLocalCoastline: () => null,
    checkSegmentCrossesCoastline: () => null,
    getLocalSetnets: () => [],
    findNearbySetnets: () => [],
  },
});
mock.module("../src/modules/montecarlo.js", {
  namedExports: {
    runMonteCarloSimulationWorker: async () => [],
    runMonteCarloSimulationFallback: async () => [],
    computeConvexHull: () => null,
  },
});
const { runPrediction } = await import("../src/predict.js");
const input = () => ({
  lat: 36,
  lon: 129,
  ahead: 2,
  startDateTime: start,
  leewayCoefVal: 0.027,
});
test("current queries follow the evolving path and midpoint times", async () => {
  calls.length = 0;
  const r = await runPrediction(input());
  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].lon, calls[0].lon);
  assert.equal(calls[0].time.getTime(), start.getTime() + 1800000);
  assert.equal(r.samples.length, 3);
  assert.equal(r.actualHours, 2);
});
test("missing currents stop prediction instead of applying default eastward current", async () => {
  currentMode = "missing";
  try {
    await assert.rejects(runPrediction(input()), /조류 자료가 없습니다/);
  } finally {
    currentMode = "valid";
  }
});
test("missing wind stops unless deliberately allowed and records a limitation", async () => {
  windMode = "missing";
  try {
    await assert.rejects(runPrediction(input()), /바람 자료가 없습니다/);
    const r = await runPrediction({ ...input(), allowCurrentOnly: true });
    assert.ok(r.windMissing);
    assert.ok(r.warnings.some((v) => v.includes("바람 미반영")));
  } finally {
    windMode = "valid";
  }
});
test("coastline failure requires deliberate override", async () => {
  coastLoaded = false;
  try {
    await assert.rejects(runPrediction(input()), /해안선 자료/);
    const r = await runPrediction({ ...input(), allowNoCoastline: true });
    assert.ok(r.warnings.some((v) => v.includes("해안선 미적용")));
  } finally {
    coastLoaded = true;
  }
});
test("manual underwater scenario needs no external current or wind", async () => {
  currentMode = "missing";
  windMode = "missing";
  try {
    const r = await runPrediction({
      ...input(),
      leewayCoefVal: 0,
      manualCurrent: { speed: 10, dir: 90 },
    });
    assert.ok(r.manual);
    assert.equal(r.risk.score, null);
    assert.ok(r.warnings.some((v) => v.includes("수중 실종")));
  } finally {
    currentMode = "valid";
    windMode = "valid";
  }
});
