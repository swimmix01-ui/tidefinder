exports.handler = async function (event) {
  const SERVICE_KEY = 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041';

  const params = event.queryStringParameters || {};
  const mode = params.mode || 'fcst'; // fcst | alert | temp | scuba | surfing

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    if (mode === 'fcst') {
      const { nx, ny, base_date, base_time } = params;
      if (!nx || !ny || !base_date || !base_time) {
        return { statusCode: 400, headers: corsHeaders,
          body: JSON.stringify({ error: 'nx, ny, base_date, base_time 파라미터가 필요합니다.' }) };
      }
      const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${SERVICE_KEY}&numOfRows=1000&pageNo=1&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 조위관측소 실측 수온 (obsCode 기본값: DT_0001, 포항 확인 후 교체)
    if (mode === 'watertemp') {
      const obsCode = params.obsCode || 'DT_0001';
      const reqDate = params.reqDate; // YYYYMMDD
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/surveyWaterTemp?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 스킨스쿠버지수 (파고/수온/풍속 종합) - placeCode 기본값: SS1
    if (mode === 'scuba') {
      const placeCode = params.placeCode || 'SS1';
      const reqDate = params.reqDate; // YYYYMMDDHH
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDDHH) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/fcstSkinScubav2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=10&placeCode=${placeCode}`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 서핑지수 (파고 포함) - placeCode 기본값: SR1
    if (mode === 'surfing') {
      const placeCode = params.placeCode || 'SR1';
      const reqDate = params.reqDate; // YYYYMMDD
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/fcstSurfingv2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=10&placeCode=${placeCode}`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'mode 파라미터 오류' }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
