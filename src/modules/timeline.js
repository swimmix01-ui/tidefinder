import { formatDMS } from "./geo.js";
import { formatKst, interpolatePath } from "./model.js";
import { showTimePosition } from "./map.js";
const $=id=>document.getElementById(id);
let current=null;
export function mountTimeline() {
  $("predictionTime").addEventListener("input",()=>{
    if(current) showAt(new Date(new Date(current.startDateTime).getTime()+Number($("predictionTime").value)*60000));
  });
  $("showNow").addEventListener("click",()=>showAt(new Date()));
  $("showArrival").addEventListener("click",()=>{
    const minutes=Number($("arrivalMinutes").value);
    if(!Number.isFinite(minutes)||minutes<0||minutes>1440) {$("timelineMessage").textContent="도착 예정시간은 0~1,440분입니다.";return;}
    showAt(new Date(Date.now()+minutes*60000));
  });
}
function showAt(date) {
  if(!current) {$("timelineMessage").textContent="예측을 먼저 실행하세요.";return;}
  const p=interpolatePath(current,date);
  if(!p) {$("timelineMessage").textContent=`${formatKst(date)}는 계산 범위 밖입니다. 기준부터 도착 시각까지 포함하도록 예측시간을 조정하세요.`;return;}
  $("predictionTime").value=(date-new Date(current.startDateTime))/60000;
  $("timePosition").textContent=`${formatKst(date)} / ${formatDMS(p.lat,p.lon)} / 추정 반경 ${Math.round(p.radius)}m`;
  $("timelineMessage").textContent="";
  showTimePosition(p);
}
export function showPredictionTimeline(result) {
  current=result;
  $("timelineCard").hidden=false;
  $("predictionTime").max=result.actualHours*60;
  $("predictionTime").value=result.actualHours*60;
  showAt(new Date(result.samples.at(-1).time));
}
export function clearTimeline() {current=null;$("timelineCard").hidden=true;}
