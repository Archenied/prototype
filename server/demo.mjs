// 데모 공급자: API 키가 없을 때 쓰는 그럴듯한 가짜 데이터.
// 시간에 따라 값이 바뀌어 자동 갱신·카운트다운을 확인할 수 있다.
import { ApiError } from './errors.mjs';
import { REGIONS, PLACES, BUS_STOPS, STATIONS, SIGNALS, norm, distanceKm, isSupportedAddress, inServiceArea } from './places.mjs';

export const SOURCE = '데모 데이터 (API 키 없음)';

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function kstHour(now = Date.now()) {
  return new Date(now + 9 * 3600e3).getUTCHours();
}

function matchAll(q, ...fields) {
  const n = norm(q);
  if (!n) return false;
  return fields.some((f) => norm(f).includes(n));
}

export async function searchRegions(q) {
  return REGIONS.filter((r) => matchAll(q, r.name))
    .slice(0, 15)
    .map((r) => ({ id: 'r-' + hash(r.name), name: r.name, address: r.name, lat: r.lat, lon: r.lon, supported: isSupportedAddress(r.name) }));
}

export async function reverseRegion(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const r of REGIONS) {
    const d = distanceKm({ lat, lon }, r);
    if (d < bestD) { bestD = d; best = r; }
  }
  if (!best || bestD > 30) return { name: '알 수 없는 지역', supported: inServiceArea(lat, lon) };
  return { name: best.name, supported: isSupportedAddress(best.name) };
}

export async function searchPlaces(q) {
  const list = [...PLACES, ...REGIONS.map((r) => ({ name: r.name.split(' ').slice(-1)[0], address: r.name, lat: r.lat, lon: r.lon }))];
  const seen = new Set();
  return list
    .filter((p) => matchAll(q, p.name, p.address))
    .filter((p) => (seen.has(p.name + p.address) ? false : seen.add(p.name + p.address)))
    .slice(0, 15)
    .map((p) => ({ id: 'p-' + hash(p.name + p.address), name: p.name, address: p.address, lat: p.lat, lon: p.lon, supported: isSupportedAddress(p.address) }));
}

const CONDITIONS = [
  { code: 'clear', text: '맑음' },
  { code: 'partly', text: '구름 조금' },
  { code: 'cloudy', text: '구름 많음' },
  { code: 'overcast', text: '흐림' },
  { code: 'rain', text: '비' },
];

export async function weather(lat, lon) {
  const now = Date.now();
  const hourSlot = Math.floor(now / 3600e3);
  const seed = hash(`${lat.toFixed(1)},${lon.toFixed(1)}`);
  const month = new Date(now + 9 * 3600e3).getUTCMonth();
  const seasonBase = [-2, 1, 7, 13, 18, 23, 26, 27, 22, 15, 8, 1][month];
  const h = kstHour(now);
  const daily = -4 * Math.cos(((h - 3) / 24) * 2 * Math.PI);
  const jitter = ((seed + hourSlot * 7) % 5) - 2;
  const temp = Math.round((seasonBase + daily + jitter) * 10) / 10;
  const cond = CONDITIONS[(seed + Math.floor(hourSlot / 3)) % CONDITIONS.length];
  const hourly = [];
  for (let i = 1; i <= 6; i++) {
    const hh = (h + i) % 24;
    const c = CONDITIONS[(seed + Math.floor((hourSlot + i) / 3)) % CONDITIONS.length];
    hourly.push({
      hour: hh,
      temp: Math.round(seasonBase - 4 * Math.cos(((hh - 3) / 24) * 2 * Math.PI) + jitter),
      code: c.code,
      text: c.text,
      pop: c.code === 'rain' ? 60 + ((seed + i) % 30) : (seed + i * 13) % 20,
    });
  }
  return {
    temp,
    code: cond.code,
    text: cond.text,
    pop: cond.code === 'rain' ? 70 : (seed + hourSlot) % 20,
    humidity: 40 + ((seed + hourSlot) % 40),
    wind: Math.round((1 + ((seed + hourSlot) % 50) / 10) * 10) / 10,
    rain1h: cond.code === 'rain' ? 1 + ((seed + hourSlot) % 4) : 0,
    hourly,
    observedAt: Math.floor(now / 600e3) * 600e3,
  };
}

const TYPE_LABEL = { bus: '버스 정류장', subway: '지하철역', signal: '신호등' };

function busResult(s) {
  return { type: 'bus', id: 'bus:' + s.arsId, name: s.name, sub: `${s.dir} · 정류소 ${s.arsId}`, lat: s.lat, lon: s.lon, supported: true, ref: { arsId: s.arsId } };
}
function stationResult(s) {
  return { type: 'subway', id: 'subway:' + s.name, name: s.name + (s.name.endsWith('역') ? '' : '역'), sub: s.lines.join(' · '), lat: s.lat, lon: s.lon, supported: true, ref: { station: s.name, lines: s.lines } };
}
function signalResult(s) {
  return { type: 'signal', id: 'signal:' + s.id, name: s.name, sub: s.supported ? '보행 신호 정보 제공' : '신호 정보 미제공 지점', lat: s.lat, lon: s.lon, supported: true, ref: { signalId: s.id } };
}

export async function searchTransit(type, q) {
  if (type === 'bus') return BUS_STOPS.filter((s) => matchAll(q, s.name, s.arsId, s.dir)).slice(0, 15).map(busResult);
  if (type === 'subway') return STATIONS.filter((s) => matchAll(q, s.name, s.name + '역', ...s.lines)).slice(0, 15).map(stationResult);
  if (type === 'signal') return SIGNALS.filter((s) => matchAll(q, s.name)).slice(0, 15).map(signalResult);
  throw new ApiError('badrequest', TYPE_LABEL[type] || type);
}

export async function nearbyTransit(type, lat, lon) {
  const here = { lat, lon };
  const pick = (list, maxKm) =>
    list
      .map((s) => ({ s, d: distanceKm(here, s) }))
      .filter((x) => x.d <= maxKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);
  const withDist = (r, d) => ({ ...r, distanceM: Math.round(d * 1000) });
  if (type === 'bus') return pick(BUS_STOPS.filter((s) => !s.removed), 1.5).map((x) => withDist(busResult(x.s), x.d));
  if (type === 'subway') return pick(STATIONS, 2.5).map((x) => withDist(stationResult(x.s), x.d));
  if (type === 'signal') return pick(SIGNALS, 1.5).map((x) => withDist(signalResult(x.s), x.d));
  throw new ApiError('badrequest');
}

export async function bus(arsId) {
  const stop = BUS_STOPS.find((s) => s.arsId === arsId);
  if (!stop || stop.removed) throw new ApiError('notfound');
  const now = Date.now();
  const h = kstHour(now);
  if (h >= 1 && h < 4) return { state: 'none', arrivals: [] }; // 운행 종료 시간대
  const arrivals = [];
  for (const route of stop.routes) {
    const period = (6 + (hash(route) % 10)) * 60; // 배차 간격(초)
    const phase = hash(route + arsId) % period;
    const t = Math.floor(now / 1000);
    const remain1 = period - ((t + phase) % period);
    for (const remain of [remain1, remain1 + period]) {
      arrivals.push({ route, arriveAt: now + remain * 1000, stopsLeft: Math.max(1, Math.ceil(remain / 100)) });
    }
  }
  arrivals.sort((a, b) => a.arriveAt - b.arriveAt);
  return { state: 'ok', arrivals };
}

const DIRS = {
  '1호선': ['소요산·청량리', '인천·신창'], '2호선': ['내선순환', '외선순환'], '3호선': ['대화', '오금'], '4호선': ['진접', '오이도'],
  '5호선': ['방화', '하남검단산·마천'], '6호선': ['응암순환', '신내'], '7호선': ['장암', '석남'], '8호선': ['별내', '모란'], '9호선': ['개화', '중앙보훈병원'],
  신분당선: ['신사', '광교'], 수인분당선: ['청량리', '인천'], 경의중앙선: ['문산', '지평'], 공항철도: ['서울역', '인천공항2터미널'], 경강선: ['판교', '여주'], 'GTX-A': ['운정중앙', '동탄'],
};

function findStation(station) {
  const n = norm(station);
  return STATIONS.find((s) => norm(s.name) === n) || STATIONS.find((s) => norm(s.name) === n.replace(/역$/, ''));
}

export async function subway(station) {
  const st = findStation(station);
  if (!st) throw new ApiError('notfound');
  const now = Date.now();
  const h = kstHour(now);
  if (h >= 1 && h < 5) return { state: 'none', lines: st.lines.map((line) => ({ line, directions: [] })) };
  const t = Math.floor(now / 1000);
  const lines = st.lines.map((line) => {
    const [up, down] = DIRS[line] || ['상행', '하행'];
    const directions = [up, down].map((dest, i) => {
      const period = (3 + (hash(line + dest) % 6)) * 60;
      const remain = period - ((t + (hash(st.name + line + i) % period)) % period);
      return {
        dir: `${dest} 방면`,
        trains: [remain, remain + period].map((r) => ({ arriveAt: now + r * 1000, msg: r < 60 ? '곧 도착' : '' })),
      };
    });
    return { line, directions };
  });
  return { state: 'ok', lines };
}

// 운행 현황: 데모에서는 1호선에 지연이 있는 것으로 보여 준다 (지연 표시 확인용).
export async function subwayStatus(station) {
  const st = findStation(station);
  if (!st) throw new ApiError('notfound');
  return {
    lines: st.lines.map((line) =>
      line === '1호선'
        ? { line, status: 'delay', message: '신호 장애로 열차가 약 10분 늦어지고 있어요.' }
        : { line, status: 'normal', message: '정상 운행' },
    ),
  };
}

export async function route(origin, dest) {
  const km = distanceKm(origin, dest);
  if (km < 0.7) return { state: 'none', reason: 'near' };
  const h = kstHour();
  if (h >= 1 && h < 4) return { state: 'none', reason: 'night' };
  const wobble = (Math.floor(Date.now() / 300e3) % 5) - 2;
  const minutes = Math.round(8 + km * 2.6 + wobble);
  return { state: 'ok', minutes, transfers: km > 12 ? 2 : km > 5 ? 1 : 0, walkMinutes: 4 + (hash(origin.name + dest.name) % 9) };
}

export async function signal(id) {
  const s = SIGNALS.find((x) => x.id === id);
  if (!s) throw new ApiError('notfound');
  if (!s.supported) return { state: 'unsupported' };
  const now = Date.now();
  const half = s.cycle / 2;
  const pos = (Math.floor(now / 1000) + s.offset) % s.cycle;
  const nsGreen = pos < half;
  const remainNs = nsGreen ? half - pos : s.cycle - pos;
  return {
    state: 'ok',
    at: now,
    phases: [
      { dir: '남북 방향 횡단보도', color: nsGreen ? 'green' : 'red', remainSec: remainNs },
      { dir: '동서 방향 횡단보도', color: nsGreen ? 'red' : 'green', remainSec: remainNs },
    ],
  };
}
