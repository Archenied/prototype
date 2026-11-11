// 날씨 자세히 (홈 → 날씨 탭): 7일 시간별(옆으로 넘김) · 7일 요약 · 고른 시간의 모든 값 · 대기질 · 해·달
// 데이터: /api/weather/detail (Open-Meteo). 기상청 실황 카드는 home.js에 그대로 있다.
import { h, swap } from '../ui.js';
import { icon, WX_ICON } from '../icons.js';
import { isEn } from '../i18n.js';
import { now as clockNow } from '../clock.js';

const L = (ko, en) => (isEn() ? en : ko);
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r0 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const dash = '—';

// 화면을 다시 그려도(10초마다) 옆으로 넘긴 위치·고른 시간을 그대로 유지
const ui = { hourScroll: null, dayScroll: 0, sel: null, outer: 0 };

// 세로로 내린 위치도 유지 (home.js의 .wx-detail)
export function keepOuterScroll(el) {
  // requestAnimationFrame은 창이 뒤에 있으면 멈춰서 타이머를 쓴다.
  // 새 칸이 붙을 때 생기는 scroll 이벤트가 저장값을 덮지 않게, 되돌린 뒤에 듣기 시작한다.
  setTimeout(() => {
    if (!el.isConnected) return;
    el.scrollTop = ui.outer;
    setTimeout(() => el.addEventListener('scroll', () => { if (el.isConnected) ui.outer = el.scrollTop; }, { passive: true }), 50);
  }, 0);
  return el;
}

/* ───────── 풀이 도우미 ───────── */
const DIR_KO = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
const DIR_EN = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function dirName(deg) {
  if (deg == null) return dash;
  const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return isEn() ? DIR_EN[i] : DIR_KO[i];
}
// 바람은 '불어오는 쪽'으로 이름을 붙인다 (북서풍 = 북서쪽에서 남동쪽으로)
export function windText(deg, speed) {
  if (deg == null) return dash;
  if (speed != null && speed < 0.5) return L('바람이 거의 없어요 (방향 없음)', 'Almost calm (no direction)');
  const from = dirName(deg), to = dirName(deg + 180);
  return isEn() ? `${from} wind (${from} → ${to})` : `${from}풍 (${from} → ${to})`;
}
function arrow(deg, size = 18) {
  // 화살표는 바람이 '불어 가는' 쪽을 가리킨다
  const el = h('span.wind-arrow', { 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px', transform: `rotate(${(deg ?? 0) + 180}deg)` } });
  el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M6 10l6-6 6 6"/></svg>';
  return el;
}
function beaufort(ms) {
  if (ms == null) return '';
  const steps = [[0.3, '고요', 'Calm'], [1.6, '실바람', 'Light air'], [3.4, '남실바람', 'Light breeze'], [5.5, '산들바람', 'Gentle breeze'], [8, '건들바람', 'Moderate breeze'], [10.8, '흔들바람', 'Fresh breeze'], [13.9, '된바람', 'Strong breeze'], [17.2, '센바람', 'Near gale'], [20.8, '큰바람', 'Gale'], [24.5, '큰센바람', 'Strong gale'], [28.5, '노대바람', 'Storm'], [32.7, '왕바람', 'Violent storm']];
  for (const [max, ko, en] of steps) if (ms < max) return L(ko, en);
  return L('싹쓸바람 (태풍급)', 'Hurricane force');
}
function uvText(uv) {
  if (uv == null) return '';
  return uv < 3 ? L('낮음', 'Low') : uv < 6 ? L('보통', 'Moderate') : uv < 8 ? L('높음', 'High') : uv < 11 ? L('매우 높음', 'Very high') : L('위험', 'Extreme');
}
function visText(m) {
  if (m == null) return dash;
  const km = m / 1000;
  const v = km >= 10 ? `${Math.round(km)}km` : `${r1(km)}km`;
  if (m < 200) return `${v} · ${L('짙은 안개', 'Dense fog')}`;
  if (m < 1000) return `${v} · ${L('안개', 'Fog')}`;
  if (m < 5000) return `${v} · ${L('박무·연무 (뿌얘요)', 'Mist/haze')}`;
  return `${v} · ${L('잘 보여요', 'Clear')}`;
}
function fogLevel(x) {
  if (x.wmo === 45 || x.wmo === 48 || (x.vis != null && x.vis < 1000)) return L('안개 있음', 'Foggy');
  if (x.vis != null && x.vis < 5000) return L('약간 뿌얘요', 'Hazy');
  return L('안개 없음', 'No fog');
}
function presText(p, trend) {
  if (p == null) return dash;
  const lvl = p >= 1020 ? L('높음 · 맑은 날이 많아요', 'High · usually fair') : p <= 1005 ? L('낮음 · 흐리거나 비 올 수 있어요', 'Low · clouds/rain likely') : L('보통', 'Normal');
  const tr = trend == null ? '' : trend > 0.5 ? L(' · 오르는 중 ↑', ' · rising ↑') : trend < -0.5 ? L(' · 내려가는 중 ↓', ' · falling ↓') : L(' · 그대로', ' · steady');
  return `${lvl}${tr}`;
}
function capeText(c) {
  if (c == null) return dash;
  return c < 300 ? L('낮음', 'Low') : c < 1000 ? L('보통', 'Moderate') : c < 2500 ? L('높음', 'High') : L('매우 높음', 'Very high');
}
const PM = { good: ['좋음', 'Good'], normal: ['보통', 'Moderate'], bad: ['나쁨', 'Bad'], verybad: ['매우 나쁨', 'Very bad'] };
function pmGrade(kind, v) {
  if (v == null) return null;
  const cut = kind === 'pm25' ? [15, 35, 75] : [30, 80, 150];
  return v <= cut[0] ? 'good' : v <= cut[1] ? 'normal' : v <= cut[2] ? 'bad' : 'verybad';
}
function pmChip(kind, v) {
  const g = pmGrade(kind, v);
  if (!g) return h('span', dash);
  return h(`span.pm.${g}`, `${Math.round(v)} · ${L(...PM[g])}`);
}
const fmtHM = (ms) => (ms ? new Intl.DateTimeFormat(isEn() ? 'en-US' : 'ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(ms) : dash);
const hm = (sec) => (sec == null ? dash : L(`${Math.floor(sec / 3600)}시간 ${Math.round((sec % 3600) / 60)}분`, `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`));
const kstDate = (ms) => new Date(ms + 9 * 3600e3); // UTC 메서드로 한국 날짜·시각 읽기
const WD_KO = ['일', '월', '화', '수', '목', '금', '토'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayLabel(ms, nowMs) {
  const d = kstDate(ms), n = kstDate(nowMs);
  const diff = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86400e3);
  if (diff === 0) return L('오늘', 'Today');
  if (diff === 1) return L('내일', 'Tomorrow');
  return isEn() ? WD_EN[d.getUTCDay()] : WD_KO[d.getUTCDay()] + '요일';
}
const md = (ms) => { const d = kstDate(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

function moon(ms) {
  const syn = 29.530588853;
  const age = (((ms - Date.UTC(2000, 0, 6, 18, 14)) / 86400e3) % syn + syn) % syn;
  const p = age / syn;
  const names = [['삭 (안 보여요)', 'New moon'], ['초승달', 'Waxing crescent'], ['상현달', 'First quarter'], ['차오르는 달', 'Waxing gibbous'], ['보름달', 'Full moon'], ['기우는 달', 'Waning gibbous'], ['하현달', 'Last quarter'], ['그믐달', 'Waning crescent']];
  return { age: r1(age), name: L(...names[Math.round(p * 8) % 8]), lit: Math.round((1 - Math.cos(p * 2 * Math.PI)) / 2 * 100) };
}

function wxIcon(code, cls = 'wx-icon') {
  return icon(WX_ICON[code] || 'cloud', cls);
}

/* ───────── 화면 조각 ───────── */
// 값마다 어디서 온 값인지 꼬리표를 붙인다.
//  실측 = 기상청 관측소가 실제로 잰 값 · 예보 = 기상청 예보 · 계산 = 실측값(또는 천문)으로 공식에 넣어 구한 값 · 모델 = 컴퓨터 모델(Open-Meteo) 추정
export function vtag(kind) {
  const T = {
    obs: [L('실측', 'Measured'), L('기상청 관측소가 실제로 잰 값', 'Actually measured at the KMA station')],
    fc: [L('예보', 'Forecast'), L('기상청 단기예보 값', 'KMA short-range forecast')],
    calc: [L('계산', 'Calculated'), L('실측값(또는 천문 계산)을 공식에 넣어 구한 값', 'Worked out by a formula from measured values (or astronomy)')],
    model: [L('모델', 'Model'), L('컴퓨터 날씨 모델(Open-Meteo)이 추정한 값 · 실제로 잰 값이 아니에요', 'Estimated by a computer weather model (Open-Meteo), not measured')],
  }[kind];
  return h(`span.vtag.${kind}`, { title: T[1] }, T[0]);
}

function stat(k, v, sub, kind = 'model') {
  return h('div.wx-stat', h('div.k', k, ' ', vtag(kind)), h('div.v', v ?? dash), sub ? h('div.s', sub) : null);
}

// 기상청 실측값 (홈 왼쪽 카드와 같은 값). 데모 데이터면 null.
export function observedOf(v) {
  const d = v?.data;
  if (!d || v.mode === 'demo' || !Number.isFinite(d.temp)) return null;
  return { temp: d.temp, humidity: Number.isFinite(d.humidity) ? d.humidity : null, wind: Number.isFinite(d.wind) ? d.wind : 0, windDir: d.windDir ?? null, rain1h: d.rain1h || 0, at: d.observedAt };
}

// 체감온도: 기상청 공식. 10°C 이하이고 바람 4.68km/h(1.3m/s) 이상이면 겨울(바람 체감), 5~9월이면 여름(습도 체감), 그 밖에는 기온 그대로.
export function feelsFrom(o, nowMs) {
  const T = o.temp, RH = o.humidity, kmh = (o.wind || 0) * 3.6;
  const month = new Date(nowMs + 9 * 3600e3).getUTCMonth() + 1;
  if (T <= 10 && kmh >= 4.68) {
    const p = Math.pow(kmh, 0.16);
    return 13.12 + 0.6215 * T - 11.37 * p + 0.3965 * T * p;
  }
  if (month >= 5 && month <= 9 && RH != null) {
    const Tw = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) - Math.atan(RH - 1.67633) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
    return -0.2442 + 0.55399 * Tw + 0.45535 * T - 0.0022 * Tw * Tw + 0.00278 * Tw * T + 3.0;
  }
  return T;
}
// 이슬점 (Magnus 공식): 실측 기온·습도로 구한다
export function dewFrom(T, RH) {
  if (T == null || !RH) return null;
  const g = Math.log(RH / 100) + (17.62 * T) / (243.12 + T);
  return (243.12 * g) / (17.62 - g);
}

// 고른 시간(또는 지금)의 모든 값. obs가 있으면 '지금'은 실제로 잰 값을 먼저 보여 주고, 모델 값은 작게 옆에 둔다.
function allValues(x, title, obs) {
  const unit = (v, u) => (v == null ? dash : `${v}${u}`);
  const mdl = (v, u) => (v == null ? '' : L(`모델 ${v}${u}`, `model ${v}${u}`));
  const join = (...a) => a.filter(Boolean).join(' · ');
  const feelsObs = obs ? feelsFrom(obs, clockNow()) : null;
  const dewObs = obs ? dewFrom(obs.temp, obs.humidity) : null;
  const wDir = obs && obs.windDir != null ? obs.windDir : x.windDir;
  const wSpd = obs ? obs.wind : x.wind;
  return h(
    'section.card',
    { 'aria-label': title },
    h('div.card-title', icon('info', 'icon-sm'), h('span.grow', title)),
    h('div.vlegend',
      vtag('obs'), L('기상청이 실제로 잰 값', 'measured'),
      vtag('calc'), L('실측값으로 구한 값', 'from measured values'),
      vtag('fc'), L('기상청 예보', 'KMA forecast'),
      vtag('model'), L('컴퓨터 모델 추정', 'computer-model estimate')),
    h(
      'div.wx-all',
      obs ? stat(L('기온', 'Temperature'), `${r1(obs.temp)}°`, mdl(r1(x.temp), '°'), 'obs') : stat(L('기온', 'Temperature'), unit(r1(x.temp), '°')),
      obs
        ? stat(L('체감온도', 'Feels like'), `${r1(feelsObs)}°`, join(L('실측 기온·습도·바람으로 계산 (기상청 공식)', 'From measured temperature, humidity and wind (KMA formula)'), mdl(r1(x.feels), '°')), 'calc')
        : stat(L('체감온도', 'Feels like'), unit(r1(x.feels), '°'), x.feels != null && x.temp != null ? (x.feels < x.temp - 1 ? L('바람 때문에 더 추워요', 'Wind makes it colder') : x.feels > x.temp + 1 ? L('습해서 더 더워요', 'Humidity makes it warmer') : L('기온과 비슷해요', 'About the same')) : null),
      stat(L('강수확률 (비·눈)', 'Chance of rain/snow'), unit(r0(x.pop), '%')),
      obs
        ? stat(L('1시간 강수량', 'Rain, last hour'), obs.rain1h ? `${obs.rain1h}mm` : L('없음', 'None'), x.prcp ? mdl(`${r1(x.prcp)}`, 'mm') : null, 'obs')
        : stat(L('강수량', 'Precipitation'), x.prcp ? `${r1(x.prcp)}mm` : L('없음', 'None'), x.prcp ? `${L('비', 'Rain')} ${r1(x.rain)} · ${L('소나기', 'Showers')} ${r1(x.showers)}mm` : null),
      stat(L('눈 (새로 쌓임)', 'Snowfall'), x.snow ? `${r1(x.snow)}cm` : L('없음', 'None'), x.snowDepth ? `${L('쌓인 눈', 'Snow depth')} ${r1(x.snowDepth)}cm` : null),
      obs && obs.humidity != null
        ? stat(L('습도', 'Humidity'), `${r0(obs.humidity)}%`, mdl(r0(x.hum), '%'), 'obs')
        : stat(L('습도', 'Humidity'), unit(r0(x.hum), '%')),
      obs && dewObs != null
        ? stat(L('이슬점', 'Dew point'), `${r1(dewObs)}°`, join(L('실측 기온·습도로 계산 · 이 온도까지 내려가면 이슬·안개가 생겨요', 'From measured temperature and humidity · dew/fog forms at this temperature'), mdl(r1(x.dew), '°')), 'calc')
        : stat(L('이슬점', 'Dew point'), unit(r1(x.dew), '°'), L('이 온도까지 내려가면 이슬·안개가 생겨요', 'Dew/fog forms at this temperature')),
      stat(L('기압 (해면)', 'Air pressure (sea level)'), x.pres != null ? `${r1(x.pres)} hPa` : dash, presText(x.pres, x.presTrend)),
      stat(L('기압 (지표)', 'Air pressure (surface)'), x.presSfc != null ? `${r1(x.presSfc)} hPa` : dash),
      h('div.wx-stat', h('div.k', L('바람', 'Wind'), ' ', vtag(obs ? 'obs' : 'model')), h('div.v.row', wSpd != null && wSpd < 0.5 ? null : arrow(wDir), `${r1(wSpd) ?? dash}m/s`), h('div.s', join(`${windText(wDir, wSpd)} · ${beaufort(wSpd)}`, obs ? mdl(r1(x.wind), 'm/s') : ''))),
      stat(L('돌풍 (순간 최대)', 'Gusts'), unit(r1(x.gust), 'm/s')),
      stat(L('구름 양', 'Cloud cover'), unit(r0(x.cloud), '%'), `${L('낮은', 'Low')} ${r0(x.cloudLow) ?? dash}% · ${L('중간', 'Mid')} ${r0(x.cloudMid) ?? dash}% · ${L('높은', 'High')} ${r0(x.cloudHigh) ?? dash}%`),
      stat(L('안개·시정 (보이는 거리)', 'Fog & visibility'), fogLevel(x), visText(x.vis)),
      stat(L('자외선 지수', 'UV index'), x.uv != null ? `${r1(x.uv)}` : dash, uvText(x.uv)),
      stat(L('햇빛 든 시간', 'Sunshine'), x.sun != null ? L(`${Math.round(x.sun / 60)}분 / 60분`, `${Math.round(x.sun / 60)} of 60 min`) : dash),
      stat(L('어는 높이', 'Freezing level'), x.freezing != null ? `${Math.round(x.freezing).toLocaleString()}m` : dash, L('이보다 높은 하늘은 0°C 아래예요', 'Air above this is below 0°C')),
      stat(L('뇌우 에너지 (CAPE)', 'Storm energy (CAPE)'), x.cape != null ? `${Math.round(x.cape)} J/kg` : dash, L(`천둥·번개 가능성 ${capeText(x.cape)}`, `Thunderstorm potential: ${capeText(x.cape)}`)),
      stat(L('낮/밤', 'Day/night'), x.isDay ? L('낮', 'Day') : L('밤', 'Night'), null, 'calc'),
    ),
  );
}

function hourStrip(hours, nowMs, onPick) {
  const start = Math.max(0, hours.findIndex((x) => x.t + 3600e3 > nowMs));
  const list = hours.slice(start);
  const maxP = Math.max(1, ...list.map((x) => x.prcp || 0));
  const strip = h('div.hstrip', { role: 'listbox', 'aria-label': L('7일 시간별 예보 (옆으로 넘기세요)', '7-day hourly forecast (scroll sideways)'), tabindex: '0' });
  let lastDay = null;
  for (const x of list) {
    const d = kstDate(x.t);
    const day = d.getUTCDate();
    const newDay = day !== lastDay;
    lastDay = day;
    const selected = ui.sel === x.t;
    const snowy = x.snow > 0;
    const item = h(
      `button.hcell${selected ? '.sel' : ''}${newDay ? '.newday' : ''}`,
      { type: 'button', role: 'option', 'aria-selected': selected ? 'true' : 'false', dataset: { t: String(x.t) }, onClick: () => onPick(x.t) },
      h('div.hday', newDay ? `${dayLabel(x.t, nowMs)} ${md(x.t)}` : ''),
      h('div.h', x.t <= nowMs ? L('지금', 'Now') : L(`${d.getUTCHours()}시`, `${d.getUTCHours()}:00`)),
      wxIcon(x.code),
      h('div.t', `${Math.round(x.temp)}°`),
      h('div.feels', `${L('체감', 'Feels')} ${Math.round(x.feels)}°`),
      h('div.popbar', { title: L('강수확률', 'Chance of rain/snow') }, h('span', { style: { height: `${Math.max(2, x.pop || 0)}%` } })),
      h('div.pop', `${x.pop ?? 0}%`),
      h('div.amt', snowy ? `❄${r1(x.snow)}cm` : x.prcp ? `${r1(x.prcp)}mm` : ''),
      h('div.w', arrow(x.windDir, 14), `${Math.round(x.wind)}`),
    );
    void maxP;
    strip.append(item);
  }
  return strip;
}

function dayStrip(days, nowMs, onPickDay) {
  const strip = h('div.dstrip', { 'aria-label': L('7일 예보', '7-day forecast') });
  for (const d of days) {
    strip.append(h(
      'button.dcell',
      { type: 'button', onClick: () => onPickDay(d) },
      h('div.dn', dayLabel(d.t, nowMs)), h('div.dd', md(d.t)),
      wxIcon(d.code),
      h('div.dc', d.text),
      h('div.dt', h('b', `${Math.round(d.max)}°`), ' / ', `${Math.round(d.min)}°`),
      h('div.df', `${L('체감', 'Feels')} ${Math.round(d.feelsMax)}° / ${Math.round(d.feelsMin)}°`),
      h('div.dp', `☔ ${d.pop ?? 0}%`),
      h('div.da', d.snow ? `❄ ${r1(d.snow)}cm` : d.prcp ? `${r1(d.prcp)}mm · ${d.prcpHours}${L('시간', 'h')}` : L('비·눈 없음', 'No rain/snow')),
      h('div.dw', arrow(d.windDir, 13), `${L('최대', 'Max')} ${r1(d.windMax)} · ${L('돌풍', 'Gust')} ${r1(d.gustMax)}m/s`),
      h('div.du', `UV ${r1(d.uv) ?? dash} ${uvText(d.uv)}`),
      d.pm10 != null ? h('div.dm', L('미세', 'PM10'), ' ', pmChip('pm10', d.pm10)) : null,
      d.pm25 != null ? h('div.dm', L('초미세', 'PM2.5'), ' ', pmChip('pm25', d.pm25)) : null,
      h('div.ds', `☀ ${fmtHM(d.sunrise)} – ${fmtHM(d.sunset)}`),
    ));
  }
  return strip;
}

function airCard(air, today, nowMs) {
  const m = moon(nowMs);
  return h(
    'section.card',
    { 'aria-label': L('대기질 · 해와 달', 'Air quality · sun & moon') },
    h('div.card-title', icon('wind', 'icon-sm'), h('span.grow', L('대기질 · 해와 달', 'Air quality · sun & moon'))),
    h(
      'div.wx-all',
      air ? h('div.wx-stat', h('div.k', L('미세먼지 PM10', 'Fine dust PM10')), h('div.v', pmChip('pm10', air.pm10)), h('div.s', '㎍/㎥')) : null,
      air ? h('div.wx-stat', h('div.k', L('초미세먼지 PM2.5', 'Ultrafine dust PM2.5')), h('div.v', pmChip('pm25', air.pm25)), h('div.s', '㎍/㎥')) : null,
      air ? stat(L('오존 O₃', 'Ozone O₃'), air.o3 != null ? `${Math.round(air.o3)} ㎍/㎥` : dash) : null,
      air ? stat(L('이산화질소 NO₂', 'Nitrogen dioxide NO₂'), air.no2 != null ? `${Math.round(air.no2)} ㎍/㎥` : dash) : null,
      air ? stat(L('아황산가스 SO₂', 'Sulphur dioxide SO₂'), air.so2 != null ? `${Math.round(air.so2)} ㎍/㎥` : dash) : null,
      air ? stat(L('일산화탄소 CO', 'Carbon monoxide CO'), air.co != null ? `${Math.round(air.co)} ㎍/㎥` : dash) : null,
      air ? stat(L('황사·먼지', 'Dust'), air.dust != null ? `${Math.round(air.dust)} ㎍/㎥` : dash) : null,
      air ? stat(L('대기 탁도 (AOD)', 'Haze (AOD)'), air.aod != null ? `${r1(air.aod * 10) / 10}` : dash, L('높을수록 하늘이 뿌얘요', 'Higher = hazier sky')) : null,
      !air ? stat(L('대기질', 'Air quality'), L('정보 없음', 'Not available')) : null,
      today ? stat(L('해 뜨는 시각', 'Sunrise'), fmtHM(today.sunrise), null, 'calc') : null,
      today ? stat(L('해 지는 시각', 'Sunset'), fmtHM(today.sunset), null, 'calc') : null,
      today ? stat(L('낮 길이', 'Daylight'), hm(today.daylight), `${L('햇빛', 'Sunshine')} ${hm(today.sunshine)}`, 'calc') : null,
      stat(L('달', 'Moon'), m.name, L(`월령 ${m.age}일 · 밝은 부분 ${m.lit}%`, `Age ${m.age} days · ${m.lit}% lit`), 'calc'),
    ),
  );
}

/** 날씨 탭 아래쪽에 붙는 자세한 날씨. v = view('wxd:…') */
export function weatherMore(v, metaEl, obs = null) {
  const wrap = h('div.wx-more');
  if (!v.data) {
    wrap.append(h('section.card', h('div.card-title', icon('clock', 'icon-sm'), L('7일 · 자세한 날씨', '7 days · details')),
      h('p.muted', { style: { marginTop: '10px' } }, v.error ? L('자세한 날씨를 불러오지 못했어요. 잠시 후 다시 시도해요.', 'Could not load details. Will retry soon.') : L('불러오는 중…', 'Loading…'))));
    return wrap;
  }
  const d = v.data;
  const nowMs = clockNow();
  const detailSlot = h('div');
  let strip;
  const pick = (t) => {
    ui.sel = t;
    for (const c of strip.querySelectorAll('.hcell')) {
      const on = Number(c.dataset.t) === t;
      c.classList.toggle('sel', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    showDetail();
  };
  const showDetail = () => {
    const x = (ui.sel != null && d.hours.find((y) => y.t === ui.sel)) || null;
    if (!x || x.t <= nowMs) {
      swap(detailSlot, allValues({ ...d.now }, L('지금 날씨 · 모든 값', 'Right now · all values'), obs));
    } else {
      const k = kstDate(x.t);
      swap(detailSlot, allValues(x, L(`${dayLabel(x.t, nowMs)} ${md(x.t)} ${k.getUTCHours()}시 · 모든 값 (예보)`, `${dayLabel(x.t, nowMs)} ${md(x.t)} ${k.getUTCHours()}:00 · all values (forecast)`)));
    }
  };
  strip = hourStrip(d.hours, nowMs, pick);
  const days = dayStrip(d.days, nowMs, (day) => {
    // 그날 낮 12시를 골라서 시간별 줄을 그곳으로 넘긴다
    const noon = day.t + 12 * 3600e3;
    const target = d.hours.find((y) => y.t >= Math.max(noon, nowMs)) || d.hours.find((y) => y.t >= day.t);
    if (!target) return;
    pick(target.t);
    const cell = strip.querySelector(`[data-t="${target.t}"]`);
    if (cell) strip.scrollTo({ left: cell.offsetLeft - strip.clientWidth / 2 + cell.clientWidth / 2, behavior: 'smooth' });
  });
  showDetail();
  wrap.append(
    h('section.card', { 'aria-label': L('7일 시간별', '7-day hourly') },
      h('div.card-title', icon('clock', 'icon-sm'), h('span.grow', L('7일 시간별 · 옆으로 넘기세요', '7-day hourly · scroll sideways')), h('span.small.muted', L('누르면 그 시간의 모든 값', 'Tap for all values'))),
      strip,
      h('p.small.faint', { style: { marginTop: '8px' } }, L('막대 = 비·눈 올 확률 · ❄ = 쌓일 눈 · 화살표 = 바람이 불어 가는 쪽 (숫자 m/s)', 'Bar = chance of rain/snow · ❄ = snowfall · arrow = where the wind blows to (m/s)'))),
    h('section.card', { 'aria-label': L('7일 예보', '7-day forecast') },
      h('div.card-title', icon('sun', 'icon-sm'), h('span.grow', L('7일 예보', '7-day forecast')), h('span.small.muted', L('누르면 그날 시간별로', 'Tap to jump'))),
      days),
    detailSlot,
    airCard(d.air, d.days[0], nowMs),
    metaEl,
  );
  // 다시 그려도 넘긴 위치 유지 (처음에는 '지금'이 맨 앞)
  setTimeout(() => {
    if (!strip.isConnected) return;
    if (ui.hourScroll != null) strip.scrollLeft = ui.hourScroll;
    days.scrollLeft = ui.dayScroll;
    setTimeout(() => {
      strip.addEventListener('scroll', () => { if (strip.isConnected) ui.hourScroll = strip.scrollLeft; }, { passive: true });
      days.addEventListener('scroll', () => { if (days.isConnected) ui.dayScroll = days.scrollLeft; }, { passive: true });
    }, 50);
  }, 0);
  return wrap;
}
