import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const now=new Date().toISOString();
const local={lat:36.03,lon:129.42,code:'22106',name:'포항',time:now,windMS:4.2,windFromDeg:180,significantWaveM:0.6,wavePeriodS:6};
let connected=false;
test.mock.module(new URL('../src/modules/map.js',import.meta.url).href,{namedExports:{renderObservationStations:()=>{},clearReferenceLayers:()=>{}}});
test.mock.module(new URL('../src/modules/api.js',import.meta.url).href,{namedExports:{
  fetchMarineWeatherData:async()=>({water:[],air:[],press:[]}),fetchDtRecent:async()=>[],
  fetchTwRecent:async()=>[{lat:36.58,lot:129.454,obsvtrNm:'고래불',obsrvnDt:now,wspd:9,wndrct:160,wvhgt:1.3}],
  fetchWindData:async()=>({items:[]}),fetchHfCurrentByStation:async()=>[{lat:36.03,lot:129.42,obsrvnDt:now,crdir:45,crsp:8}],
  fetchTideData:async()=>[],fetchSeaFogData:async()=>[],fetchAlertData:async()=>[],
  fetchWithTimeout:async url=>new Response(JSON.stringify({records:connected?[local]:[]}))
}});
const {loadMarineStatus,invalidateMarineStatus}=await import('../src/modules/marine.js');
test('remote wind and undefined wave stay in reference details; connected nearby KMA values replace them without reusing stale coordinates',async()=>{
  const ids=['marineWaterTemp','marineAirTemp','marineAirPress','marineWaveHeight','marineWind','marineVisibility','marineHfCurrent','marineNextTide','marineForecastWind','marineForecastWave','marineStationName','marineFreshness','marineObsTime','marineAlertBox','officialMarineStatus','kmaRegionalComparison'];
  const dom=new JSDOM(ids.map(id=>`<div id="${id}"></div>`).join('')+'<details id="marineReferenceDetails" hidden><ul id="marineReferenceList"></ul></details>');
  globalThis.document=dom.window.document;const $=id=>document.getElementById(id);
  try {
    await loadMarineStatus({lat:36.023,lon:129.419});
    assert.equal($('marineWind').querySelector('.reading').textContent,'미확보');assert.equal($('marineWind').dataset.briefAllowed,'false');
    assert.match($('marineReferenceList').textContent,/고래불/);assert.match($('marineReferenceList').textContent,/9 m\/s/);
    assert.equal($('marineWaveHeight').dataset.quality,'reference');assert.equal($('marineHfCurrent').dataset.briefAllowed,'true');
    connected=true;await loadMarineStatus({lat:36.023,lon:129.419});
    assert.match($('marineWind').textContent,/4.2 m\/s/);assert.equal($('marineWind').dataset.briefAllowed,'true');assert.equal($('marineWind').dataset.station,'포항');
    assert.match($('marineWaveHeight').textContent,/0.6 m/);assert.equal($('marineReferenceList').children.length,0);
    invalidateMarineStatus();assert.equal($('marineWind').dataset.briefAllowed,'false');assert.equal($('marineWind').dataset.station,undefined);assert.equal($('marineReferenceDetails').hidden,true);
  }finally{dom.window.close();delete globalThis.document;}
});
