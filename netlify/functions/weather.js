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
  const RAW_KEY = 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041';
  const SERVICE_KEY = encodeURIComponent(decodeURIComponent(RAW_KEY));

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
      url = `https://apis.data.go.kr/1192136/surveyWaterTemp/GetSurveyWaterTempApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=1000`;
    }
    else if (mode === 'airtemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyAirTemp/GetSurveyAirTempApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=1000`;
    }
    else if (mode === 'airpress') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveyAirPress/GetSurveyAirPressApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=1000`;
    }
    // 시정(해무관측소) - obsCode 예: SF_0003 (포항 근처 코드는 별도 확인 필요, 기본값은 예시코드)
    else if (mode === 'seafog') {
      const obsCode = params.obsCode || 'SF_0003';
      const reqDate = params.reqDate;
      if (!reqDate) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate 필요' }) };
      url = `https://apis.data.go.kr/1192136/surveySeafog/GetSurveySeafogApiService?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&pageNo=1&numOfRows=1000`;
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
