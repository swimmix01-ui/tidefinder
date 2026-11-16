const https = require('https');

function nativeHttpsFetch(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ text: () => Promise.resolve(data), status: res.statusCode }));
    }).on('error', (err) => reject(err));
  });
}


// 바이너리 그대로 받기 - 기상청 API허브는 EUC-KR로 응답해서 문자열로 이어붙이면 한글이 깨진다.
function nativeHttpsFetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function kstStamp(date) {
  const k = new Date(date.getTime() + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

// 기상청 API허브 해양 종합 관측자료(sea_obs.php) 파싱.
// 한 줄 형식: TP, TM, STN_ID, STN_KO, LON, LAT, WH, WD, WS, WS_GST, TW, TA, PA, HM, ...
// (TP: B 해양기상부이 / C 파고부이 / L 등표 / N 조위관측소 / F 연안방재 / G 파랑계 / J 기상1호 등)
// 결측값은 음수 큰 값(-99 등)이나 빈칸 - null로 바꾼다. 지점별로 가장 최근 관측만 남긴다.
function parseKmaSeaObs(text) {
  const num = (v) => {
    const n = parseFloat(v);
    return v === undefined || v.trim() === '' || isNaN(n) || n <= -50 ? null : n;
  };
  // 부이는 바람(10분)과 파고(30분)의 관측 주기가 달라서, 가장 최근 줄에 파고가 비어 있는 경우가
  // 많다. 그래서 지점별로 파고와 바람을 각각 "값이 있는 가장 최근 관측"으로 따로 고른다.
  // (2026-11-16: 최근 한 줄만 남겨서 구룡포 파고가 사라졌던 문제 수정)
  const byStn = {};
  text.split('\n').forEach((line) => {
    if (!line.trim() || line.startsWith('#')) return;
    const c = line.split(',').map((x) => x.trim());
    if (c.length < 10 || !/^\d{12}$/.test(c[1])) return;
    const lon = num(c[4]), lat = num(c[5]);
    if (lat === null || lon === null) return;
    const st = byStn[c[2]] || (byStn[c[2]] = { tp: c[0], stn: c[2], name: c[3], lon, lat, wh: null, whTm: null, wd: null, ws: null, gst: null, windTm: null, tw: null });
    const wh = num(c[6]), wd = num(c[7]), ws = num(c[8]), gst = num(c[9]), tw = num(c[10]);
    if (wh !== null && (!st.whTm || c[1] > st.whTm)) { st.wh = wh; st.whTm = c[1]; }
    if (wd !== null && ws !== null && (!st.windTm || c[1] > st.windTm)) { st.wd = wd; st.ws = ws; st.gst = gst; st.windTm = c[1]; }
    if (tw !== null) st.tw = tw;
  });
  return Object.values(byStn);
}

exports.handler = async function (event) {
  // 보안 개선: Netlify 환경변수(SERVICE_KEY)를 우선 사용하고, 아직 설정 전이면 기존 값으로 폴백.
  // Netlify 대시보드 > Site configuration > Environment variables 에서 SERVICE_KEY를 등록하면
  // 이 하드코딩된 값은 더 이상 쓰이지 않게 되어 GitHub에 키가 노출되는 문제가 해결됩니다.
  const RAW_KEY = process.env.SERVICE_KEY || 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041';
  const SERVICE_KEY = encodeURIComponent(decodeURIComponent(RAW_KEY));

  // ※ 국립해양조사원(KHOA) 조류예측 API 전용 키. 기존에는 이 키가 index.html(브라우저에서
  //   그대로 보이는 클라이언트 코드)에 하드코딩되어 있어, 누구나 "페이지 소스 보기"로
  //   확인할 수 있는 문제가 있었다. 이제 다른 공공데이터 키와 동일한 방식으로
  //   Netlify 환경변수(KHOA_SERVICE_KEY)를 통해 서버(이 함수) 안에서만 사용하도록 옮겼다.
  //   환경변수를 아직 등록 전이면 기존 값으로 폴백하되, 등록 즉시 이 폴백은 무시된다.
  const KHOA_RAW_KEY = process.env.KHOA_SERVICE_KEY || 'srQx3b3XW8NV9RpGp9CQ==';
  const KHOA_SERVICE_KEY = encodeURIComponent(decodeURIComponent(KHOA_RAW_KEY));

  // ※ 해양관측부이 최신 관측데이터(twRecent) 전용 키. 2026-09-08 data.go.kr 활용신청
  //   승인 후 서비스 상세페이지에 표시된 "일반 인증키"를 그대로 사용한다. 기존 SERVICE_KEY와
  //   같은 1192136 API 그룹이지만 표시된 키 형식이 달라(인코딩된 base64 형태) 별도 변수로
  //   분리했다 - 나중에 실제로 SERVICE_KEY와 동일한 키인지 확인되면 하나로 합쳐도 된다.
  //   조위관측소 최신 관측데이터(dtRecent)도 같은 계정의 일반 인증키라 이 값을 재사용한다
  //   (두 API의 활용가이드 예시 URL에 있는 키는 동일한 샘플용 플레이스홀더였음 - 실제 계정
  //   키가 아니므로 사용하지 않았다).
  //   Netlify 환경변수(TW_SERVICE_KEY) 등록 전까지는 이 값으로 폴백.
  const TW_RAW_KEY = process.env.TW_SERVICE_KEY || 'maDTn85O5hOnL3OMZgubNtde12H%2Fd1RTd1qbfp43kqLqBOfi57kuKAPmCEW4oLCsayYHvYVMlq03jlr6dE9ilg%3D%3D';
  const TW_SERVICE_KEY = encodeURIComponent(decodeURIComponent(TW_RAW_KEY));

  const params = event.queryStringParameters || {};
  const mode = params.mode || 'fcst';

  const corsHeaders = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Access-Control-Allow-Origin': '*'
  };
  const fetchHeaders = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Content-Type': 'application/json'
  };

  // ===== Open-Meteo 해상 격자 예보 프록시 =====
  // 브라우저 직접 호출은 실패해도 원인이 서버 기록에 남지 않아서 함수를 거치게 했다.
  // kind=wind → api.open-meteo.com/v1/forecast, kind=wave → marine-api.open-meteo.com/v1/marine
  if (mode === 'openmeteo') {
    const { kind, lat, lon, past, fcst } = params;
    const la = parseFloat(lat), lo = parseFloat(lon);
    const ph = Math.max(1, Math.min(2000, parseInt(past, 10) || 1));
    const fh = Math.max(1, Math.min(384, parseInt(fcst, 10) || 2));
    if (isNaN(la) || isNaN(lo) || (kind !== 'wind' && kind !== 'wave')) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'kind/lat/lon 확인' }) };
    }
    const common = `latitude=${la.toFixed(4)}&longitude=${lo.toFixed(4)}&timeformat=unixtime&cell_selection=sea&past_hours=${ph}&forecast_hours=${fh}`;
    const omUrl = kind === 'wind'
      ? `https://api.open-meteo.com/v1/forecast?${common}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`
      : `https://marine-api.open-meteo.com/v1/marine?${common}&hourly=wave_height`;
    try {
      const r = await nativeHttpsFetchBuffer(omUrl);
      const body = r.buffer.toString('utf8');
      if (r.status !== 200) console.log(`openmeteo ${kind} HTTP ${r.status}: ${body.substring(0, 300)}`);
      return { statusCode: r.status, headers: corsHeaders, body };
    } catch (err) {
      console.log(`openmeteo ${kind} error: ${err.message}`);
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ===== 자연과학용 수심정보(150m 격자) =====
  // 공공데이터포털 1192136/waterDepth. 키는 twRecent와 같은 계정 키(TW_SERVICE_KEY)를 쓴다.
  // 오퍼레이션 이름·파라미터가 문서로 확인되지 않아 후보를 차례로 시도하고, 처음 성공한 것을 쓴다.
  if (mode === 'waterdepth') {
    const { ymin, ymax, xmin, xmax } = params;
    const pageNo = Math.max(1, parseInt(params.pageNo, 10) || 1);
    const rows = Math.max(1, Math.min(10000, parseInt(params.numOfRows, 10) || 1000));
    if (!ymin || !ymax || !xmin || !xmax) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'ymin/ymax/xmin/xmax 필요' }) };
    }
    const ops = params.op ? [params.op] : ['GetWaterDepthApiService', 'GetWaterDepthService', 'getWaterDepth'];
    const tries = [];
    for (const op of ops) {
      const u = `https://apis.data.go.kr/1192136/waterDepth/${op}?serviceKey=${TW_SERVICE_KEY}&type=json&numOfRows=${rows}&pageNo=${pageNo}&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}`;
      try {
        const r = await nativeHttpsFetch(u, fetchHeaders);
        const text = await r.text();
        tries.push({ op, status: r.status, head: text.substring(0, 300) });
        if (r.status === 200 && !/NO_OPENAPI_SERVICE|SERVICE_KEY|Unexpected errors|API not found/i.test(text.substring(0, 400))) {
          return { statusCode: 200, headers: corsHeaders, body: text };
        }
      } catch (err) {
        tries.push({ op, error: err.message });
      }
    }
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: '수심 API 호출 실패', tries }) };
  }

  // ===== 얕은 수심 타일(0.1° × 0.1°) =====
  // 앱이 쓰는 형태로 서버에서 줄여 보낸다: 수심 maxDepth(m) 이하 점만 [위도, 경도, 수심] 배열로.
  // 수심은 국립해양조사원 자연과학용 수심(150m 격자, 평균해면 기준). 자료가 거의 안 바뀌어서
  // Netlify CDN에 길게 캐시한다 - 같은 타일은 두 번째부터 공공데이터 서버를 거치지 않는다.
  if (mode === 'shallow') {
    const tx = parseInt(params.tx, 10), ty = parseInt(params.ty, 10);
    const maxDepth = Math.min(30, Math.max(1, parseFloat(params.maxDepth) || 10));
    if (isNaN(tx) || isNaN(ty) || tx < 1200 || tx > 1320 || ty < 320 || ty > 390) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'tx/ty 범위 확인 (0.1도 타일 번호)' }) };
    }
    const ymin = (ty / 10).toFixed(1), ymax = ((ty + 1) / 10).toFixed(1);
    const xmin = (tx / 10).toFixed(1), xmax = ((tx + 1) / 10).toFixed(1);
    const pts = [];
    let total = 0, got = 0;
    try {
      for (let pageNo = 1; pageNo <= 6; pageNo++) {
        const u = `https://apis.data.go.kr/1192136/waterDepth/GetWaterDepthApiService?serviceKey=${TW_SERVICE_KEY}&type=json&numOfRows=5000&pageNo=${pageNo}&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}`;
        const r = await nativeHttpsFetch(u, fetchHeaders);
        const text = await r.text();
        if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${text.substring(0, 120)}`);
        let j;
        try { j = JSON.parse(text); } catch (e) { throw new Error(`응답 형식 오류: ${text.substring(0, 120)}`); }
        const body = j.body || (j.response && j.response.body) || {};
        let items = body.items && body.items.item;
        if (!items) items = [];
        if (!Array.isArray(items)) items = [items];
        total = parseInt(body.totalCount, 10) || 0;
        got += items.length;
        for (const it of items) {
          const d = parseFloat(it.dpwt), la = parseFloat(it.lat), lo = parseFloat(it.lot);
          if (isNaN(d) || isNaN(la) || isNaN(lo) || d > maxDepth) continue;
          pts.push([Math.round(la * 1e4) / 1e4, Math.round(lo * 1e4) / 1e4, Math.round(d * 10) / 10]);
        }
        if (!items.length || got >= total) break;
      }
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400', 'Netlify-CDN-Cache-Control': 'public, durable, max-age=2592000' },
        body: JSON.stringify({ tx, ty, maxDepth, total, got, pts }),
      };
    } catch (err) {
      console.log(`shallow ${tx},${ty} error: ${err.message}`);
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ===== 기상청 API허브 해양 종합 관측(해양기상부이·파고부이·등표 등) 실측 =====
  // 요청 시각 기준 -59분~00분 자료가 오므로, 비어 있으면 1시간 전으로 한 번 더 요청한다.
  if (mode === 'kmasea') {
    const KMA_KEY = process.env.KMA_APIHUB_KEY;
    if (!KMA_KEY) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'KMA_APIHUB_KEY 미설정' }) };
    }
    try {
      for (const back of [0, 1]) {
        const tm = kstStamp(new Date(Date.now() - back * 3600000));
        const r = await nativeHttpsFetchBuffer(`https://apihub.kma.go.kr/api/typ01/url/sea_obs.php?tm=${tm}&stn=0&help=0&authKey=${encodeURIComponent(KMA_KEY)}`);
        if (r.status !== 200) {
          return { statusCode: r.status, headers: corsHeaders, body: JSON.stringify({ error: `기상청 API허브 에러 (HTTP ${r.status})` }) };
        }
        let text;
        try { text = new TextDecoder('euc-kr').decode(r.buffer); } catch (e) { text = r.buffer.toString('utf8'); }
        const stations = parseKmaSeaObs(text);
        console.log(`kmasea tm=${tm} lines=${text.split('\n').length} stations=${stations.length} wave=${stations.filter((x) => x.wh !== null).length} wind=${stations.filter((x) => x.ws !== null).length}`);
        if (stations.length > 0 || back === 1) {
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ tm, stations }) };
        }
      }
    } catch (err) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  try {
    let url = '';

    if (mode === 'fcst') {
      const { nx, ny, base_date, base_time } = params;
      if (!nx || !ny || !base_date || !base_time) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: '파라미터 누락' }) };
      }
      url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${SERVICE_KEY}&numOfRows=1000&pageNo=1&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;
    }
    else if (mode === 'alert') {
      const { stnId } = params;
      if (!stnId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'stnId 필요' }) };
      url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${SERVICE_KEY}&numOfRows=30&pageNo=1&dataType=JSON&stnId=${stnId}`;
    }
    else if (mode === 'watertemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyWaterTemp/GetSurveyWaterTempApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=100`;
    }
    else if (mode === 'airtemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyAirTemp/GetSurveyAirTempApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=100`;
    }
    else if (mode === 'airpress') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyAirPress/GetSurveyAirPressApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=100`;
    }
    // 시정(해무관측소) - obsCode 예: SF_0011 (포항 근처 코드는 별도 확인 필요, 기본값은 예시코드)
    else if (mode === 'seafog') {
      const obsCode = params.obsCode || 'SF_0011';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveySeafog/GetSurveySeafogApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&pageNo=1&numOfRows=100`;
    }
    // HF 레이더 표층 해수유동(실측 유향·유속) 관측 API
    else if (mode === 'hfcurrent') {
      const obsCode = params.obsCode || 'HF_0071'; // 포항항 기본값 (실제 관측소 위치 확인 필요)
      url = `https://apis.data.go.kr/1192136/hfCurrent/GetHFCurrentApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&pageNo=1&numOfRows=10&include=lot,lat,obsrvnDt,crdir,crsp`;
    }
    else if (mode === 'scuba') {
      const placeCode = params.placeCode || 'SS1';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/fcstSkinScubav2/GetFcstSkinScubaApiServiceV2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=30&placeCode=${placeCode}`;
    }
    else if (mode === 'surfing') {
      const placeCode = params.placeCode || 'SR1';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/fcstSurfingv2/GetFcstSurfingApiServiceV2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=30&placeCode=${placeCode}`;
    }
    // ===== ROMS 수치예측모델(MOHID300+YES3K 계열) - 예측 유향유속(148시간)·수온(72시간) =====
    // ※ 지금 쓰는 KHOA "수치조류도"(khoacurrent) API와는 별개의 데이터 소스.
    //   같은 1192136 API 그룹이라 기존 SERVICE_KEY를 그대로 재사용한다(별도 키 발급 불필요).
    //   요청받은 좌표와 "가장 가까운 예측점" 하나를 자동으로 찾아 돌려주는 방식이라,
    //   현재 우리 코드처럼 격자 중 최근접점을 직접 찾는 로직이 필요 없을 수 있다 -
    //   실제 응답 필드명은 첫 테스트 호출로 확인 필요 (아직 미검증).
    else if (mode === 'roms') {
      const { ymin, ymax, xmin, xmax } = params;
      if (!ymin || !ymax || !xmin || !xmax) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'ymin/ymax/xmin/xmax 파라미터 필요' }) };
      }
      url = `https://apis.data.go.kr/1192136/roms/GetRomsApiService?serviceKey=${SERVICE_KEY}&type=json&numOfRows=200&pageNo=1&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}`;
    }
    // ===== 조석예보(고조·저조) - 만조/간조 시각 및 조위(cm) =====
    // ※ obsCode는 기존 DT_STATIONS와 동일한 코드 체계(DT_0091=포항 등)를 그대로 사용.
    //   같은 1192136 API 그룹이라 기존 SERVICE_KEY 재사용.
    else if (mode === 'tide') {
      const obsCode = params.obsCode || 'DT_0091'; // 기본값: 포항
      const reqDate = params.reqDate; // YYYYMMDD, 생략 시 API 기본값(현재일자) 사용
      const dateParam = reqDate ? `&reqDate=${reqDate}` : '';
      url = `https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService?serviceKey=${SERVICE_KEY}&type=json&numOfRows=10&pageNo=1&obsCode=${obsCode}${dateParam}`;
    }
    // ===== 국립해양조사원(KHOA) 조류예측 격자 프록시 =====
    // ※ 원래 index.html(클라이언트)에서 khoa.go.kr을 직접 호출하며 서비스키를 그대로
    //   노출하고 있었다. 이제 클라이언트는 이 mode를 통해서만 조회하고, 실제 키와
    //   목적지 URL은 서버(이 함수) 안에만 존재한다.
    // ===== 해양관측부이 최신 관측데이터 - 실측 파고/풍향/풍속/기온/기압/수온/유향/유속 =====
    // ※ 스킨스쿠버 예보(폐기됨)를 대신할 실측 파고 소스. obsCode는 TW_로 시작하는
    //   해양관측부이/해수욕장 관측소 코드만 유효 (활용가이드 관측소 목록 표 기준).
    else if (mode === 'twrecent') {
      const { obsCode } = params;
      const reqDate = params.reqDate;
      const min = params.min || '60';
      if (!obsCode || !reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'obsCode/reqDate 필요' }) };
      }
      url = `https://apis.data.go.kr/1192136/twRecent/GetTWRecentApiService?serviceKey=${TW_SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=${min}&numOfRows=10&pageNo=1`;
    }
    else if (mode === 'dtrecent') {
      const { obsCode } = params;
      const reqDate = params.reqDate;
      const min = params.min || '60';
      if (!obsCode || !reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'obsCode/reqDate 필요' }) };
      }
      url = `https://apis.data.go.kr/1192136/dtRecent/GetDTRecentApiService?serviceKey=${TW_SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=${min}&numOfRows=10&pageNo=1`;
    }
    else if (mode === 'khoacurrent') {
      const { date, hour, minute, minX, maxX, minY, maxY } = params;
      if (!date || !hour || !minute || !minX || !maxX || !minY || !maxY) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: '파라미터 누락' }) };
      }
      url = `https://khoa.go.kr/oceandata/api/tidalCurrentArea/search.do?ServiceKey=${KHOA_SERVICE_KEY}&Date=${date}&Hour=${hour}&Minute=${minute}&MinX=${minX}&MaxX=${maxX}&MinY=${minY}&MaxY=${maxY}&ResultType=json`;
    } else {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: '올바르지 않은 mode' }) };
    }

    const res = await nativeHttpsFetch(url, fetchHeaders);
    const text = await res.text();

    if (res.status !== 200) {
      return {
        statusCode: res.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: `공공데이터 서버 에러 (HTTP ${res.status})`, details: text.substring(0, 200) })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: text
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};
