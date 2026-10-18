import { formatDMS } from "./geo.js";
import sources from '../data/sources.json';
import { fetchWithTimeout } from './api.js';
import { invalidateMapSize, clearReferenceLayers, renderBathymetryReference, beginLocationPick, cancelLocationPick } from './map.js';
const $=id=>document.getElementById(id);
function node(tag,text,parent,className) {const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;parent?.append(n);return n;}
export function mountWorkspace(getCoords) {
  const main=document.querySelector('main');main.classList.add('workspace');
  const nav=node('nav',null,null,'workspace-tabs');nav.setAttribute('aria-label','현장 상황판 메뉴');
  const defs=[['scene','해상정보'],['plan','표류예측'],['records','기록'],['sources','자료안내']];
  const panels=new Map(),buttons=new Map();
  for(const [key,title]of defs){const p=node('section',null,null,'workspace-panel');p.id='view-'+key;p.setAttribute('aria-label',title);p.hidden=key!=='scene';panels.set(key,p);const b=node('button',title,nav);b.type='button';b.setAttribute('aria-controls',p.id);b.setAttribute('aria-pressed',String(key==='scene'));buttons.set(key,b);}
  const scene=panels.get('scene'),plan=panels.get('plan'),records=panels.get('records'),catalog=panels.get('sources');
  const intro=node('div',null,scene,'scene-title');node('div','현장 상황판',intro,'scene-label');const selected=node('strong','사고 해역을 지도에서 선택하세요',intro);selected.id='selectedScenePoint';
  const quick=node('div',null,scene,'quick-strip');
  for(const [id,title]of [['marineHfCurrent','표층 흐름'],['marineWind','관측 바람'],['marineWaveHeight','관측 파고']]) {
    const cell=node('div',null,quick);node('span',title,cell,'quick-label');const value=node('strong','조회 중',cell),meta=node('small','관측 근거 확인 중',cell,'quick-meta'), source=$(id);
    const sync=()=>{value.textContent=source.querySelector('.reading')?.textContent || source.textContent;value.dataset.quality=source.dataset.quality;const detail=source.querySelector('.reading-meta')?.textContent||'';const flags=['과거 관측','원거리 참고','거리 근사'].filter(v=>detail.includes(v));meta.textContent=(flags.length?flags.join(' · ')+' / ':'')+(detail.split(' / ')[1]||detail||'관측 근거 확인 중');};
    new window.MutationObserver(sync).observe(source,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-quality']});sync();
  }
  const sceneGrid=node('div',null,scene,'scene-grid'),mapColumn=node('section',null,sceneGrid,'map-column');
  const pickBanner=node('div',null,mapColumn,'map-pick-banner');pickBanner.hidden=true;
  const pickMessage=node('strong',null,pickBanner);const cancelPick=node('button','선택 취소',pickBanner);
  const mapPanel=document.querySelector('.map-panel');mapColumn.append(mapPanel);
  const startGuide=node('div',null,scene,'start-guide');
  node('strong','1. 사고 위치 선택',startGuide);node('p','지도에서 사고 지점을 누르면 그 해역의 정보를 조회합니다.',startGuide);
  const enterCoordinates=node('button','좌표로 입력',startGuide);scene.insertBefore(startGuide,sceneGrid);

  const tools=document.querySelector('.map-tools');mapColumn.append(tools);
  const officialChart=node('a','공식 바다지도 ↗',tools,'official-chart-link');officialChart.href='https://www.khoa.go.kr/oceanmap/main.do';officialChart.target='_blank';officialChart.rel='noopener';
  const bathyButton=node('button','수심 격자 조회',tools);bathyButton.type='button';
  const bathy=node('details',null,mapColumn,'card terrain-reference');node('summary','수심자료 상태',bathy);const bathyStatus=node('p','150m 격자 참고자료 · 해저 장애물·잠수 깊이 판정용이 아닙니다.',bathy,'help');const bathyValues=node('div',null,bathy,'table-scroll');
  sceneGrid.append($('marineCard'));
  scene.append($('fieldContext'));node('p','표층 조류와 수중 조류는 다를 수 있습니다. 관측·예보와 현장 확인사항을 구분하세요.',scene,'workspace-note');
  node('h2','사고 위치 · 표류 시나리오',plan);node('p','시각은 한국시간입니다. 수동값·자료 공백을 확인한 후 계산하세요.',plan,'help');
  for(const id of ['inputCard','dataQuality','resultCard','aiCard','searchCard'])plan.append($(id));
  node('h2','현장 기록',records);$('operationsCard').open=true;records.append($('operationsCard'));
  node('h2','공식 데이터 · 연결 현황',catalog);node('p','연결된 자료와 신청·검증 대기 자료를 구분합니다. 목록이 있다는 이유로 지도나 예측에 적용되지는 않습니다.',catalog,'help');
  const application=node('a','API 신청·설정 안내 ↗',catalog,'application-link');application.href='https://github.com/swimmix01-ui/tidefinder/blob/codex/field-response-upgrade/docs/DATA_SOURCES_KO.md';application.target='_blank';application.rel='noopener';
  const filter=node('input',null,catalog);filter.type='search';filter.placeholder='기관·자료 검색';filter.setAttribute('aria-label','자료 검색');const list=node('div',null,catalog,'source-catalog');
  function renderSources(){list.replaceChildren();const q=filter.value.trim().toLowerCase();for(const s of sources.filter(s=>[s.agency,s.name,s.category,s.state].join(' ').toLowerCase().includes(q))){const row=node('article',null,list,'source-row');node('span',s.agency,row,'source-agency');const info=node('div',null,row);const a=node('a',s.name,info);a.href=s.url;a.target='_blank';a.rel='noopener';node('p',s.use,info);node('small',`${s.format} · ${s.license}`,info);node('span',s.state,row,'source-state');}}
  filter.addEventListener('input',renderSources);renderSources();
  catalog.append($('resourceHub'));const cctv=[...main.children].find(el=>el.classList.contains('card')&&el.textContent.includes('전국 CCTV'));if(cctv)catalog.append(cctv);
  main.replaceChildren(nav,$('status'),...panels.values());
  function show(key){if(key!=='scene'){cancelLocationPick();pickBanner.hidden=true;startGuide.hidden=false;}for(const [k,p]of panels){p.hidden=k!==key;buttons.get(k).setAttribute('aria-pressed',String(k===key));}if(key==='scene')requestAnimationFrame(invalidateMapSize);}
  for(const [key,b]of buttons)b.addEventListener('click',()=>show(key));
  enterCoordinates.addEventListener('click',()=>show('plan'));
  cancelPick.addEventListener('click',()=>{cancelLocationPick();pickBanner.hidden=true;startGuide.hidden=false;show('records');});
  document.addEventListener('tidefinder:record-map-pick',event=>{
    show('scene');pickBanner.hidden=false;startGuide.hidden=true;
    pickMessage.textContent=event.detail.kind==='observation'?'목격·발견 위치를 지도에서 누르세요.':'수색한 구역의 중심을 지도에서 누르세요.';
    beginLocationPick(point=>{pickBanner.hidden=true;event.detail.onPick(point);show('records');});
    pickBanner.scrollIntoView?.({block:'center',behavior:'smooth'});
  });

  const locationLink=document.querySelector('.location-link');locationLink.addEventListener('click',e=>{e.preventDefault();show('plan');});
  document.addEventListener('tidefinder:prediction-ready',()=>show('scene'));
  function selectionChanged(){clearReferenceLayers();bathyValues.replaceChildren();bathyStatus.textContent='선택 좌표의 수심자료 조회 대기';const kma=$('kmaRegionalComparison');if(kma)kma.replaceChildren();try{const p=getCoords();selected.textContent=`${formatDMS(p.lat,p.lon)}`;}catch{selected.textContent='좌표 입력 확인 필요';}}
  document.addEventListener('tidefinder:location-changed',selectionChanged);selectionChanged();requestAnimationFrame(invalidateMapSize);
  let pending=false;
  bathyButton.addEventListener('click',async()=>{
    if(pending)return;pending=true;bathyButton.disabled=true;bathy.open=true;
    let p;try{p=getCoords();bathyStatus.textContent='공식 수심 격자 조회 중…';bathyValues.replaceChildren();clearReferenceLayers();
      const r=await fetchWithTimeout(`/.netlify/functions/field-data?mode=bathymetry&lat=${p.lat}&lon=${p.lon}`,11000),data=await r.json(),current=getCoords();
      if(current.lat!==p.lat||current.lon!==p.lon)return;
      bathyStatus.textContent=`${data.source} · ${data.points.length}개 격자 · 간격 ${data.resolutionM}m / 수심 단위·수직기준 미검증. 원시 dpwt 값이며 잠수 깊이로 사용하지 않습니다.`;
      renderBathymetryReference(data.points);
      const table=node('table',null,bathyValues),caption=node('caption','제공기관 원시 격자 · 보간 없음',table),head=node('tr',null,node('thead',null,table));for(const title of ['좌표 (도·분·초)','원시 수심값 dpwt'])node('th',title,head);const body=node('tbody',null,table);for(const pt of data.points){const row=node('tr',null,body);for(const v of [formatDMS(pt.lat,pt.lon),pt.rawDepth])node('td',String(v),row);}
    }catch(e){try{const current=getCoords();if(p&&(p.lat!==current.lat||p.lon!==current.lon))return;}catch{return;}bathyStatus.textContent=`수심자료 미확보 · ${e.message} / 자료연결 메뉴에서 활용신청 상태를 확인하세요.`;}finally{pending=false;bathyButton.disabled=false;}
  });
  return selectionChanged;
}
