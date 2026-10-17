import test from "node:test";
import assert from "node:assert/strict";
import {
  parseKst,
  kstParts,
  validateDms,
  validateInput,
  nearestForecast,
  vectorShares,
  uncertaintyRadius,
  interpolatePath,
  errorAtObservation,
} from "../src/modules/model.js";
import { decimalToDMS, findCoastlineIntersection } from "../src/modules/geo.js";
import { calculateAdvancedRisk } from "../src/modules/risk.js";
const base = () => ({
  lat: 36,
  lon: 129,
  ahead: 6,
  startDateTime: new Date(Date.now() - 3600000),
  leewayCoefVal: 0.027,
});
test("Korean operational time is independent of process timezone", () => {
  assert.equal(
    parseKst("2026-10-17T15:00").toISOString(),
    "2026-10-17T06:00:00.000Z",
  );
  assert.equal(
    parseKst("20261017150000").toISOString(),
    "2026-10-17T06:00:00.000Z",
  );
  assert.equal(kstParts(new Date("2026-10-16T23:30Z")).date, "2026-10-17");
});
test("DMS rejects blanks, minutes 60 and pole overflow", () => {
  for (const v of [
    ["", 0, 0, 90],
    [36, 60, 0, 90],
    [90, 0, 1, 90],
    [36, 1, 60, 90],
  ])
    assert.throws(() => validateDms(...v, "위도"));
  assert.equal(validateDms(36, 30, 0, 90, "위도"), 36.5);
  assert.deepEqual(decimalToDMS(36 + 59 / 60 + 59.999 / 3600), {
    d: 37,
    m: 0,
    s: 0,
  });
});
test("input rejects zero/fractional horizons, future origin and nonfinite manual values", () => {
  for (const v of [
    { ahead: 0 },
    { ahead: 1.5 },
    { ahead: 25 },
    { lat: NaN },
    { startDateTime: new Date(Date.now() + 120000) },
    { manualCurrent: { speed: NaN, dir: 20 } },
    { manualWind: { speed: 5, dir: 360 } },
  ])
    assert.throws(() => validateInput({ ...base(), ...v }));
  assert.doesNotThrow(() => validateInput(base()));
});
test("forecasts outside one hour and null/sentinel values are not silently reused", () => {
  const items = [
    { category: "WSD", fcstDate: "20261017", fcstTime: "1500", fcstValue: "3" },
  ];
  assert.equal(
    nearestForecast(items, "WSD", parseKst("2026-10-17T15:30")).value,
    3,
  );
  assert.equal(
    nearestForecast(items, "WSD", parseKst("2026-10-15T15:30")),
    null,
  );
  assert.equal(
    nearestForecast(
      [{ ...items[0], fcstValue: null }],
      "WSD",
      parseKst("2026-10-17T15:00"),
    ),
    null,
  );
});
test("magnitude shares remain normalized and expose opposing-flow cancellation", () => {
  const r = vectorShares({ x: 100, y: 0 }, { x: 200, y: 0 });
  assert.deepEqual([r.currentPct, r.windPct], [33, 67]);
  const v = vectorShares({ x: 100, y: 0 }, { x: -100, y: 0 });
  assert.equal(v.cancellation, 1);
  assert.equal(v.currentPct + v.windPct, 100);
});
test("unknown weather cannot be classified LOW and missing temperature is not invented", () => {
  assert.equal(
    calculateAdvancedRisk(null, null, null, null, null, null).score,
    null,
  );
  const r = calculateAdvancedRisk(3, 0.4, null, null, null, null);
  assert.equal(r.maxScore, 40);
  assert.ok(r.missing.includes("수온"));
});
test("uncertainty grows with travel even when net displacement returns to origin", () => {
  assert.ok(uncertaintyRadius(2000, 0, 2, 0) > uncertaintyRadius(0, 0, 2, 0));
});
test("coastline detects a crossing and chooses the first barrier", () => {
  const data = {
    features: [
      {
        geometry: {
          coordinates: [
            [129.02, 35.9],
            [129.02, 36.1],
          ],
        },
      },
      {
        geometry: {
          coordinates: [
            [129.01, 35.9],
            [129.01, 36.1],
          ],
        },
      },
    ],
  };
  assert.ok(
    Math.abs(
      findCoastlineIntersection(36, 129, 36, 129.03, data).lon - 129.01,
    ) < 1e-8,
  );
});
test("timeline and validation refuse extrapolation beyond available prediction", () => {
  const r = {
    samples: [
      { lat: 36, lon: 129, time: "2026-10-17T00:00Z", radius: 100 },
      { lat: 36, lon: 129.02, time: "2026-10-17T01:00Z", radius: 300 },
    ],
  };
  assert.equal(interpolatePath(r, "2026-10-17T02:00Z"), null);
  assert.equal(interpolatePath(r, "2026-10-17T00:30Z").radius, 200);
  assert.equal(
    errorAtObservation(r, { lat: 36, lon: 129.01, time: "2026-10-17T00:30Z" })
      .errorM,
    0,
  );
});
test("invalid timestamps do not become an origin-position validation result", () => {
  assert.equal(
    interpolatePath(
      {
        samples: [
          { lat: 36, lon: 129, time: "2026-10-17T00:00Z", radius: 100 },
        ],
      },
      "invalid",
    ),
    null,
  );
});
test("negative missing-value sentinels are rejected for wave and wind", () => {
  for (const category of ["WAV", "WSD", "VEC"])
    assert.equal(
      nearestForecast(
        [
          {
            category,
            fcstValue: "-999",
            fcstDate: "20261017",
            fcstTime: "1500",
          },
        ],
        category,
        parseKst("2026-10-17T15:00"),
      ),
      null,
    );
});
