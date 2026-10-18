import { formatDMS } from "./geo.js";
import { renderObservationStations, clearReferenceLayers } from "./map.js";
import * as api from './api.js';
import { DT_STATIONS, DT_RECENT_STATIONS, HF_STATIONS, SF_STATIONS, TW_STATIONS, getKmaStnId } from './constants.js';
import { distanceBetween } from './geo.js';
import { kstParts, parseKst, formatKst, nearestForecast } from './model.js';
import { rows, measurement, latestMeasurement, observationTime, observationQuality, rankObservationCandidates } from './observations.js';
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
  delete el.dataset.station;delete el.dataset.distance;delete el.dataset.time;
  el.dataset.briefAllowed=String(state==='observed');
}
export function invalidateMarineStatus() {
  generation++;
  clearReferenceLayers();
  ids.forEach(id => render(id, '—', '좌표 변경 · 새로고침 필요'));
  const refs=document.getElementById('marineReferenceList');if(refs)refs.replaceChildren();
  const refDetails=document.getElementById('marineReferenceDetails');if(refDetails)refDetails.hidden=true;
  const extra=document.getElementById('kmaRegionalComparison');if(extra)extra.replaceChildren();
  const official=document.getElementById('officialMarineStatus');if(official)official.textContent='좌표 변경 · 새로고침 필요';
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
  const references=document.getElementById('marineReferenceList');references?.replaceChildren();
  const referenceDetails=document.getElementById('marineReferenceDetails');if(referenceDetails)referenceDetails.hidden=true;
  document.getElementById('marineStationName').textContent = `${formatDMS(point.lat,point.lon)}`;
  document.getElementById('marineFreshness').textContent = '공식 관측자료 조회 중';
  document.getElementById('marineObsTime').textContent = '각 항목의 관측시각을 확인하세요';
  const box=document.getElementById('marineAlertBox'); box.textContent='특보 발표자료 조회 중 · 발효 여부 미확인'; box.style.display='block';
  const tomorrow=kstParts(new Date(now+86400000)).compact;
  const tasks=await Promise.allSettled([
    api.fetchMarineWeatherData(dt.code,date), api.fetchDtRecent(dtr.code,date), api.fetchTwRecent(tw.code,date), api.fetchWindData(point.lat,point.lon), api.fetchHfCurrentByStation(hf.code),
    Promise.allSettled([api.fetchTideData(dt.code,date),api.fetchTideData(dt.code,tomorrow)]), api.fetchSeaFogData(sf.code,date), api.fetchAlertData(getKmaStnId(point.lat,point.lon)),
    (async()=>{ const r=await api.fetchWithTimeout(`/.netlify/functions/field-data?mode=kma&lat=${point.lat}&lon=${point.lon}`,11000);return r.json(); })(),
    (async()=>{ const r=await api.fetchWithTimeout(`/.netlify/functions/field-data?mode=kmawave&lat=${point.lat}&lon=${point.lon}`,11000);return r.json(); })()
  ]);
  if(request!==generation)return;
  const val=i=>tasks[i].status==='fulfilled'?tasks[i].value:null;
  const error=i=>tasks[i].status==='rejected'?tasks[i].reason.message:'시각·수치가 유효한 관측자료 없음';
  const stationMarkers=[];
  const show=(id,item,station,value,label='실측',additionalFlags=[])=>{
    if(!item)return false;
    const q=observationQuality(item,station,point,now), name=item.obsvtrNm || station.name;
    const flags=[...q.flags,...additionalFlags],stamp=formatKst(parseKst(observationTime(item)));
    const metadata=`${label} · ${name} (${station.code}) · ${q.distanceKm.toFixed(1)}km${q.location.approximate?' 약':''} / ${stamp} KST${flags.length?' / '+flags.join(' · '):''}`;
    if(!q.location.approximate)stationMarkers.push({lat:q.location.lat,lon:q.location.lon,label:name+' · '+label+(flags.length?' · 참고':''),value,quality:flags.length?'caution':'observed',direction:id==='marineHfCurrent'?Number(item.crdir):null,time:stamp});
    if(flags.length) {
      const reason=q.ageMinutes>90?'과거 관측만 수신':q.distanceKm>30?'원거리 자료만 수신':q.location.approximate?'관측 좌표 미확인':'파고 정의 미확인';
      render(id,'미확보',reason+' · 아래 참고자료 확인','reference');
      if(references){const row=document.createElement('li');const names={marineWind:'풍향·풍속',marineWaveHeight:'파고',marineHfCurrent:'표층 유향·유속',marineWaterTemp:'수온',marineAirTemp:'기온',marineAirPress:'기압',marineVisibility:'시정'};const title=document.createElement('strong');title.textContent=`${names[id]||label} ${value}`;const detail=document.createElement('small');detail.textContent=metadata;row.append(title,detail);references.append(row);if(referenceDetails)referenceDetails.hidden=false;}
    } else {
      render(id,value,metadata,'observed');
      const el=document.getElementById(id);el.dataset.station=name;el.dataset.distance=q.distanceKm.toFixed(1);el.dataset.time=stamp;
    }
    return true;
  };
  const marine=val(0);
  for(const [id,key,keys,min,max,unit] of [
    ['marineWaterTemp','water',['wtem','water_temp'],-3,45,'℃'],['marineAirTemp','air',['artmp','air_temp'],-60,60,'℃'],['marineAirPress','press',['atmpr','air_pres'],800,1100,'hPa']
  ]) {
    const it=latestMeasurement(marine?.[key],keys,min,max,now);
    if(!show(id,it,dt,`${measurement(it,keys,min,max)} ${unit}`)) render(id,'미확보',marine?.errors?.[key] || error(0));
  }
  const kma=val(8), kmaWave=val(9), kmaRecords=[...rows(kma?.records),...rows(kmaWave?.records)], kmaCandidates=kmaRecords.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon)).map(r=>({item:{obsrvnDt:r.time,lat:r.lat,lot:r.lon,obsvtrNm:r.name,wspd:r.windMS,wndrct:r.windFromDeg,wvhgt:r.significantWaveM,wavePeriodS:r.wavePeriodS??null},station:{name:r.name,code:'KMA '+r.code,lat:r.lat,lon:r.lon}}));
  const kmaBox=document.getElementById('officialMarineStatus');
  if(kmaBox)kmaBox.textContent=`기상청 해양관측 ${rows(kma?.records).length?'수신':'미수신'} · 연안 파고부이 ${rows(kmaWave?.records).length?'수신':'미수신'}${!kmaCandidates.length?' · 인증·권한·응답 확인 필요':''}`;
  const candidates=[[val(1),dtr],[val(2),tw]].map(([data,station])=>({item:latestMeasurement(data,['wspd'],0,100,now),station})).concat(kmaCandidates).filter(v=>v.item && latestMeasurement([v.item],['wspd'],0,100,now));
  const wind=rankObservationCandidates(candidates,point,now)[0];
  if(wind) {const dir=measurement(wind.item,['wndrct'],0,360);show('marineWind',wind.item,wind.station,`${dir===null?'방향 미확인':dir+'°'} / ${measurement(wind.item,['wspd'],0,100)} m/s`,wind.station.code.startsWith('KMA')?'기상청 해상 실측':'실측');}
  else render('marineWind','미확보',`조위관측: ${error(1)} / 부이: ${error(2)}`);
  const waveCandidates=[{item:latestMeasurement(val(2),['wvhgt'],0,30,now),station:tw,definitionKnown:false},...kmaCandidates].filter(v=>v.item&&latestMeasurement([v.item],['wvhgt'],0,30,now));
  const wave=rankObservationCandidates(waveCandidates,point,now)[0];
  if(!wave || !show('marineWaveHeight',wave.item,wave.station,`${measurement(wave.item,['wvhgt'],0,30)} m`,wave.station.code.startsWith('KMA')?`기상청 유의파고 실측${wave.item.wavePeriodS!==null?' · 주기 '+wave.item.wavePeriodS+'s':''}`:'부이 파고 실측',wave.station.code.startsWith('KMA')?[]:['파고 통계정의 미검증']))render('marineWaveHeight','미확보',error(2));
  const compare=document.getElementById('kmaRegionalComparison');
  if(compare){compare.replaceChildren();if(!kmaRecords.length){const p=document.createElement('p');p.className='help';p.textContent='포항·구룡포·월포 관측 미수신 · 기상청 연결·승인 상태 확인 필요';compare.append(p);}for(const r of kmaRecords.filter(r=>['22106','22453','22490'].includes(r.code))){const line=document.createElement('p');line.className='help';line.textContent=`${r.name} (${r.code}) · ${formatKst(r.time)} KST / 유의파고 ${r.significantWaveM??'미수신'}m / 풍속 ${r.windMS??'미수신'}m/s / 파주기 ${r.wavePeriodS??'미수신'}s${r.lat===null?' / 관측좌표 미결합':''}`;compare.append(line);}}
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
  const local=observed.filter(v=>v==='observed').length,reference=observed.filter(v=>v==='reference').length;
  renderObservationStations(stationMarkers);
  document.getElementById('marineFreshness').textContent=`주변 관측 ${local}/7 · 참고만 ${reference} · 미수신 ${7-local-reference}`;
  document.getElementById('marineObsTime').textContent=`조회 완료 ${formatKst(new Date())} KST · 관측시각은 항목별 표시`;
}
