import * as api from './api.js';
import { DT_STATIONS, DT_RECENT_STATIONS, HF_STATIONS, SF_STATIONS, TW_STATIONS, getKmaStnId } from './constants.js';
import { distanceBetween } from './geo.js';
import { kstParts, parseKst, formatKst, nearestForecast } from './model.js';
import { rows, measurement, latestMeasurement, observationTime, observationQuality } from './observations.js';
const ids = ['marineWaterTemp','marineAirTemp','marineAirPress','marineWaveHeight','marineWind','marineVisibility','marineHfCurrent','marineNextTide','marineForecastWind','marineForecastWave'];
let generation = 0;
const nearest = (items,p) => [...items].sort((a,b) => distanceBetween(p.lat,p.lon,a.lat,a.lon)-distanceBetween(p.lat,p.lon,b.lat,b.lon))[0];
function render(id, value, meta = '', state = 'missing') {
  const el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  const number = document.createElement('span'); number.className = 'reading'; number.textContent = value; el.append(number);
  const detail = document.createElement('small'); detail.className = 'reading-meta'; detail.textContent = meta; el.append(detail);
  el.dataset.quality = state;
}
export function invalidateMarineStatus() {
  generation++;
  ids.forEach(id => render(id, '—', '좌표 변경 · 새로고침 필요'));
  document.getElementById('marineStationName').textContent = '좌표 변경';
  document.getElementById('marineFreshness').textContent = '기존 해역 자료 표시 해제';
  document.getElementById('marineObsTime').textContent = '새 좌표 조회 필요';
  const box = document.getElementById('marineAlertBox'); box.textContent = ''; box.style.display = 'none';
}
export async function loadMarineStatus(point = {lat:36.023,lon:129.419}) {
  const request = ++generation, now = Date.now();
  const dt = nearest(DT_STATIONS,point), dtr=nearest(DT_RECENT_STATIONS,point), tw=nearest(TW_STATIONS,point), hf=nearest(HF_STATIONS,point), sf=nearest(SF_STATIONS,point);
  const date = kstParts(new Date()).compact;
  ids.forEach(id=>render(id,'—','조회 중…'));
  document.getElementById('marineStationName').textContent = `${point.lat.toFixed(4)}°N, ${point.lon.toFixed(4)}°E`;
  document.getElementById('marineFreshness').textContent = '공식 관측자료 조회 중';
  document.getElementById('marineObsTime').textContent = '각 항목의 관측시각을 확인하세요';
  const box=document.getElementById('marineAlertBox'); box.textContent='특보 발표자료 조회 중 · 발효 여부 미확인'; box.style.display='block';
  const tomorrow=kstParts(new Date(now+86400000)).compact;
  const tasks=await Promise.allSettled([
    api.fetchMarineWeatherData(dt.code,date), api.fetchDtRecent(dtr.code,date), api.fetchTwRecent(tw.code,date), api.fetchWindData(point.lat,point.lon), api.fetchHfCurrentByStation(hf.code),
    Promise.allSettled([api.fetchTideData(dt.code,date),api.fetchTideData(dt.code,tomorrow)]), api.fetchSeaFogData(sf.code,date), api.fetchAlertData(getKmaStnId(point.lat,point.lon))
  ]);
  if(request!==generation)return;
  const val=i=>tasks[i].status==='fulfilled'?tasks[i].value:null;
  const error=i=>tasks[i].status==='rejected'?tasks[i].reason.message:'시각·수치가 유효한 관측자료 없음';
  const show=(id,item,station,value,label='실측')=>{
    if(!item)return false;
    const q=observationQuality(item,station,point), name=item.obsvtrNm || station.name;
    render(id,value,`${label} · ${name} (${station.code}) · ${q.distanceKm.toFixed(1)}km${q.location.approximate?' 약':''} / ${formatKst(parseKst(observationTime(item)))} KST${q.flags.length?' / '+q.flags.join(' · '):''}`,q.flags.length?'caution':'observed');
    return true;
  };
  const marine=val(0);
  for(const [id,key,keys,min,max,unit] of [
    ['marineWaterTemp','water',['wtem','water_temp'],-3,45,'℃'],['marineAirTemp','air',['artmp','air_temp'],-60,60,'℃'],['marineAirPress','press',['atmpr','air_pres'],800,1100,'hPa']
  ]) {
    const it=latestMeasurement(marine?.[key],keys,min,max,now);
    if(!show(id,it,dt,`${measurement(it,keys,min,max)} ${unit}`)) render(id,'미확보',marine?.errors?.[key] || error(0));
  }
  const candidates=[[val(1),dtr],[val(2),tw]].map(([data,station])=>({item:latestMeasurement(data,['wspd'],0,100,now),station})).filter(v=>v.item);
  candidates.sort((a,b)=>{
    const qa=observationQuality(a.item,a.station,point,now),qb=observationQuality(b.item,b.station,point,now);
    return Number(qa.ageMinutes>90)-Number(qb.ageMinutes>90) || qa.distanceKm-qb.distanceKm || qa.ageMinutes-qb.ageMinutes;
  });
  const wind=candidates[0];
  if(wind) {const dir=measurement(wind.item,['wndrct'],0,360);show('marineWind',wind.item,wind.station,`${dir===null?'방향 미확인':dir+'°'} / ${measurement(wind.item,['wspd'],0,100)} m/s`);}
  else render('marineWind','미확보',`조위관측: ${error(1)} / 부이: ${error(2)}`);
  const wave=latestMeasurement(val(2),['wvhgt'],0,30,now);
  if(!show('marineWaveHeight',wave,tw,`${measurement(wave,['wvhgt'],0,30)} m`))render('marineWaveHeight','미확보',error(2));
  const hfItems=rows(val(4)).filter(v=>latestMeasurement([v],['crsp'],0,1000,now)&&measurement(v,['crdir'],0,360)!==null&&measurement(v,['lat'],-90,90)!==null&&measurement(v,['lot'],-180,180)!==null);
  hfItems.sort((a,b)=>{
    const qa=observationQuality(a,hf,point,now),qb=observationQuality(b,hf,point,now);
    return Number(qa.ageMinutes>90)-Number(qb.ageMinutes>90)||qa.distanceKm-qb.distanceKm||qa.ageMinutes-qb.ageMinutes;
  });
  const hit=hfItems[0];
  if(!show('marineHfCurrent',hit,hf,`${hit?.crdir}° / ${hit?.crsp} cm/s`,'HF 표층 실측'))render('marineHfCurrent','미확보',error(4));
  const fog=latestMeasurement(val(6),['dtvsbV20kLen'],0,20000,now),visibility=measurement(fog,['dtvsbV20kLen'],0,20000);
  if(!show('marineVisibility',fog,sf,`${visibility===20000?'≥ ':''}${(visibility/1000).toFixed(1)} km`))render('marineVisibility','미확보',error(6));
  const tides=rows(val(5)).flatMap(v=>v.status==='fulfilled'?rows(v.value):[]).filter(v=>+parseKst(v.predcDt)>now).sort((a,b)=>parseKst(a.predcDt)-parseKst(b.predcDt));
  const tide=tides[0];
  // Do not guess the undocumented extreme-type code meaning.
  if(tide)render('marineNextTide',`${measurement(tide,['predcTdlvVl'],-1000,2000)??'—'} cm`,`${tide.obsvtrNm||dt.name} · 조석예보 / ${formatKst(parseKst(tide.predcDt))} KST / 극치 코드 ${tide.extrSe} (고·저조 명칭 미검증)`,'forecast');
  else render('marineNextTide','미확보','다음 극치 예보 수신 실패');
  const fcst=val(3);
  for(const [id,cat,unit] of [['marineForecastWind','WSD','m/s'],['marineForecastWave','WAV','m']]) {
    const f=nearestForecast(fcst?.items,cat,new Date(now));
    if(f)render(id,`${f.value} ${unit}`,`기상청 단기예보 · 격자 ${fcst.nx},${fcst.ny} / 대상 ${formatKst(f.time)} KST / 발표 ${fcst.base_date} ${fcst.base_time} KST`,'forecast');
    else render(id,'미확보',fcst?'해당 시각 예보 없음':error(3));
  }
  const titles=rows(val(7)).map(v=>v.title||v.wrnVar||v.msg||'').filter(v=>/풍랑|강풍|태풍|해일/.test(v));
  box.textContent=titles.length?`최근 발표 · 발효·해제 상태 미확인: ${titles.slice(0,3).join(' / ')}`:`특보 발효 상태 미확인${tasks[7].status==='rejected'?' · '+error(7):' · 발표목록만으로 무특보를 판단하지 않습니다.'}`;
  const observed=ids.slice(0,7).map(id=>document.getElementById(id).dataset.quality);
  const received=observed.filter(v=>v==='observed'||v==='caution').length;
  document.getElementById('marineFreshness').textContent=`실측 ${received}/7항목 수신 · 주의 ${observed.filter(v=>v==='caution').length}항목`;
  document.getElementById('marineObsTime').textContent=`조회 완료 ${formatKst(new Date())} KST · 관측시각은 항목별 표시`;
}
