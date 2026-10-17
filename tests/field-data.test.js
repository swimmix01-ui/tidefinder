import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, parseKmaTable } from '../netlify/functions/field-data.mjs';
const query=(mode,lat='36.023',lon='129.419')=>({queryStringParameters:{mode,lat,lon}});
test('new data routes reject invalid coordinates and expose missing key names without secrets',async()=>{
  const prior=process.env.KMA_AUTH_KEY;delete process.env.KMA_AUTH_KEY;
  try{assert.equal((await handler(query('kma','NaN'))).statusCode,400);const r=await handler(query('kma'));assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).configuration,'KMA_AUTH_KEY');assert.equal((await handler(query('arbitrary'))).statusCode,400);}finally{if(prior===undefined)delete process.env.KMA_AUTH_KEY;else process.env.KMA_AUTH_KEY=prior;}
});
test('KMA parser requires named fields and never guesses positions from an unknown header',()=>{
  const rows=parseKmaTable('# TM WS WH STN_ID WD\n202610171900 4.2 0.6 22106 180\n# footer',['TM','WS','WH','STN_ID']);
  assert.equal(rows[0].WS,'4.2');assert.equal(rows[0].STN_ID,'22106');assert.throws(()=>parseKmaTable('202610171900 4.2 0.6 22106 180',['STN_ID']),/형식/);
  assert.deepEqual(parseKmaTable('# STN_ID TM WS\n22106 unexpected name 4',['STN_ID','TM','WS']),[]);
});
test('KMA schema fixtures join coordinates, preserve missing values, and do not leak the auth key',async()=>{
  const prior=process.env.KMA_AUTH_KEY, old=globalThis.fetch;process.env.KMA_AUTH_KEY='fixture-only-not-a-real-key';
  const tm=new Date(Date.now()+9*3600000).toISOString().slice(0,16).replace(/[-T:]/g,'');
  globalThis.fetch=async url=>new Response(String(url).includes('stn_inf.php')?'# STN_ID LAT LON STN_KO\n22106 36.3 129.7 포항':`# TP STN_ID STN_KO TM WH WD WS WS_GST TW TA PA HM\nBUOY 22106 포항 ${tm} 0.5 270 4.2 -99 22 20 1025 80`);
  try{const r=await handler(query('kma','36.024'));assert.equal(r.statusCode,200);const d=JSON.parse(r.body);assert.equal(d.records[0].lat,36.3);assert.equal(d.records[0].windMS,4.2);assert.equal(d.records[0].gustMS,null);assert.ok(!r.body.includes('fixture-only-not-a-real-key'));}finally{globalThis.fetch=old;if(prior===undefined)delete process.env.KMA_AUTH_KEY;else process.env.KMA_AUTH_KEY=prior;}
});
test('bathymetry stays a raw 150m reference with an unverified datum and refuses incomplete results',async()=>{
  const prior=process.env.SERVICE_KEY, old=globalThis.fetch;process.env.SERVICE_KEY='fixture-key';
  let count=1;globalThis.fetch=async url=>{const u=new URL(url);assert.equal(u.pathname,'/1192136/waterDepth/GetWaterDepthApiService');assert.equal(u.searchParams.get('numOfRows'),'300');return new Response(JSON.stringify({header:{resultCode:'00'},body:{totalCount:count,items:{item:[{lat:36.02,lot:129.42,dpwt:12}]}}}));};
  try{const r=await handler(query('bathymetry','36.025'));assert.equal(r.statusCode,200);const d=JSON.parse(r.body);assert.equal(d.resolutionM,150);assert.equal(d.verticalDatum,'미검증');assert.equal(d.points[0].rawDepth,12);assert.equal(d.points[0].depthM,undefined);count=400;assert.equal((await handler(query('bathymetry','36.026'))).statusCode,502);}finally{globalThis.fetch=old;if(prior===undefined)delete process.env.SERVICE_KEY;else process.env.SERVICE_KEY=prior;}
});
