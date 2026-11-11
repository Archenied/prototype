// 실제 공공·외부 API 공급자.
// 각 함수는 API_KEYS.bat에서 읽은 keys 객체를 받는다. 키가 없으면 server.mjs가 데모 공급자를 쓴다.
// 응답 형태는 demo.mjs와 같다.
import { ApiError, fromFetchError } from './errors.mjs';
import { STATIONS, norm, distanceKm, isSupportedAddress, inServiceArea } from './places.mjs';

const TIMEOUT_MS = 7000;

async function fetchText(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw fromFetchError(e);
  }
  const text = await res.text();
  if (res.status === 429) throw new ApiError('quota');
  if (res.status === 401 || res.status === 403) throw new ApiError('service', 'key');
  if (!res.ok) {
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS|<returnReasonCode>22</.test(text)) throw new ApiError('quota');
    throw new ApiError('service');
  }
  return text;
}

async function fetchJSON(url, headers) {
  const text = await fetchText(url, headers);
  try {
    return JSON.parse(text);
  } catch {
    // 공공데이터포털은 키 오류·한도 초과를 XML로 돌려준다.
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS|<returnReasonCode>22</.test(text)) throw new ApiError('quota');
    if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ?KEY|<returnReasonCode>(30|31|32)</i.test(text)) throw new ApiError('service', 'key');
    throw new ApiError('service');
  }
}

// 공공데이터포털 키는 인코딩 키(%포함)와 디코딩 키 둘 다 받아 준다.
function dataGoKey(k) {
  return k.includes('%') ? k : encodeURIComponent(k);
}

const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);

/* ───────────── 카카오 로컬: 지역·장소 검색 ───────────── */

function kakaoHeaders(keys) {
  return { Authorization: `KakaoAK ${keys.KAKAO_REST_KEY}` };
}

export async function searchRegions(keys, q) {
  const base = 'https://dapi.kakao.com/v2/local/search';
  const j = await fetchJSON(`${base}/address.json?size=15&query=${encodeURIComponent(q)}`, kakaoHeaders(keys));
  let out = asList(j.documents).map((d) => ({
    id: 'k-' + (d.address?.h_code || d.address?.b_code || d.address_name),
    name: d.address_name,
    address: d.address_name,
    lat: +d.y,
    lon: +d.x,
    supported: isSupportedAddress(d.address_name),
  }));
  if (out.length === 0) {
    const k = await fetchJSON(`${base}/keyword.json?size=15&query=${encodeURIComponent(q)}`, kakaoHeaders(keys));
    out = asList(k.documents).map((d) => ({
      id: 'k-' + d.id,
      name: d.place_name,
      address: d.address_name,
      lat: +d.y,
      lon: +d.x,
      supported: isSupportedAddress(d.address_name),
    }));
  }
  return out;
}

export async function reverseRegion(keys, lat, lon) {
  const j = await fetchJSON(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lon}&y=${lat}`, kakaoHeaders(keys));
  const docs = asList(j.documents);
  const d = docs.find((x) => x.region_type === 'H') || docs[0];
  if (!d) return { name: '알 수 없는 지역', supported: inServiceArea(lat, lon) };
  return { name: d.address_name, supported: isSupportedAddress(d.address_name) };
}

export async function searchPlaces(keys, q) {
  const j = await fetchJSON(`https://dapi.kakao.com/v2/local/search/keyword.json?size=15&query=${encodeURIComponent(q)}`, kakaoHeaders(keys));
  return asList(j.documents).map((d) => ({
    id: 'k-' + d.id,
    name: d.place_name,
    address: d.road_address_name || d.address_name,
    lat: +d.y,
    lon: +d.x,
    supported: isSupportedAddress(d.address_name),
  }));
}

/* ───────────── 기상청 초단기실황·초단기예보 ───────────── */

// 위경도 → 기상청 격자(nx, ny). 기상청 공식 변환식(Lambert Conformal Conic).
export function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

function kstParts(ms) {
  const d = new Date(ms + 9 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`, hh: p(d.getUTCHours()), mm: d.getUTCMinutes() };
}

// 실황은 매시 40분 이후, 예보는 매시 45분 이후에 그 시각 자료가 나온다.
function ncstBase(now) {
  const k = kstParts(now);
  const t = k.mm < 40 ? kstParts(now - 3600e3) : k;
  return { base_date: t.date, base_time: t.hh + '00' };
}
function fcstBase(now) {
  const k = kstParts(now);
  const t = k.mm < 45 ? kstParts(now - 3600e3) : k;
  return { base_date: t.date, base_time: t.hh + '30' };
}

function kmaItems(j) {
  const head = j?.response?.header;
  if (head && head.resultCode !== '00') {
    if (head.resultCode === '22') throw new ApiError('quota');
    if (['30', '31', '32'].includes(head.resultCode)) throw new ApiError('service', 'key');
    throw new ApiError('service');
  }
  return asList(j?.response?.body?.items?.item);
}

const PTY = { 1: ['rain', '비'], 2: ['sleet', '비/눈'], 3: ['snow', '눈'], 5: ['rain', '빗방울'], 6: ['sleet', '빗방울/눈날림'], 7: ['snow', '눈날림'] };
const SKY = { 1: ['clear', '맑음'], 3: ['cloudy', '구름 많음'], 4: ['overcast', '흐림'] };

// 단기예보 강수확률: 02·05·08·11·14·17·20·23시 발표 (발표 10분 뒤부터 조회 가능). 격자별로 30분 보관.
const popCache = new Map();
async function vilagePop(key, nx, ny, now) {
  const ck = `${nx},${ny}`;
  const hit = popCache.get(ck);
  if (hit && now - hit.at < 30 * 60e3) return hit.map;
  let t = now - 10 * 60e3;
  let p = kstParts(t);
  for (let i = 0; i < 4 && ![2, 5, 8, 11, 14, 17, 20, 23].includes(Number(p.hh)); i++) { t -= 3600e3; p = kstParts(t); }
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${key}&pageNo=1&numOfRows=400&dataType=JSON&base_date=${p.date}&base_time=${p.hh}00&nx=${nx}&ny=${ny}`;
  const map = new Map();
  for (const it of kmaItems(await fetchJSON(url))) if (it.category === 'POP') map.set(it.fcstDate + it.fcstTime, Number(it.fcstValue));
  popCache.set(ck, { at: now, map });
  return map;
}

export async function weather(keys, lat, lon) {
  const { nx, ny } = toGrid(lat, lon);
  const key = dataGoKey(keys.WEATHER_KEY || keys.DATA_GO_KR_KEY);
  const base = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
  const now = Date.now();
  const nb = ncstBase(now);
  const fb = fcstBase(now);
  const common = `serviceKey=${key}&pageNo=1&numOfRows=100&dataType=JSON&nx=${nx}&ny=${ny}`;
  const [ncst, fcst] = await Promise.all([
    fetchJSON(`${base}/getUltraSrtNcst?${common}&base_date=${nb.base_date}&base_time=${nb.base_time}`),
    fetchJSON(`${base}/getUltraSrtFcst?${common}&base_date=${fb.base_date}&base_time=${fb.base_time}`),
  ]);
  const obs = {};
  for (const it of kmaItems(ncst)) obs[it.category] = it.obsrValue;
  const byTime = new Map();
  for (const it of kmaItems(fcst)) {
    const t = it.fcstDate + it.fcstTime;
    if (!byTime.has(t)) byTime.set(t, { t });
    byTime.get(t)[it.category] = it.fcstValue;
  }
  const slots = [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t));
  if (obs.T1H === undefined) throw new ApiError('service');
  const pty = Number(obs.PTY || 0);
  const sky = Number(slots[0]?.SKY || 1);
  const [code, text] = pty > 0 ? PTY[pty] || ['rain', '비'] : SKY[sky] || ['clear', '맑음'];
  const hourly = slots.slice(0, 6).map((s) => {
    const p = Number(s.PTY || 0);
    const [c, tx] = p > 0 ? PTY[p] || ['rain', '비'] : SKY[Number(s.SKY || 1)] || ['clear', '맑음'];
    return { hour: Number(s.t.slice(8, 10)), temp: Number(s.T1H), code: c, text: tx, pop: null };
  });
  const rn = parseFloat(obs.RN1);
  const y = nb.base_date, hh = nb.base_time.slice(0, 2);
  // 강수확률(POP)은 단기예보에만 있다. 실패해도 날씨 표시는 그대로 한다.
  const pops = await vilagePop(key, nx, ny, now).catch(() => null);
  if (pops) for (const [i, s] of slots.slice(0, 6).entries()) hourly[i].pop = pops.get(s.t.slice(0, 10) + '00') ?? null;
  const k = kstParts(now);
  const popNow = pops ? pops.get(k.date + k.hh + '00') ?? [...pops.entries()].sort((a, b) => a[0].localeCompare(b[0])).find(([t]) => t >= k.date + k.hh + '00')?.[1] ?? null : null;
  return {
    temp: Number(obs.T1H),
    code,
    text,
    pop: popNow,
    humidity: Number(obs.REH),
    wind: Number(obs.WSD),
    windDir: obs.VEC !== undefined && obs.VEC !== '' && Number.isFinite(Number(obs.VEC)) ? Number(obs.VEC) : null, // 실측 풍향 (불어오는 쪽, 도)
    rain1h: Number.isFinite(rn) ? rn : 0,
    hourly,
    observedAt: Date.UTC(+y.slice(0, 4), +y.slice(4, 6) - 1, +y.slice(6, 8), +hh - 9, 0),
  };
}

/* ───────────── 서울 버스 (공공데이터포털 서울특별시 정류소정보조회) ───────────── */

function seoulBusItems(j) {
  const head = j?.msgHeader || {};
  const cd = String(head.headerCd ?? '');
  if (cd === '0') return asList(j?.msgBody?.itemList);
  if (cd === '4') return null; // 결과 없음
  const msg = String(head.headerMsg || '');
  if (/한도|LIMIT/i.test(msg)) throw new ApiError('quota');
  if (/인증|등록|KEY/i.test(msg) || cd === '7') throw new ApiError('service', 'key');
  throw new ApiError('service');
}

const BUS_BASE = 'http://ws.bus.go.kr/api/rest/stationinfo';

export async function searchBus(keys, q) {
  const j = await fetchJSON(`${BUS_BASE}/getStationByName?serviceKey=${dataGoKey(keys.BUS_SEOUL_KEY || keys.DATA_GO_KR_KEY)}&stSrch=${encodeURIComponent(q)}&resultType=json`);
  // 정류소 번호가 없는(0) 곳은 미정차 정류장이라 도착 정보를 조회할 수 없어서 뺀다.
  const items = (seoulBusItems(j) || []).filter((s) => s.arsId && String(s.arsId) !== '0');
  return items.slice(0, 20).map((s) => ({
    type: 'bus', id: 'bus:' + s.arsId, name: s.stNm, sub: `정류소 ${s.arsId}`,
    lat: +s.tmY, lon: +s.tmX, supported: true, ref: { arsId: String(s.arsId) },
  }));
}

export async function nearbyBus(keys, lat, lon) {
  const j = await fetchJSON(`${BUS_BASE}/getStationByPos?serviceKey=${dataGoKey(keys.BUS_SEOUL_KEY || keys.DATA_GO_KR_KEY)}&tmX=${lon}&tmY=${lat}&radius=600&resultType=json`);
  const items = seoulBusItems(j) || [];
  return items.slice(0, 10).map((s) => ({
    type: 'bus', id: 'bus:' + s.arsId, name: s.stationNm, sub: `정류소 ${s.arsId}`,
    lat: +s.gpsY, lon: +s.gpsX, supported: true, distanceM: Number(s.dist) || undefined, ref: { arsId: String(s.arsId) },
  }));
}

// "3분12초후[2번째 전]" · "곧 도착" · "운행종료" · "출발대기"
function parseArrMsg(msg = '', now) {
  if (!msg || /운행종료|출발대기|정보없음/.test(msg)) return null;
  if (/곧 도착/.test(msg)) return { arriveAt: now + 30e3, stopsLeft: 1 };
  const m = msg.match(/(?:(\d+)분)?\s*(?:(\d+)초)?후(?:\[(\d+)번째 전\])?/);
  if (!m || (!m[1] && !m[2])) return null;
  const sec = Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return { arriveAt: now + sec * 1000, stopsLeft: m[3] ? Number(m[3]) : null };
}

export async function bus(keys, arsId) {
  const j = await fetchJSON(`${BUS_BASE}/getStationByUid?serviceKey=${dataGoKey(keys.BUS_SEOUL_KEY || keys.DATA_GO_KR_KEY)}&arsId=${encodeURIComponent(arsId)}&resultType=json`);
  const items = seoulBusItems(j);
  if (items === null) throw new ApiError('notfound');
  const now = Date.now();
  const arrivals = [];
  for (const it of items) {
    for (const msg of [it.arrmsg1, it.arrmsg2]) {
      const a = parseArrMsg(msg, now);
      if (a) arrivals.push({ route: it.rtNm, ...a });
    }
  }
  arrivals.sort((a, b) => a.arriveAt - b.arriveAt);
  return { state: arrivals.length ? 'ok' : 'none', arrivals };
}

/* ───────────── 서울 실시간 지하철 도착 (서울 열린데이터광장) ───────────── */

const SUBWAY_LINE = {
  1001: '1호선', 1002: '2호선', 1003: '3호선', 1004: '4호선', 1005: '5호선', 1006: '6호선', 1007: '7호선', 1008: '8호선', 1009: '9호선',
  1063: '경의중앙선', 1065: '공항철도', 1067: '경춘선', 1075: '수인분당선', 1077: '신분당선', 1081: '경강선', 1092: '우이신설선', 1093: '서해선', 1032: 'GTX-A',
};

async function subwayRaw(keys, station) {
  const name = String(station).replace(/역$/, '');
  const url = `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(keys.SEOUL_OPENAPI_KEY)}/json/realtimeStationArrival/0/40/${encodeURIComponent(name)}`;
  const j = await fetchJSON(url);
  const code = j?.errorMessage?.code || j?.code || '';
  if (code === 'INFO-200') return null; // 해당하는 데이터 없음
  if (code === 'INFO-100' || /ERROR-3(00|01|10)/.test(code)) throw new ApiError('service', 'key');
  if (/ERROR-337/.test(code)) throw new ApiError('quota');
  if (code && code !== 'INFO-000') throw new ApiError('service');
  return asList(j.realtimeArrivalList);
}

function trainSeconds(t) {
  const s = Number(t.barvlDt);
  if (s > 0) return s;
  const msg = `${t.arvlMsg2 || ''}`;
  const m = msg.match(/(\d+)분\s*(\d+)?초?\s*후/);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  if (['0', '1'].includes(String(t.arvlCd))) return 0; // 진입·도착
  const n = msg.match(/\[(\d+)\]번째 전역/);
  if (n) return Number(n[1]) * 120;
  if (['3', '4', '5'].includes(String(t.arvlCd))) return 90; // 전역 출발·진입·도착
  return null;
}

export async function subway(keys, station) {
  const list = await subwayRaw(keys, station);
  if (list === null) throw new ApiError('notfound');
  const now = Date.now();
  const lines = new Map();
  for (const t of list) {
    const line = SUBWAY_LINE[t.subwayId] || `${t.subwayId}`;
    if (!lines.has(line)) lines.set(line, new Map());
    const dirName = (String(t.trainLineNm || '').split('-')[0] || t.updnLine || '').trim();
    const dirKey = t.updnLine || dirName;
    const dirs = lines.get(line);
    if (!dirs.has(dirKey)) dirs.set(dirKey, { dir: dirName || dirKey, trains: [] });
    const sec = trainSeconds(t);
    if (sec === null) continue;
    dirs.get(dirKey).trains.push({ arriveAt: now + sec * 1000, msg: sec < 60 ? '곧 도착' : '' });
  }
  const out = [...lines.entries()].map(([line, dirs]) => ({
    line,
    directions: [...dirs.values()].map((d) => ({ ...d, trains: d.trains.sort((a, b) => a.arriveAt - b.arriveAt).slice(0, 2) })),
  }));
  const any = out.some((l) => l.directions.some((d) => d.trains.length));
  return { state: any ? 'ok' : 'none', lines: out };
}

// 서울 열린데이터광장에는 별도의 공개 운행 장애 API가 없어서,
// 실시간 도착 메시지에 '지연'·'운행 중단' 문구가 있는지로 운행 현황을 판단한다.
export async function subwayStatus(keys, station) {
  const list = await subwayRaw(keys, station);
  if (list === null) throw new ApiError('notfound');
  const byLine = new Map();
  for (const t of list) {
    const line = SUBWAY_LINE[t.subwayId] || `${t.subwayId}`;
    const msg = `${t.arvlMsg2 || ''} ${t.arvlMsg3 || ''} ${t.btrainSttus || ''}`;
    const prev = byLine.get(line) || { line, status: 'normal', message: '정상 운행' };
    if (/운행\s*중단|운행중지/.test(msg)) byLine.set(line, { line, status: 'suspended', message: '일부 구간 운행이 중단됐어요.' });
    else if (/지연/.test(msg) && prev.status === 'normal') byLine.set(line, { line, status: 'delay', message: '열차가 늦어지고 있어요.' });
    else byLine.set(line, prev);
  }
  return { lines: [...byLine.values()] };
}

export async function searchSubway(keys, q) {
  const n = norm(q).replace(/역$/, '');
  const local = STATIONS.filter((s) => norm(s.name).includes(n));
  const results = local.slice(0, 15).map((s) => ({
    type: 'subway', id: 'subway:' + s.name, name: s.name + '역', sub: s.lines.join(' · '), lat: s.lat, lon: s.lon, supported: true, ref: { station: s.name, lines: s.lines },
  }));
  if (!results.some((r) => norm(r.ref.station) === n) && n) {
    // 목록에 없는 역은 실시간 API에 직접 물어 확인한다.
    const list = await subwayRaw(keys, q);
    if (list && list.length) {
      const lines = [...new Set(list.map((t) => SUBWAY_LINE[t.subwayId] || `${t.subwayId}`))];
      const name = list[0].statnNm || q.replace(/역$/, '');
      results.unshift({ type: 'subway', id: 'subway:' + name, name: name + '역', sub: lines.join(' · '), supported: true, ref: { station: name, lines } });
    }
  }
  return results;
}

export function nearbySubway(lat, lon) {
  return STATIONS.map((s) => ({ s, d: distanceKm({ lat, lon }, s) }))
    .filter((x) => x.d <= 2.5)
    .sort((a, b) => a.d - b.d)
    .slice(0, 10)
    .map(({ s, d }) => ({
      type: 'subway', id: 'subway:' + s.name, name: s.name + '역', sub: s.lines.join(' · '), lat: s.lat, lon: s.lon, supported: true, distanceM: Math.round(d * 1000), ref: { station: s.name, lines: s.lines },
    }));
}

/* ───────────── ODsay 대중교통 소요 시간 ───────────── */

export async function route(keys, origin, dest) {
  const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${origin.lon}&SY=${origin.lat}&EX=${dest.lon}&EY=${dest.lat}&apiKey=${encodeURIComponent(keys.ODSAY_KEY)}`;
  const j = await fetchJSON(url);
  const err = Array.isArray(j?.error) ? j.error[0] : j?.error;
  if (err) {
    const code = String(err.code ?? '');
    if (code === '-98' || code === '-99' || code === '3' || code === '4' || code === '5' || code === '6') return { state: 'none', reason: code === '-98' ? 'near' : 'noroute' };
    if (/apikey|ApiKeyAuthFailed|-8/i.test(`${code} ${err.message || err.msg || ''}`)) throw new ApiError('service', 'key');
    if (code === '-9' || /limit|초과/i.test(err.message || err.msg || '')) throw new ApiError('quota');
    throw new ApiError('service');
  }
  const p = asList(j?.result?.path)[0];
  if (!p) return { state: 'none', reason: 'noroute' };
  const info = p.info || {};
  return {
    state: 'ok',
    minutes: Number(info.totalTime),
    transfers: Math.max(0, Number(info.busTransitCount || 0) + Number(info.subwayTransitCount || 0) - 1),
    walkMinutes: info.totalWalk ? Math.round(Number(info.totalWalk) / 67) : null,
  };
}

/* ───────────── 서울 T-data 교통신호 (V2X) ───────────── */
// 주의: 서울 교통빅데이터플랫폼(t-data.seoul.go.kr) V2X 신호 API 규격을 기준으로 작성했다.
// 실제 키로 확인하지 못했으므로 필드 이름이 다르면 '신호 정보 제공 안 됨'으로 표시된다.

const TDATA = 'https://t-data.seoul.go.kr/apig/apiman-gateway/tapi';
let crossroadCache = { at: 0, list: [] };

async function crossroads(keys) {
  if (Date.now() - crossroadCache.at < 24 * 3600e3 && crossroadCache.list.length) return crossroadCache.list;
  const j = await fetchJSON(`${TDATA}/v2xCrossroadMapInformation/1.0?apikey=${encodeURIComponent(keys.TDATA_KEY)}&type=json&pageNo=1&numOfRows=2000`);
  const list = asList(Array.isArray(j) ? j : j?.data || j?.items || j?.response?.body?.items?.item).map((x) => ({
    id: String(x.itstId),
    name: x.itstNm,
    lat: Number(x.mapCtptIntLat) / (Math.abs(Number(x.mapCtptIntLat)) > 1000 ? 1e7 : 1),
    lon: Number(x.mapCtptIntLot) / (Math.abs(Number(x.mapCtptIntLot)) > 1000 ? 1e7 : 1),
  })).filter((x) => x.id && x.name);
  crossroadCache = { at: Date.now(), list };
  return list;
}

function signalResult(x, d) {
  return { type: 'signal', id: 'signal:' + x.id, name: x.name, sub: `교차로 ${x.id}`, lat: x.lat, lon: x.lon, supported: true, distanceM: d != null ? Math.round(d * 1000) : undefined, ref: { signalId: x.id } };
}

export async function searchSignal(keys, q) {
  const n = norm(q);
  return (await crossroads(keys)).filter((x) => norm(x.name).includes(n)).slice(0, 15).map((x) => signalResult(x));
}

export async function nearbySignal(keys, lat, lon) {
  return (await crossroads(keys))
    .map((x) => ({ x, d: distanceKm({ lat, lon }, x) }))
    .filter((v) => v.d <= 1)
    .sort((a, b) => a.d - b.d)
    .slice(0, 10)
    .map((v) => signalResult(v.x, v.d));
}

const DIR_NAME = { nt: '북쪽', et: '동쪽', st: '남쪽', wt: '서쪽', ne: '북동쪽', se: '남동쪽', sw: '남서쪽', nw: '북서쪽' };

export async function signal(keys, id) {
  const q = `apikey=${encodeURIComponent(keys.TDATA_KEY)}&type=json&itstId=${encodeURIComponent(id)}`;
  const [timing, phase] = await Promise.all([
    fetchJSON(`${TDATA}/v2xSignalPhaseTimingInformation/1.0?${q}`),
    fetchJSON(`${TDATA}/v2xSignalPhaseInformation/1.0?${q}`).catch(() => null),
  ]);
  const t = asList(Array.isArray(timing) ? timing : timing?.data || timing?.items)[0];
  const p = phase ? asList(Array.isArray(phase) ? phase : phase?.data || phase?.items)[0] : null;
  if (!t) return { state: 'unsupported' };
  const phases = [];
  for (const [k, v] of Object.entries(t)) {
    const m = k.match(/^(nt|et|st|wt|ne|se|sw|nw)PdsgRmdrCs$/);
    if (!m || v === null || v === '') continue;
    const stat = p ? String(p[`${m[1]}PdsgStatNm`] || '') : '';
    phases.push({ dir: `${DIR_NAME[m[1]]} 횡단보도`, color: /allowed/i.test(stat) ? 'green' : stat ? 'red' : 'unknown', remainSec: Math.round(Number(v) / 10) });
  }
  if (!phases.length) return { state: 'unsupported' };
  return { state: 'ok', at: Date.now(), phases: phases.slice(0, 4) };
}
