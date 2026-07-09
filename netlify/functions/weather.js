// 기상청/해양 데이터를 서버 사이드에서 대신 호출하는 프록시 함수
exports.handler = async function (event) {
  const SERVICE_KEY = 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041'; // 기상청
  const KHOA_KEY = 'srQx3b3XW8NV9RpGp9CQ=='; // 국립해양조사원 (index.html과 동일 키)

  const params = event.queryStringParameters || {};
  const mode = params.mode || 'fcst'; // fcst | alert | tide | wave | seafog

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // 1) 기존 단기예보 (변경 없음)
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

    // 2) 기상특보 (풍랑주의보/경보 등)
    if (mode === 'alert') {
      const { stnId } = params;
      if (!stnId) {
        return { statusCode: 400, headers: corsHeaders,
          body: JSON.stringify({ error: 'stnId(예보구역코드) 파라미터가 필요합니다.' }) };
      }
      const url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${SERVICE_KEY}&numOfRows=10&pageNo=1&dataType=JSON&stnId=${stnId}`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 3) 조위관측소 최신 관측데이터 (조위/기온/수온/염분/기압/풍향풍속) - 기본값: 포항(DT_0091)
    if (mode === 'tide') {
      const obsCode = params.obsCode || 'DT_0091';
      const url = `http://www.khoa.go.kr/api/oceangrid/tideObsRecent/search.do?ServiceKey=${KHOA_KEY}&ObsCode=${obsCode}&ResultType=json`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 4) 부이관측소 실측 파고 (기본값: 고래불해수욕장 TW_0095, 포항에서 최근접)
    if (mode === 'wave') {
      const obsCode = params.obsCode || 'TW_0095';
      const date = params.date; // YYYYMMDD
      if (!date) {
        return { statusCode: 400, headers: corsHeaders,
          body: JSON.stringify({ error: 'date(YYYYMMDD) 파라미터가 필요합니다.' }) };
      }
      const url = `http://www.khoa.go.kr/api/oceangrid/obsWaveHight/search.do?ServiceKey=${KHOA_KEY}&ObsCode=${obsCode}&Date=${date}&ResultType=json`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    // 5) 해무관측소 (수온/기온/풍향풍속/기압/시정) - 전체 관측소 한번에 조회
    if (mode === 'seafog') {
      const url = `http://www.khoa.go.kr/api/oceangrid/seafogReal/search.do?ServiceKey=${KHOA_KEY}&ResultType=json`;
      const res = await fetch(url);
      const text = await res.text();
      return { statusCode: 200, headers: corsHeaders, body: text };
    }

    return { statusCode: 400, headers: corsHeaders,
      body: JSON.stringify({ error: 'mode 파라미터가 올바르지 않습니다. (fcst|alert|tide|wave|seafog)' }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
