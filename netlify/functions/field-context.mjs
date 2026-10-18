// Public numerical model supplement. Separate from KHOA observations and drift forcing.
export async function handler(event) {
  const p = event.queryStringParameters || {},
    lat = Number(p.lat),
    lon = Number(p.lon);
  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "Cache-Control": "public, max-age=600",
  };
  if (
    !p.lat ||
    !p.lon ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < 0 ||
    lat > 90 ||
    lon < 0 ||
    lon > 180
  )
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "좌표 범위 오류" }),
    };
  const common = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    timezone: "Asia/Seoul",
    timeformat: "unixtime",
    forecast_days: "3",
  });
  const marine = new URL("https://marine-api.open-meteo.com/v1/marine");
  marine.search = common.toString();
  marine.searchParams.set(
    "hourly",
    "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,ocean_current_velocity,ocean_current_direction,sea_surface_temperature,sea_level_height_msl",
  );
  const weather = new URL("https://api.open-meteo.com/v1/forecast");
  weather.search = common.toString();
  weather.searchParams.set(
    "hourly",
    "visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation",
  );
  weather.searchParams.set("daily", "sunrise,sunset");
  weather.searchParams.set("wind_speed_unit", "ms");
  const get = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error("제공기관 응답 오류");
    return d;
  };
  const results = await Promise.allSettled([get(marine), get(weather)]);
  const body = {
    fetchedAt: new Date().toISOString(),
    requested: { lat, lon },
    source: "Open-Meteo / DWD / Météo-France / Copernicus / ECMWF",
    kind: "보조 수치모델 예보",
    license: "CC BY 4.0; 공개 API 비상업 사용 조건 적용",
    marine: results[0].status === "fulfilled" ? results[0].value : null,
    weather: results[1].status === "fulfilled" ? results[1].value : null,
    errors: results
      .map((r, i) =>
        r.status === "rejected"
          ? `${i === 0 ? "해양" : "기상"} 모델 수신 실패`
          : null,
      )
      .filter(Boolean),
  };
  return {
    statusCode: body.marine || body.weather ? 200 : 502,
    headers,
    body: JSON.stringify(body),
  };
}
