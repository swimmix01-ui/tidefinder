import test from 'node:test';
import assert from 'node:assert/strict';
import { latestMeasurement, measurement, observationQuality } from '../src/modules/observations.js';
import { extractItems, fetchMarineWeatherData, fetchTwRecent, fetchSeaFogData } from '../src/modules/api.js';
const now = +new Date('2026-10-17T10:10:00Z');
test('latest usable observation is independent of response order and rejects sentinels/future timestamps',()=>{
  const sample=[{obsrvnDt:'2026-10-17 00:00',wspd:2},{obsrvnDt:'2026-10-17 19:00',wspd:5},{obsrvnDt:'2026-10-17 19:05',wspd:-99},{obsrvnDt:'2026-10-18 00:00',wspd:8}];
  assert.equal(latestMeasurement(sample,['wspd'],0,100,now).wspd,5);
  assert.equal(measurement({v:'  '},['v'],0,100),null);
  assert.equal(latestMeasurement([{obsrvnDt:'invalid',wspd:3}],['wspd'],0,100,now),null);
});
test('distance uses the actual returned coordinate and reports stale remote measurements',()=>{
  const item={lat:36.58,lot:129.45408,obsrvnDt:'2026-10-17 16:00'};
  const q=observationQuality(item,{lat:36.03,lon:129.38},{lat:36.023,lon:129.419},now);
  assert.ok(q.distanceKm>60 && q.distanceKm<65);
  assert.equal(q.location.approximate,false);
  assert.ok(q.flags.includes('30km 초과 · 원거리 참고'));
  assert.ok(q.flags.includes('90분 초과 · 과거 관측'));
});
test('HTTP 200 observation errors and incomplete series cannot pass as current valid data',()=>{
  assert.throws(()=>extractItems({header:{resultCode:'40'},body:{}}),/일시 이용 불가/);
  assert.throws(()=>extractItems({header:{resultCode:'00'},body:{totalCount:98,items:{item:Array(10).fill({})}}}),/일부 표본/);
  assert.deepEqual(extractItems({header:{resultCode:'00'},body:{totalCount:1,items:{item:{wspd:3}}}}),[{wspd:3}]);
});
test('one failed weather measurement does not remove other received measurements; TW series is preserved',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url).includes('mode=airtemp'))throw new Error('기온 장애');
    const item=String(url).includes('mode=twrecent')?[{wspd:1},{wspd:5}]:[{wtem:22,atmpr:1025}];
    return new Response(JSON.stringify({header:{resultCode:'00'},body:{totalCount:item.length,items:{item}}}));
  };
  try {
    const r=await fetchMarineWeatherData('DT_0091','20261017');
    assert.equal(r.water[0].wtem,22);assert.equal(r.press[0].atmpr,1025);assert.match(r.errors.air,/기온 장애/);
    assert.equal((await fetchTwRecent('TW_0095','20261017')).length,2);
  }finally{globalThis.fetch=old;}
});

test('visibility pagination respects provider row limits and collects the full series',async()=>{
  const old=globalThis.fetch, seen=[];
  globalThis.fetch=async url=>{
    const page=Number(new URL(String(url),'http://test').searchParams.get('pageNo')); seen.push(page);
    const item=Array.from({length:page===3?5:100},(_,i)=>({obsrvnDt:'2026-10-17 19:05',dtvsbV20kLen:10000,index:(page-1)*100+i}));
    return new Response(JSON.stringify({header:{resultCode:'00'},body:{totalCount:205,numOfRows:100,pageNo:page,items:{item}}}));
  };
  try{const items=await fetchSeaFogData('SF_0011','20261017');assert.equal(items.length,205);assert.deepEqual(seen.sort(),[1,2,3]);}finally{globalThis.fetch=old;}
});
