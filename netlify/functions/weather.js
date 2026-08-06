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
  // 공공데이터포털 서비스키. Netlify 환경변수(SERVICE_KEY)로만 공급하며, 코드에는 값을
  // 두지 않는다 - 예전엔 여기 하드코딩된 폴백값이 있어 GitHub에 키가 그대로 노출됐었다.
  const SERVICE_KEY = process.env.SERVICE_KEY ? encodeURIComponent(decodeURIComponent(process.env.SERVICE_KEY)) : null;

  // 국립해양조사원(KHOA) 조류예측 API 전용 키. Netlify 환경변수(KHOA_SERVICE_KEY)로만 공급.
  // ※ 원래 index.html(브라우저에서 그대로 보이는 클라이언트 코드)에 하드코딩되어 있어
  //   "페이지 소스 보기"로 누구나 확인할 수 있었던 걸 이 함수(서버)로 옮긴 것.
  const KHOA_SERVICE_KEY = process.env.KHOA_SERVICE_KEY ? encodeURIComponent(decodeURIComponent(process.env.KHOA_SERVICE_KEY)) : null;

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

  // 필요한 서비스키가 Netlify에 등록 안 되어 있으면, 원격 API를 호출하기 전에 여기서
  // 바로 명확한 에러를 반환한다 (예전처럼 유출된 값으로 조용히 폴백하지 않음).
  if (mode === 'khoacurrent') {
    if (!KHOA_SERVICE_KEY) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'KHOA_SERVICE_KEY 환경변수가 설정되지 않았습니다. Netlify 대시보드에서 등록해주세요.' }) };
    }
  } else if (!SERVICE_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'SERVICE_KEY 환경변수가 설정되지 않았습니다. Netlify 대시보드에서 등록해주세요.' }) };
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
