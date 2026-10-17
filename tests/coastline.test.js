import test from "node:test";
import assert from "node:assert/strict";
import {
  loadCoastlineGeoJSON,
  getLocalCoastline,
  checkSegmentCrossesCoastline,
} from "../src/modules/coastline.js";
test("local coastline includes crossing segments even when first/middle/last vertices are outside", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [128, 34],
                [129, 36],
                [131, 34],
                [129, 38],
                [128, 34],
              ],
            },
          },
        ],
      }),
    );
  try {
    await loadCoastlineGeoJSON();
    const d = getLocalCoastline(36, 129, 1);
    assert.equal(d.features.length, 1);
    assert.ok(checkSegmentCrossesCoastline(36, 128.99, 36, 129.01, d));
  } finally {
    globalThis.fetch = old;
  }
});
