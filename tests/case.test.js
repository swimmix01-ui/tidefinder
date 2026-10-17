import test from "node:test";
import assert from "node:assert/strict";
import {
  newCase,
  caseGeoJSON,
  operationReport,
  validateRecord,
} from "../src/modules/case.js";
test("exports carry method, source time and uncertainty limitations", () => {
  const c = newCase();
  c.searches.push({
    lat: 36,
    lon: 129,
    radius: 300,
    method: "드론",
    result: "미발견",
    time: "2026-10-17T00:00Z",
  });
  const geo = caseGeoJSON(c);
  assert.equal(geo.features[0].geometry.type, "Polygon");
  assert.equal(geo.features[0].properties.method, "드론");
  assert.ok(
    operationReport(c, null).includes("확률을 자동으로 낮추지 않습니다"),
  );
  assert.throws(() => validateRecord("", 129, "2026-10-17T00:00Z"));
});
