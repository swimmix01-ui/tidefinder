import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalToDMS, formatDMS, distanceBetween} from '../src/modules/geo.js';
import {validateDms} from '../src/modules/model.js';

test('DMS conversion preserves a map location within 0.25m and carries seconds at degree boundaries',()=>{
  const p={lat:36.023061728,lon:129.419444444};
  const lat=decimalToDMS(p.lat),lon=decimalToDMS(p.lon);
  const restored={lat:validateDms(lat.d,lat.m,lat.s,90,'위도'),lon:validateDms(lon.d,lon.m,lon.s,180,'경도')};
  assert.ok(distanceBetween(p.lat,p.lon,restored.lat,restored.lon)<0.25);
  assert.deepEqual(decimalToDMS(35+59/60+59.999/3600),{d:36,m:0,s:0});
  assert.equal(formatDMS(36.023061728,129.419444444),'36° 01′ 23.02″ N, 129° 25′ 10.00″ E');
  assert.match(formatDMS(-36,-129),/S, .*W$/);
});
