// 기상청 단기예보(getVilageFcst)를 서버 사이드에서 대신 호출하는 프록시 함수
// apis.data.go.kr가 브라우저발 fetch를 WAF로 차단하는 문제를 우회하기 위함

exports.handler = async function (event) {
  const SERVICE_KEY = 'f26bd692b54db41eb90a99bed02f398b4a75fe6cab7c65dd03ebc8965f98b041';
  const { nx, ny, base_date, base_time } = event.queryStringParameters || {};

  if (!nx || !ny || !base_date || !base_time) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'nx, ny, base_date, base_time 파라미터가 필요합니다.' })
    };
  }

  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${SERVICE_KEY}&numOfRows=1000&pageNo=1&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;

  try {
    const res = await fetch(url);
    const text = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
