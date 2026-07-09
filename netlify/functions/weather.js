const https = require('https');

// 공공데이터 API 호출을 위한 헬퍼 함수 (fetch 대용)
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
  // 인코딩/디코딩 이슈 방지를 위해 서비스키를 확실하게 인코딩 처리
  const RAW_KEY = 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041';
  const SERVICE_KEY = encodeURIComponent(decodeURIComponent(RAW_KEY));

  const params = event.queryStringParameters || {};
  const mode = params.mode || 'fcst'; 

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.data.go.kr/',
    'Accept': 'application/json, text/plain, *.*'
  };

  try {
    let url = '';

    // 1) 단기예보
    if (mode === 'fcst') {
      const { nx, ny, base_date, base_time } = params;
      if (!nx || !ny || !base_date || !base_time) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'nx, ny, base_date, base_time 필요' }) };
      }
      url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${SERVICE_KEY}&numOfRows=1000&pageNo=1&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;
    }
    // 2) 기상특보
    else if (mode === 'alert') {
      const { stnId } = params;
      if (!stnId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'stnId 필요' }) };
      }
      url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${SERVICE_KEY}&numOfRows=10&pageNo=1&dataType=JSON&stnId=${stnId}`;
    }
    // 3) 실측 수온 (http -> https 변경)
    else if (mode === 'watertemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyWaterTemp/GetSurveyWaterTempApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
    }
    // 4) 실측 기온 (http -> https 변경)
    else if (mode === 'airtemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyAirTemp/GetSurveyAirTempApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
    }
    // 5) 실측 기압 (http -> https 변경)
    else if (mode === 'airpress') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyAirPress/GetSurveyAirPressApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
    }
    // 6) 스킨스쿠버지수 (http -> https 변경)
    else if (mode === 'scuba') {
      const placeCode = params.placeCode || 'SS1';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDDHH) 필요' }) };
      url = `https://apis.data.go.kr/1192136/fcstSkinScubav2/GetFcstSkinScubaApiServiceV2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=10&placeCode=${placeCode}`;
    }
    // 7) 서핑지수 (http -> https 변경)
    else if (mode === 'surfing') {
      const placeCode = params.placeCode || 'SR1';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      url = `https://apis.data.go.kr/1192136/fcstSurfingv2/GetFcstSurfingApiServiceV2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=10&placeCode=${placeCode}`;
    } else {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: '올바르지 않은 mode' }) };
    }

    // 수정된 안전한 호출 방식 적용
    const res = await nativeHttpsFetch(url, fetchHeaders);
    const text = await res.text();
    
    return { 
      statusCode: res.status || 200, 
      headers: corsHeaders, 
      body: text 
    };

  } catch (err) {
    return { 
      statusCode: 500, 
      headers: corsHeaders, 
      body: JSON.stringify({ error: err.message, stack: err.stack }) 
    };
  }
};
