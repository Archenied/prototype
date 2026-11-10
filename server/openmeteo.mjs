// 날씨 자세히: Open-Meteo (https://open-meteo.com, 키·계정 필요 없음, 무료·비상업용)
// 기상청 API에 없는 것들: 7일 시간별 강수·적설 확률, 기압, 체감온도, 바람 방향·돌풍, 구름(층별), 안개·시정,
// 이슬점, 자외선, 일출·일몰, 어는 높이, 뇌우 에너지(CAPE), 미세먼지·초미세먼지·오존 등 대기질.
// PC 서버와 휴대폰(브라우저 안)에서 똑같이 쓴다. (Open-Meteo는 브라우저에서 직접 불러도 됨)
import { ApiError, fromFetchError } from './errors.mjs';

const TIMEOUT_MS = 9000;
const HOURLY = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'precipitation_probability', 'precipitation', 'rain', 'showers', 'snowfall', 'snow_depth', 'weather_code', 'pressure_msl', 'surface_pressure', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'uv_index', 'is_day', 'freezing_level_height', 'cape', 'sunshine_duration'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max', 'apparent_temperature_min', 'sunrise', 'sunset', 'daylight_duration', 'sunshine_duration', 'uv_index_max', 'precipitation_sum', 'rain_sum', 'showers_sum', 'snowfall_sum', 'precipitation_hours', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant'];
const AIR = ['pm10', 'pm2_5', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'dust', 'aerosol_optical_depth'];

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw fromFetchError(e);
  }
  if (res.status === 429) throw new ApiError('quota');
  if (!res.ok) throw new ApiError('service');
  try { return await res.json(); } catch { throw new ApiError('service'); }
}

// Open-Meteo는 timezone=Asia/Seoul 이면 '2026-11-10T18:00' 처럼 한국 시각으로 준다.
const kst = (s) => Date.parse(s.length === 10 ? s + 'T00:00:00+09:00' : s + ':00+09:00');

// WMO 날씨 코드 → 앱 아이콘 코드 + 한국어 설명
const WMO = {
  0: ['clear', '맑음'], 1: ['clear', '대체로 맑음'], 2: ['partly', '구름 조금'], 3: ['overcast', '흐림'],
  45: ['fog', '안개'], 48: ['fog', '서리 안개'],
  51: ['rain', '약한 이슬비'], 53: ['rain', '이슬비'], 55: ['rain', '강한 이슬비'], 56: ['sleet', '어는 이슬비'], 57: ['sleet', '강한 어는 이슬비'],
  61: ['rain', '약한 비'], 63: ['rain', '비'], 65: ['rain', '강한 비'], 66: ['sleet', '어는 비'], 67: ['sleet', '강한 어는 비'],
  71: ['snow', '약한 눈'], 73: ['snow', '눈'], 75: ['snow', '많은 눈'], 77: ['snow', '싸락눈'],
  80: ['rain', '약한 소나기'], 81: ['rain', '소나기'], 82: ['rain', '강한 소나기'], 85: ['snow', '약한 눈보라'], 86: ['snow', '강한 눈보라'],
  95: ['storm', '뇌우'], 96: ['storm', '우박 뇌우'], 99: ['storm', '강한 우박 뇌우'],
};
export function wmo(code) { return WMO[code] || ['cloudy', '구름']; }

// 미세먼지 등급 (환경부 기준, ㎍/㎥)
export function pmGrade(kind, v) {
  if (v == null || !Number.isFinite(v)) return null;
  const cut = kind === 'pm25' ? [15, 35, 75] : [30, 80, 150];
  return v <= cut[0] ? 'good' : v <= cut[1] ? 'normal' : v <= cut[2] ? 'bad' : 'verybad';
}

function hourOf(h, i) {
  const [code, text] = wmo(h.weather_code[i]);
  return {
    t: kst(h.time[i]), code, text, wmo: h.weather_code[i],
    temp: h.temperature_2m[i], feels: h.apparent_temperature[i], hum: h.relative_humidity_2m[i], dew: h.dew_point_2m[i],
    pop: h.precipitation_probability[i], prcp: h.precipitation[i], rain: h.rain[i], showers: h.showers[i], snow: h.snowfall[i],
    snowDepth: h.snow_depth[i] != null ? Math.round(h.snow_depth[i] * 1000) / 10 : null, // m → cm
    pres: h.pressure_msl[i], presSfc: h.surface_pressure[i],
    cloud: h.cloud_cover[i], cloudLow: h.cloud_cover_low[i], cloudMid: h.cloud_cover_mid[i], cloudHigh: h.cloud_cover_high[i],
    vis: h.visibility[i], wind: h.wind_speed_10m[i], windDir: h.wind_direction_10m[i], gust: h.wind_gusts_10m[i],
    uv: h.uv_index[i], isDay: !!h.is_day[i], freezing: h.freezing_level_height[i], cape: h.cape[i], sun: h.sunshine_duration[i],
  };
}

export async function weatherDetail(lat, lon) {
  const ll = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&timezone=Asia%2FSeoul`;
  const fUrl = `https://api.open-meteo.com/v1/forecast?${ll}&forecast_days=7&wind_speed_unit=ms&hourly=${HOURLY.join(',')}&daily=${DAILY.join(',')}&current=${HOURLY.join(',')}`;
  const aUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${ll}&forecast_days=5&current=${AIR.join(',')}&hourly=pm10,pm2_5`;
  const [f, a] = await Promise.all([getJSON(fUrl), getJSON(aUrl).catch(() => null)]);
  if (!f?.hourly?.time?.length) throw new ApiError('service');

  const h = f.hourly;
  const hours = h.time.map((_, i) => hourOf(h, i));
  // 지금 기준값: current(15분 단위). 없으면 가까운 시간값.
  const c = f.current || {};
  const nowIdx = Math.max(0, hours.findIndex((x) => x.t > Date.now()) - 1);
  const cur = c.time ? hourOf(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, [v]])), 0) : { ...hours[nowIdx] };
  // 기압 변화 (3시간 전과 비교): 내려가면 날씨가 나빠지는 경우가 많다
  const p3 = hours[Math.max(0, nowIdx - 3)]?.pres;
  cur.presTrend = p3 != null && cur.pres != null ? Math.round((cur.pres - p3) * 10) / 10 : null;

  // 대기질: 날짜별 최고값
  const airDay = {};
  if (a?.hourly?.time) {
    a.hourly.time.forEach((t, i) => {
      const d = t.slice(0, 10);
      const o = (airDay[d] ||= { pm10: null, pm25: null });
      const p10 = a.hourly.pm10[i], p25 = a.hourly.pm2_5[i];
      if (p10 != null) o.pm10 = Math.max(o.pm10 ?? 0, p10);
      if (p25 != null) o.pm25 = Math.max(o.pm25 ?? 0, p25);
    });
  }

  const d = f.daily;
  const days = d.time.map((date, i) => {
    const [code, text] = wmo(d.weather_code[i]);
    const air = airDay[date] || {};
    return {
      date, t: kst(date), code, text, wmo: d.weather_code[i],
      max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], feelsMax: d.apparent_temperature_max[i], feelsMin: d.apparent_temperature_min[i],
      sunrise: d.sunrise[i] ? kst(d.sunrise[i]) : null, sunset: d.sunset[i] ? kst(d.sunset[i]) : null,
      daylight: d.daylight_duration[i], sunshine: d.sunshine_duration[i], uv: d.uv_index_max[i],
      prcp: d.precipitation_sum[i], rain: d.rain_sum[i], showers: d.showers_sum[i], snow: d.snowfall_sum[i], prcpHours: d.precipitation_hours[i],
      pop: d.precipitation_probability_max[i], windMax: d.wind_speed_10m_max[i], gustMax: d.wind_gusts_10m_max[i], windDir: d.wind_direction_10m_dominant[i],
      pm10: air.pm10 != null ? Math.round(air.pm10) : null, pm25: air.pm25 != null ? Math.round(air.pm25) : null,
    };
  });

  const ac = a?.current;
  const air = ac ? {
    at: ac.time ? kst(ac.time) : null,
    pm10: ac.pm10, pm25: ac.pm2_5, o3: ac.ozone, no2: ac.nitrogen_dioxide, so2: ac.sulphur_dioxide, co: ac.carbon_monoxide, dust: ac.dust, aod: ac.aerosol_optical_depth,
    pm10Grade: pmGrade('pm10', ac.pm10), pm25Grade: pmGrade('pm25', ac.pm2_5),
  } : null;

  return { now: cur, hours, days, air, elevation: f.elevation, model: 'Open-Meteo' };
}

// 달의 모양 (계산만으로 구함, 인터넷 필요 없음). 0 = 삭(안 보임), 0.5 = 보름
export function moonPhase(ms) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14); // 기준 삭
  const age = (((ms - ref) / 86400000) % synodic + synodic) % synodic;
  const phase = age / synodic;
  const names = ['삭 (새달)', '초승달', '상현달', '차오르는 달', '보름달', '기우는 달', '하현달', '그믐달'];
  return { age: Math.round(age * 10) / 10, phase, name: names[Math.round(phase * 8) % 8], lit: Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100) };
}
