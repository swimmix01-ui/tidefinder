import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
const waitUntil = async (fn) => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("UI state timeout");
};
test("field workflow: marine dashboard, CCTV, prediction timeline without record UI or storage", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "http://localhost:5173",
    pretendToBeVisual: true,
  });
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "Element",
    "SVGElement",
    "DOMParser",
    "localStorage",
  ])
    globalThis[key] =
      key === "window"
        ? dom.window
        : key === "document"
          ? dom.window.document
          : dom.window[key];
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  dom.window.SVGSVGElement.prototype.createSVGRect = () => ({});
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.fetch = async (url) => {
    if (String(url).includes("coastline-korea"))
      return new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [120, 20],
                  [121, 21],
                ],
              },
              properties: {},
            },
          ],
        }),
      );
    if (String(url).includes("setnet-korea"))
      return new Response('{"type":"FeatureCollection","features":[]}');
    return new Response('{"error":"test unavailable"}', { status: 503 });
  };
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.ssrLoadModule("/src/main.js");
    const $ = (id) => document.getElementById(id);
    await waitUntil(() => $("view-scene") || $("status").textContent.includes("초기화 오류"));
    assert.ok($("view-scene"),$("status").textContent);
    assert.equal($("runPredictionBtn").closest("#inputCard")?.id, "inputCard");
    assert.equal(
      new Set([...document.querySelectorAll("[id]")].map((n) => n.id)).size,
      document.querySelectorAll("[id]").length,
      "IDs must be unique",
    );
    const tabs=[...document.querySelectorAll('.workspace-tabs button')];
    assert.equal(tabs.length,3);
    assert.deepEqual(tabs.map(t=>t.textContent),["해상정보","표류예측","자료안내"]);
    assert.equal($("operationsCard"),null);
    assert.equal($("view-records"),null);
    const mapNode=$("map");
    assert.equal($("cctvCard").closest("#view-scene")?.id,"view-scene");
    assert.equal(document.querySelector(".map-panel").nextElementSibling,$("cctvCard"));
    assert.equal($("cctvCard").querySelectorAll('a[target="_blank"]').length,4);
    $("openCctv").click();
    assert.equal(document.activeElement,$("cctvTitle"));
    assert.equal($("showOpenSeaMap").checked, false);
    assert.match($("chartStatus").textContent,/꺼짐/);
    $("showOpenSeaMap").checked=true;$("showOpenSeaMap").dispatchEvent(new dom.window.Event("change"));
    assert.match($("chartStatus").textContent,/수신 중/);
    assert.equal($("map"),mapNode);
    const chartTile=document.querySelector('.leaflet-seamarks-pane img');
    assert.ok(chartTile,"The optional seamark layer must request image tiles");
    chartTile.dispatchEvent(new dom.window.Event("error"));
    assert.match($("chartStatus").textContent,/미수신/);
    $("showOpenSeaMap").checked=false;$("showOpenSeaMap").dispatchEvent(new dom.window.Event("change"));
    assert.match($("chartStatus").textContent,/꺼짐/);
    tabs[2].click();assert.equal($("view-sources").hidden,false);assert.equal(document.querySelectorAll('.source-row').length,20);
    const filter=document.querySelector('input[type="search"]');filter.value='자연과학';filter.dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.querySelectorAll('.source-row').length,1);
    tabs[1].click();assert.equal($("view-plan").hidden,false);assert.equal($("status").closest('.workspace-panel'),null);
    tabs[0].click();assert.equal($("map"),mapNode);assert.equal($("view-scene").hidden,false);
    $("manualCurrentEnabled").checked = true;
    $("manualCurrentSpeed").value = "10";
    $("manualCurrentDir").value = "90";
    $("manualWindEnabled").checked = true;
    $("manualWindSpeed").value = "4";
    $("manualWindDir").value = "90";
    $("hoursAhead").value = "2";
    $("runPredictionBtn").click();
    try {
      await waitUntil(() => $("status").textContent.includes("예측 완료"));
    } catch (e) {
      throw new Error($("status").textContent);
    }
    assert.ok(!$("timelineCard").hidden);
    assert.ok($("sourceSummary").textContent.includes("현장 수동 입력"));
    assert.equal($("aiConfidence").textContent, "수동 가정 포함");
    $("showArrival").click();
    assert.ok($("timePosition").textContent.includes("추정 반경"));
    assert.equal(localStorage.getItem("tidefinder.case.v1"),null,"Prediction must not create case records");
    $("latS").dispatchEvent(new dom.window.Event("input"));
    assert.equal($("timelineCard").hidden,true,"Changing the incident location invalidates the timeline");
    $("hoursAhead").value = "0";
    $("runPredictionBtn").click();
    assert.ok($("status").textContent.includes("1~24"));
  } finally {
    await server.close();
    dom.window.close();
  }
});
