import test from "node:test";
import assert from "node:assert/strict";
import { handler as weather } from "../netlify/functions/weather.js";
import { handler as context } from "../netlify/functions/field-context.mjs";
test("no embedded keys: server reports configuration missing without calling upstream", async () => {
  const old = { ...process.env };
  delete process.env.SERVICE_KEY;
  delete process.env.TW_SERVICE_KEY;
  delete process.env.KHOA_SERVICE_KEY;
  try {
    const r = await weather({ queryStringParameters: { mode: "hfcurrent" } });
    assert.equal(r.statusCode, 503);
    assert.equal(JSON.parse(r.body).configuration, "SERVICE_KEY");
  } finally {
    Object.assign(process.env, old);
  }
});
test("query injection is rejected before any upstream request", async () => {
  const old = process.env.SERVICE_KEY;
  process.env.SERVICE_KEY = "test";
  try {
    const r = await weather({
      queryStringParameters: { mode: "fcst", nx: "1&serviceKey=other" },
    });
    assert.equal(r.statusCode, 400);
  } finally {
    if (old === undefined) delete process.env.SERVICE_KEY;
    else process.env.SERVICE_KEY = old;
  }
});
test("public supplementary endpoint rejects invalid coordinates", async () => {
  assert.equal(
    (await context({ queryStringParameters: { lat: "999", lon: "129" } }))
      .statusCode,
    400,
  );
});
test("supplementary endpoint preserves partial failure and numerical model timestamps", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("marine-api")
      ? new Response("{}", { status: 503 })
      : new Response(
          JSON.stringify({
            hourly: { time: [1], visibility: [1000] },
            daily: { time: [1], sunrise: [1], sunset: [2] },
          }),
        );
  try {
    const r = await context({
        queryStringParameters: { lat: "36", lon: "129" },
      }),
      d = JSON.parse(r.body);
    assert.equal(r.statusCode, 200);
    assert.equal(d.marine, null);
    assert.equal(d.errors.length, 1);
    assert.equal(d.weather.hourly.time[0], 1);
  } finally {
    globalThis.fetch = old;
  }
});
