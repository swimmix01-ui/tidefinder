import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountIntelligence, forecastClock } from '../src/modules/intelligence.js';
async function render(marineTime, weatherTime) {
  const dom=new JSDOM('<button id="loadContext"></button><button id="loadNavWarnings"></button><button id="loadRoms"></button><div id="contextStatus"></div><div id="contextValues"></div><div id="contextForecast"></div><div id="searchCard"></div>');
  const priorDocument=globalThis.document,priorFetch=globalThis.fetch;globalThis.document=dom.window.document;
  const fields={wave_height:[.88],wave_period:[4.25],swell_wave_height:[.48],swell_wave_period:[4.3],swell_wave_direction:[90],sea_surface_temperature:[21.5],ocean_current_velocity:[.5],ocean_current_direction:[0],sea_level_height_msl:[-.01],visibility:[28940],wind_gusts_10m:[9.1],precipitation:[0]};
  const model=time=>({latitude:36,longitude:129,hourly:{time:[time],...fields},hourly_units:{wave_height:'m',wave_period:'s'}});
  globalThis.fetch=async()=>new Response(JSON.stringify({fetchedAt:new Date().toISOString(),marine:model(marineTime),weather:model(weatherTime),errors:[]}));
  try {mountIntelligence(()=>({lat:36,lon:129}));document.getElementById('loadContext').click();for(let i=0;i<100&&!document.getElementById('contextStatus').textContent.includes('수신 완료');i++)await new Promise(r=>setTimeout(r,5));assert.match(document.getElementById('contextStatus').textContent,/수신 완료/);return {headings:[...document.querySelectorAll('.context-time-heading')].map(v=>v.textContent),values:[...document.querySelectorAll('.stat-box .value')].map(v=>v.textContent)};}finally{globalThis.document=priorDocument;globalThis.fetch=priorFetch;dom.window.close();}
}
test('matching model times are printed once, with only numbers and units inside the twelve cards',async()=>{
  const time=Math.floor(Date.now()/1000),r=await render(time,time);
  assert.equal(r.headings.length,1);assert.match(r.headings[0],/기준/);assert.equal(r.values.length,12);assert.equal(r.values[0],'0.88 m');assert.ok(r.values.every(v=>!v.includes('/')&&!v.includes('KST')));
});
test('different model reference times remain separately visible when repeated dates are removed',async()=>{
  const time=Math.floor(Date.now()/1000),r=await render(time,time-1800);
  assert.ok(r.headings.some(v=>v.startsWith('해양모델')));assert.ok(r.headings.some(v=>v.startsWith('기상모델')));assert.ok(r.values.every(v=>!v.includes('KST')));
});
test('compact forecast rows retain the new date when crossing Korean midnight',()=>{
  const reference=Date.parse('2026-10-17T23:00:00+09:00');
  assert.equal(forecastClock(reference,reference),'23:00');assert.equal(forecastClock(Date.parse('2026-10-18T01:00:00+09:00'),reference),'10/18 01:00');
});
