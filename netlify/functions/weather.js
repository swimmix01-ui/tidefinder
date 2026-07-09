// 기상청/해양 데이터를 서버 사이드에서 대신 호출하는 프록시 함수
// apis.data.go.kr가 브라우저발 fetch를 WAF로 차단하는 문제를 우회하기 위해
// User-Agent 헤더를 추가하여 요청

exports.handler = async function (event) {
  const SERVICE_KEY = 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041';

  const params = event.queryStringParameters || {};
  const mode = params.mode || 'fcst'; // fcst | alert | watertemp | airtemp | airpress | scuba | surfing

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.data.go.kr/',
    'Accept': 'application/json, text/plain, */*'
  };

  try {
    // 1) 기존 단기예보 (변경 없음)
    if (mode === 'fcst') {
      const { nx, ny, base_date, base_time } = params;
      if (!nx || !ny || !base_date || !base_time) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'nx, ny, base_date, base_time 파라미터가 필요합니다.' })
        };
      }
      const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${SERVICE_KEY}&numOfRows=1000&pageNo=1&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 2) 기상특보 (풍랑주의보/경보 등)
    if (mode === 'alert') {
      const { stnId } = params;
      if (!stnId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'stnId(예보구역코드) 파라미터가 필요합니다.' })
        };
      }
      const url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${SERVICE_KEY}&numOfRows=10&pageNo=1&dataType=JSON&stnId=${stnId}`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 3) 조위관측소 실측 수온 (포항: DT_0091)
    if (mode === 'watertemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/surveyWaterTemp?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 4) 조위관측소 실측 기온 (포항: DT_0091)
    if (mode === 'airtemp') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/surveyAirTemp?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 5) 조위관측소 실측 기압 (포항: DT_0091)
    if (mode === 'airpress') {
      const obsCode = params.obsCode || 'DT_0091';
      const reqDate = params.reqDate;
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/surveyAirPress?serviceKey=${SERVICE_KEY}&type=json&obsCode=${obsCode}&reqDate=${reqDate}&min=60&pageNo=1&numOfRows=10`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 6) 스킨스쿠버지수 (placeCode 필요)
    if (mode === 'scuba') {
      const placeCode = params.placeCode || 'SS1';
      const reqDate = params.reqDate; // YYYYMMDDHH
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDDHH) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/fcstSkinScubav2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=10&placeCode=${placeCode}`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 7) 서핑지수 (파고 포함)
    if (mode === 'surfing') {
      const placeCode = params.placeCode || 'SR1';
      const reqDate = params.reqDate; // YYYYMMDD
      if (!reqDate) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'reqDate(YYYYMMDD) 필요' }) };
      }
      const url = `https://apis.data.go.kr/1192136/fcstSurfingv2?serviceKey=${SERVICE_KEY}&type=json&reqDate=${reqDate}&pageNo=1&numOfRows=10&placeCode=${placeCode}`;
      const res = await fetch(url, { headers: fetchHeaders });
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'mode 파라미터가 올바르지 않습니다. (fcst|alert|watertemp|airtemp|airpress|scuba|surfing)' }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
