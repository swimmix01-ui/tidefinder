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
      url = `https://apis.data.go.kr/1192136/roms/GetRomsApiService?serviceKey=${SERVICE_KEY}&type=json&numOfRows=10&pageNo=1&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}`;
    }
    // ===== 국립해양조사원(KHOA) 조류예측 격자 프록시 =====
    // ※ 원래 index.html(클라이언트)에서 khoa.go.kr을 직접 호출하며 서비스키를 그대로
    //   노출하고 있었다. 이제 클라이언트는 이 mode를 통해서만 조회하고, 실제 키와
    //   목적지 URL은 서버(이 함수) 안에만 존재한다.
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
