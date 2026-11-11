// 공공데이터포털(data.go.kr) 키로 쓰는 추가 공급자 (서비스마다 API_KEYS.bat의 자기 줄 키를 쓰고, 비어 있으면 일반 키)
// - 경기도 버스 도착·정류소 (경기도_버스도착정보 / 정류소 조회 v2)
// - 지하철 시간표 (국토교통부_(TAGO)_지하철정보) : 실시간이 아님, 화면에 '시간표 기준' 표시
// - 신호등 (행정안전부 한국지역정보개발원_교통안전 신호등 실시간 정보)
// 데이터포털에서 서비스마다 '활용신청'을 해야 같은 키로 호출된다.
import { ApiError, fromFetchError } from './errors.mjs';
import { STATIONS, norm, distanceKm } from './places.mjs';

const TIMEOUT_MS = 8000;
const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const dataGoKey = (k) => (k.includes('%') ? k : encodeURIComponent(k));

async function fetchJSON(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw fromFetchError(e);
  }
  const text = await res.text();
  if (res.status === 429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS|<returnReasonCode>22</.test(text)) throw new ApiError('quota');
  if (res.status === 401 || res.status === 403 || /SERVICE_KEY_IS_NOT_REGISTERED|Unauthorized|<returnReasonCode>(30|31|32)</i.test(text)) throw new ApiError('service', 'key');
  if (!res.ok) throw new ApiError('service');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('service');
  }
}

// 응답 본문에서 목록(배열)을 찾는다. 기관마다 감싸는 구조가 달라서 일반적으로 찾는다.
function findList(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (Array.isArray(obj)) return obj;
  if (obj.item && typeof obj.item === 'object') return asList(obj.item);
  if (obj.items) return findList(obj.items, depth + 1) || (typeof obj.items === 'object' ? [] : null);
  for (const v of Object.values(obj)) {
    const r = findList(v, depth + 1);
    if (r) return r;
  }
  return null;
}

// data.go.kr 공통 머리 (resultCode)
function checkHeader(j) {
  const head = j?.response?.header || j?.header;
  if (!head) return;
  const code = String(head.resultCode ?? '00');
  const msg = String(head.resultMsg || '');
  if (['00', '0', '000'].includes(code)) return;
  if (code === '03' || /NODATA|NO_DATA|K3/i.test(code + msg)) throw new ApiError('nodata');
  if (code === '22' || /K22|LIMIT/i.test(code + msg)) throw new ApiError('quota');
  if (['20', '30', '31', '32'].includes(code) || /KEY/i.test(msg)) throw new ApiError('service', 'key');
  throw new ApiError('service');
}

function pick(obj, re) {
  for (const [k, v] of Object.entries(obj || {})) if (re.test(k) && v !== '' && v != null) return v;
  return undefined;
}

/* ───────────── 경기도 버스 ───────────── */
const GG = 'https://apis.data.go.kr/6410000';

function ggBody(j) {
  const r = j?.response || j;
  const h = r?.msgHeader || {};
  const code = String(h.resultCode ?? '0');
  const msg = String(h.resultMessage || '');
  if (code === '0') return r?.msgBody || {};
  if (code === '4') return null; // 결과 없음
  if (code === '22' || /LIMIT|한도/i.test(msg)) throw new ApiError('quota');
  if (['8', '9', '30', '31', '32'].includes(code) || /인증|등록|KEY/i.test(msg)) throw new ApiError('service', 'key');
  throw new ApiError('service');
}

function ggStop(s) {
  return {
    type: 'bus',
    id: 'bus:gg' + s.stationId,
    name: s.stationName,
    sub: `경기${s.regionName ? ' ' + s.regionName : ''} · 정류소 ${s.mobileNo || s.stationId}`,
    lat: Number(s.y),
    lon: Number(s.x),
    supported: true,
    distanceM: s.distance != null && s.distance !== '' ? Number(s.distance) : undefined,
    ref: { ggStationId: String(s.stationId) },
  };
}

export async function searchBusGg(keys, q) {
  const j = await fetchJSON(`${GG}/busstationservice/v2/getBusStationListv2?serviceKey=${dataGoKey(keys.STOP_GG_KEY || keys.DATA_GO_KR_KEY)}&keyword=${encodeURIComponent(q)}&format=json`);
  return asList(ggBody(j)?.busStationList).slice(0, 20).map(ggStop);
}

export async function nearbyBusGg(keys, lat, lon) {
  const j = await fetchJSON(`${GG}/busstationservice/v2/getBusStationAroundListv2?serviceKey=${dataGoKey(keys.STOP_GG_KEY || keys.DATA_GO_KR_KEY)}&x=${lon}&y=${lat}&format=json`);
  const b = ggBody(j);
  return asList(b?.busStationAroundList || b?.busStationList).slice(0, 10).map(ggStop);
}

export async function busGg(keys, stationId) {
  const j = await fetchJSON(`${GG}/busarrivalservice/v2/getBusArrivalListv2?serviceKey=${dataGoKey(keys.BUS_GG_KEY || keys.DATA_GO_KR_KEY)}&stationId=${encodeURIComponent(stationId)}&format=json`);
  const b = ggBody(j);
  const now = Date.now();
  const arrivals = [];
  for (const it of asList(b?.busArrivalList)) {
    for (const n of [1, 2]) {
      const min = it[`predictTime${n}`];
      if (min === '' || min == null || Number.isNaN(Number(min))) continue;
      const stops = it[`locationNo${n}`];
      arrivals.push({ route: String(it.routeName ?? it.routeId), arriveAt: now + Number(min) * 60e3, stopsLeft: stops !== '' && stops != null ? Number(stops) : null });
    }
  }
  arrivals.sort((a, c) => a.arriveAt - c.arriveAt);
  return { state: arrivals.length ? 'ok' : 'none', arrivals };
}

/* ───────────── 지하철 시간표 (TAGO) ───────────── */
const TAGO = 'https://apis.data.go.kr/1613000/SubwayInfo';
const idCache = new Map(); // 역 이름 → {at, list:[{id,name,line}]}
const schedCache = new Map(); // id|day|UD → {at, rows}

function lineName(route = '') {
  const m = String(route).match(/(\d+호선|신분당선|수인분당선|분당선|경의중앙선|중앙선|공항철도|경춘선|경강선|서해선|우이신설선|신림선|김포골드라인|GTX-?A|에버라인|의정부경전철)/);
  if (!m) return String(route).replace(/^(서울|수도권)\s*/, '');
  return m[1].replace(/^분당선$/, '수인분당선').replace(/^GTXA$/, 'GTX-A');
}

export async function tagoStations(keys, name) {
  const n = String(name).trim().replace(/역$/, '');
  const hit = idCache.get(n);
  if (hit && Date.now() - hit.at < 86400e3) return hit.list;
  const j = await fetchJSON(`${TAGO}/GetKwrdFndSubwaySttnList?serviceKey=${dataGoKey(keys.SUBWAY_TAGO_KEY || keys.DATA_GO_KR_KEY)}&subwayStationName=${encodeURIComponent(n)}&numOfRows=100&pageNo=1&_type=json`);
  let list = [];
  try {
    checkHeader(j);
    list = asList(findList(j?.response?.body) || []).map((x) => ({ id: String(x.subwayStationId), name: String(x.subwayStationName || '').replace(/역$/, ''), line: lineName(x.subwayRouteName) }));
  } catch (e) {
    if (e.kind !== 'nodata') throw e;
  }
  idCache.set(n, { at: Date.now(), list });
  return list;
}

function kst() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), sec: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() };
}

async function schedule(keys, id, dayCode, ud) {
  const ck = `${id}|${dayCode}|${ud}`;
  const hit = schedCache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.rows;
  const j = await fetchJSON(`${TAGO}/GetSubwaySttnAcctoSchdulList?serviceKey=${dataGoKey(keys.SUBWAY_TAGO_KEY || keys.DATA_GO_KR_KEY)}&subwayStationId=${encodeURIComponent(id)}&dailyTypeCode=${dayCode}&upDownTypeCode=${ud}&numOfRows=700&pageNo=1&_type=json`);
  let rows = [];
  try {
    checkHeader(j);
    rows = asList(findList(j?.response?.body) || [])
      .map((x) => {
        const raw = x.depTime && Number(x.depTime) > 0 ? x.depTime : x.arrTime;
        const t = String(raw ?? '').padStart(6, '0');
        return { sec: Number(t.slice(0, 2)) * 3600 + Number(t.slice(2, 4)) * 60 + Number(t.slice(4, 6)), dest: String(x.endSubwayStationNm || '') };
      })
      .filter((r) => Number.isFinite(r.sec) && r.sec > 0)
      .sort((a, b) => a.sec - b.sec);
  } catch (e) {
    if (e.kind !== 'nodata') throw e;
  }
  schedCache.set(ck, { at: Date.now(), rows });
  return rows;
}

export async function subwaySchedule(keys, station) {
  const name = String(station).replace(/역$/, '');
  const ids = (await tagoStations(keys, name)).filter((x) => x.name === name);
  if (!ids.length) throw new ApiError('notfound');
  const k = kst();
  const dayCode = k.dow === 0 ? '03' : k.dow === 6 ? '02' : '01'; // 평일·토·일 (공휴일은 구분하지 않음)
  const midnight = Date.UTC(k.y, k.m, k.d) - 9 * 3600e3;
  const lines = [];
  for (const { id, line } of ids) {
    const directions = [];
    for (const ud of ['U', 'D']) {
      const rows = await schedule(keys, id, dayCode, ud);
      if (!rows.length) continue;
      const next = rows.filter((r) => r.sec >= k.sec - 20).slice(0, 2);
      const dest = next[0]?.dest || rows[rows.length - 1].dest;
      directions.push({ dir: dest ? `${dest.replace(/역$/, '')} 방면` : ud === 'U' ? '상행' : '하행', trains: next.map((r) => ({ arriveAt: midnight + r.sec * 1000, msg: '' })) });
    }
    lines.push({ line, directions });
  }
  const any = lines.some((l) => l.directions.some((d) => d.trains.length));
  return { state: any ? 'ok' : 'none', basis: 'schedule', lines };
}

export async function searchSubwayTago(keys, q) {
  const byName = new Map();
  for (const x of await tagoStations(keys, q)) {
    if (!byName.has(x.name)) byName.set(x.name, new Set());
    byName.get(x.name).add(x.line);
  }
  return [...byName.entries()].slice(0, 15).map(([name, lines]) => {
    const local = STATIONS.find((s) => norm(s.name) === norm(name));
    return { type: 'subway', id: 'subway:' + name, name: name + '역', sub: [...lines].join(' · '), lat: local?.lat, lon: local?.lon, supported: true, ref: { station: name, lines: [...lines] } };
  });
}

/* ───────────── 신호등 (한국지역정보개발원) ───────────── */
// 주의: 2026년 기준 실시간 신호(tl_drct_info)는 일부 지역(울산 등)만 제공된다는 보고가 있다.
// 서울·경기 교차로는 목록(crsrd_map_info)에는 나오지만 신호가 없으면 '신호 정보 제공 안 됨'으로 보인다.
const KLID = 'https://apis.data.go.kr/B551982/rti';
const STDG = ['1100000000', '4100000000']; // 서울특별시, 경기도
let mapCache = { at: 0, list: [] };
const liveCache = new Map(); // stdgCd → {at, map}

async function klidAll(keys, op, stdgCd) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await fetchJSON(`${KLID}/${op}?serviceKey=${dataGoKey(keys.SIGNAL_KLID_KEY || keys.DATA_GO_KR_KEY)}&type=json&pageNo=${page}&numOfRows=1000&stdgCd=${stdgCd}`);
    try {
      checkHeader(j);
    } catch (e) {
      if (e.kind === 'nodata') break;
      throw e;
    }
    const items = asList(findList(j?.body || j?.response?.body || j) || []);
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

async function crossroads(keys) {
  if (Date.now() - mapCache.at < 86400e3 && mapCache.list.length) return mapCache.list;
  const list = [];
  for (const cd of STDG) {
    for (const x of await klidAll(keys, 'crsrd_map_info', cd)) {
      const id = pick(x, /^crsrdId$|crsrd_?id/i);
      const name = pick(x, /^crsrdNm$|crsrd_?nm/i);
      if (!id || !name) continue;
      list.push({ id: `K-${cd}-${id}`, stdgCd: cd, crsrdId: String(id), name: String(name), lat: Number(pick(x, /lat/i)), lon: Number(pick(x, /lot|lon|lng/i)) });
    }
  }
  mapCache = { at: Date.now(), list };
  return list;
}

function signalResult(x, d) {
  return { type: 'signal', id: 'signal:' + x.id, name: x.name, sub: `교차로 ${x.crsrdId}`, lat: x.lat, lon: x.lon, supported: true, distanceM: d != null ? Math.round(d * 1000) : undefined, ref: { signalId: x.id } };
}

export async function searchSignalKlid(keys, q) {
  const n = norm(q);
  return (await crossroads(keys)).filter((x) => norm(x.name).includes(n)).slice(0, 15).map((x) => signalResult(x));
}

export async function nearbySignalKlid(keys, lat, lon) {
  return (await crossroads(keys))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon))
    .map((x) => ({ x, d: distanceKm({ lat, lon }, x) }))
    .filter((v) => v.d <= 1)
    .sort((a, b) => a.d - b.d)
    .slice(0, 10)
    .map((v) => signalResult(v.x, v.d));
}

const DIR_KO = { nt: '북쪽', et: '동쪽', st: '남쪽', wt: '서쪽', ne: '북동쪽', se: '남동쪽', sw: '남서쪽', nw: '북서쪽' };

export function signalColor(status = '') {
  if (/allowed/i.test(status)) return 'green';
  if (/caution|clearance|pre-?movement/i.test(status)) return 'yellow';
  if (/stop/i.test(status)) return 'red';
  return 'unknown';
}

// 보행 신호 필드만 방향별로 정리. unit: 'ms'(밀리초) | 'ds'(1/10초)
export function parsePedestrian(item, unit) {
  const phases = [];
  for (const [k, v] of Object.entries(item || {})) {
    const m = k.match(/^(nt|et|st|wt|ne|se|sw|nw)Pdsg(?:Rmdr|Rmnd)Cs$/i);
    if (!m || v === '' || v == null || Number.isNaN(Number(v))) continue;
    const d = m[1].toLowerCase();
    const status = String(pick(item, new RegExp(`^${d}Pdsg(?:Stts|Stat)Nm$`, 'i')) || '');
    phases.push({ dir: `${DIR_KO[d]} 횡단보도`, color: signalColor(status), remainSec: Math.round(Number(v) / (unit === 'ms' ? 1000 : 10)) });
  }
  return phases;
}

export async function signalKlid(keys, id) {
  const [, stdgCd, crsrdId] = String(id).match(/^K-(\d+)-(.+)$/) || [];
  if (!stdgCd) throw new ApiError('notfound');
  let live = liveCache.get(stdgCd);
  if (!live || Date.now() - live.at > 4000) {
    const map = new Map();
    for (const x of await klidAll(keys, 'tl_drct_info', stdgCd)) {
      const cid = pick(x, /^crsrdId$|crsrd_?id/i);
      if (cid != null) map.set(String(cid), x);
    }
    live = { at: Date.now(), map };
    liveCache.set(stdgCd, live);
  }
  const item = live.map.get(crsrdId);
  if (!item) return { state: 'unsupported' };
  // 이 기관 값은 실제 호출에서 밀리초(1,000~255,000)로 확인됐다는 보고가 있다.
  const phases = parsePedestrian(item, 'ms').slice(0, 4);
  if (!phases.length) return { state: 'unsupported' };
  return { state: 'ok', at: Date.now(), phases };
}
