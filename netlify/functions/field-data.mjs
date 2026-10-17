// Official sources: docs/DATA_SOURCES_KO.md. No user-supplied upstream URLs.
const json = (status, data) => ({statusCode:status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, body:JSON.stringify(data)});
const number = (v,min,max) => v!==null && v!==undefined && String(v).trim()!=='' && Number.isFinite(Number(v)) && Number(v)>=min && Number(v)<=max ? Number(v) : null;
export function parseKmaTable(text, required) {
  let columns=null; const rows=[];
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const line=raw.trim(), fields=line.replace(/^#+\s*/,'').split(/[\s,]+/);
    if(required.every(k=>fields.includes(k))) {columns=fields;continue;}
    if(!line || line.startsWith('#') || !columns)continue;
    if(fields.length!==columns.length)continue; // Fail closed on changed schema or unescaped names.
    rows.push(Object.fromEntries(columns.map((k,i)=>[k,fields[i]])));
  }
  if(!columns)throw new Error('기상청 응답 형식 확인 필요');
  return rows;
}
function kstTime(v) {
  if(!/^\d{12}$/.test(v || ''))return null;
  const d=new Date(`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T${v.slice(8,10)}:${v.slice(10,12)}:00+09:00`);
  return Number.isFinite(+d)?d.toISOString():null;
}
async function textFetch(url) {
  const r=await fetch(url,{signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw new Error('제공기관 연결 실패');
  const b=await r.text(); if(b.length>4000000)throw new Error('자료 크기 제한 초과'); return b;
}
function items(data) {
  const r=data.response || data;
  if(!['00','0'].includes(String(r?.header?.resultCode))) {
    const code=String(r?.header?.resultCode || 'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,24);
    throw new Error(`제공기관 응답 확인 필요 (${code})`);
  }
  const i=r.body?.items?.item; return {rows:Array.isArray(i)?i:i?[i]:[],total:Number(r.body?.totalCount || 0)};
}
const cache=new Map();
export async function handler(event) {
  const p=event.queryStringParameters||{}, lat=number(p.lat,-90,90),lon=number(p.lon,-180,180);
  if(lat===null||lon===null)return json(400,{error:'유효한 위도·경도가 필요합니다.'});
  if(!['kma','bathymetry'].includes(p.mode))return json(400,{error:'지원하지 않는 자료 종류'});
  const keyName=p.mode==='kma'?'KMA_AUTH_KEY':'SERVICE_KEY',key=process.env[keyName];
  if(!key)return json(503,{error:'활용신청·인증키 설정 대기',configuration:keyName,source:p.mode});
  const cacheKey=`${p.mode}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const hit=cache.get(cacheKey);if(hit&&Date.now()-hit.time<120000)return json(200,{...hit.data,cached:true});
  try {
    let data;
    if(p.mode==='kma') {
      const urls=[`https://apihub.kma.go.kr/api/typ01/url/sea_obs.php?stn=0&help=1&authKey=${encodeURIComponent(key)}`,`https://apihub.kma.go.kr/api/typ01/url/stn_inf.php?inf=BUOY&stn=0&help=1&authKey=${encodeURIComponent(key)}`];
      const [obs,stations]=await Promise.all(urls.map(textFetch));
      const metadata=new Map(parseKmaTable(stations,['STN_ID','LAT','LON']).map(v=>[v.STN_ID,v]));
      const records=parseKmaTable(obs,['STN_ID','TM','WH','WD','WS']).flatMap(v=>{
        const t=kstTime(v.TM);if(!t || +new Date(t)>Date.now()+300000)return [];
        const m=metadata.get(v.STN_ID);
        return [{code:v.STN_ID,name:v.STN_KO || m?.STN_KO || v.STN_ID,time:t,
          lat:number(m?.LAT,-90,90),lon:number(m?.LON,-180,180),
          windMS:number(v.WS,0,100),windFromDeg:number(v.WD,0,360),gustMS:number(v.WS_GST,0,150),
          significantWaveM:number(v.WH,0,30),waterTempC:number(v.TW,-3,45),
          source:'기상청 해양종합관측',quality:'기관 QC 플래그 미검증'}];
      });
      if(!records.length)throw new Error('유효한 기상청 관측자료 미수신');
      data={source:'KMA',fetchedAt:new Date().toISOString(),records,limitations:['해양기상부이 지점정보와 결합된 관측만 거리 계산','유의파고와 평균 풍속이며 모든 지점에 모든 항목이 있지는 않음','연안·외해 대표성은 현장 확인 필요']};
    }else{
      const u=new URL('https://apis.data.go.kr/1192136/waterDepth/GetWaterDepthApiService');
      u.search=new URLSearchParams({serviceKey:decodeURIComponent(key),type:'json',numOfRows:'300',pageNo:'1',ymin:(lat-.006).toFixed(6),ymax:(lat+.006).toFixed(6),xmin:(lon-.006).toFixed(6),xmax:(lon+.006).toFixed(6)});
      const parsed=items(JSON.parse(await textFetch(u)));
      if(parsed.total>parsed.rows.length)throw new Error('수심 격자 일부 미수신 · 범위 축소 필요');
      const points=parsed.rows.flatMap(v=>{const y=number(v.lat,-90,90),x=number(v.lot,-180,180),z=number(v.dpwt,-12000,12000);return y===null||x===null||z===null?[]:[{lat:y,lon:x,rawDepth:z}];});
      data={source:'KHOA 자연과학용 수심정보',fetchedAt:new Date().toISOString(),points,resolutionM:150,verticalDatum:'미검증',depthUnit:'활용가이드 추가 대조 필요',limitations:['150m 격자·광역 지형 참고','수심 단위·수직기준 검증 전 잠수 깊이·해도 수심으로 사용하지 않음','보간하거나 장애물 부재를 판단하지 않음']};
    }
    if(cache.size>100)cache.clear();cache.set(cacheKey,{time:Date.now(),data});return json(200,data);
  }catch{return json(502,{error:'공식자료 수신·형식·이용권한 확인 필요',source:p.mode});}
}
