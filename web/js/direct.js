// 모바일 웹 버전 (GitHub Pages): 로컬 서버가 없으므로 '/api/...' 요청을 브라우저 안에서 처리한다.
// Windows 서버와 같은 공급자 코드(server/*.mjs, 사이트를 만들 때 js/providers/로 복사됨)를 그대로 쓴다.
// API 키는 이 휴대폰(브라우저)에만 저장된다.

export const DIRECT = !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);

const KEYS_STORE = 'proto.keys.v1';
export function getKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS_STORE) || '{}') || {}; } catch { return {}; }
}
export function setKeys(k) {
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(k)); } catch { /* 무시 */ }
}

let P = null; // 공급자 모듈들
async function providers() {
  if (P) return P;
  const [errors, demo, live, dg] = await Promise.all([
    import('./providers/errors.mjs'), import('./providers/demo.mjs'), import('./providers/live.mjs'), import('./providers/datagokr.mjs'),
  ]);
  P = { errors, demo, live, dg };
  return P;
}

const SOURCE = {
  regions: '카카오 로컬', places: '카카오 로컬', weather: '기상청 단기예보 조회서비스 (공공데이터포털)', bus: '서울특별시·경기도 버스도착정보 (공공데이터포털)',
  subwaySchedule: '국토교통부 TAGO 지하철 시간표 (공공데이터포털)', signalKlid: '행정안전부 한국지역정보개발원 교통안전 신호등 실시간 정보 (공공데이터포털)',
};
function providerOf(type, k) {
  if (type === 'regions' || type === 'places') return k.KAKAO_REST_KEY ? 'live' : 'demo';
  if (type === 'subway') return k.DATA_GO_KR_KEY ? 'schedule' : 'demo';
  if (type === 'signal') return k.DATA_GO_KR_KEY ? 'datagokr' : 'demo';
  if (type === 'route') return 'demo'; // 경로(ODsay)는 모바일 웹에서 지원하지 않음
  return k.DATA_GO_KR_KEY ? 'live' : 'demo';
}
function sourceOf(type, k, demoSource) {
  const p = providerOf(type, k);
  if (p === 'demo') return demoSource;
  if (p === 'schedule') return SOURCE.subwaySchedule;
  if (p === 'datagokr') return SOURCE.signalKlid;
  return SOURCE[type];
}

// 짧은 시간 안의 같은 요청은 재사용 (서버와 같은 간격)
const TTL = { weather: 60e3, bus: 8e3, subway: 15e3, subwayStatus: 60e3, route: 120e3, signal: 4e3, search: 600e3, regions: 86400e3, places: 600e3 };
const cache = new Map();
async function cached(type, key, fn) {
  const k = type + '|' + key;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL[type]) return hit.value;
  const value = await fn();
  cache.set(k, { at: Date.now(), value });
  return value;
}

async function both(...calls) {
  const rs = await Promise.allSettled(calls.map((f) => f()));
  const ok = rs.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw rs[0].reason;
  return ok.flatMap((r) => r.value);
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let version = null;
async function appVersion() {
  if (version) return version;
  try { version = (await (await realFetch('version.json', { cache: 'no-store' })).json()).version; } catch { version = '1.0.0'; }
  return version;
}

async function handle(url, init) {
  const { errors, demo, live, dg } = await providers();
  const { ApiError, STATUS_BY_KIND } = errors;
  const p = url.pathname;
  const q = url.searchParams;
  const k = getKeys();
  const ok = (type, data) => json(200, { data, source: sourceOf(type, k, demo.SOURCE), mode: providerOf(type, k) === 'demo' ? 'demo' : 'live', fetchedAt: Date.now() });
  const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new ApiError('badrequest'); return n; };
  const str = (v) => { const s = String(v ?? '').trim(); if (!s || s.length > 80) throw new ApiError('badrequest'); return s; };
  try {
    if (p === '/api/health') return json(200, { app: 'prototype-twt', version: await appVersion(), direct: true });
    if (p === '/api/config') {
      const types = ['regions', 'places', 'weather', 'bus', 'subway', 'route', 'signal'];
      return json(200, { version: await appVersion(), direct: true, modes: Object.fromEntries(types.map((t) => [t, providerOf(t, k) === 'demo' ? 'demo' : 'live'])), providers: Object.fromEntries(types.map((t) => [t, providerOf(t, k)])), platform: 'web' });
    }
    if (p === '/api/net') return json(200, { online: navigator.onLine });
    if (p === '/api/update') return json(200, { available: false, direct: true }); // 웹은 열 때마다 최신
    if (p === '/api/metrics') return json(200, { ok: true, accepted: 0 }); // 모바일 웹은 지표를 모으지 않음
    if (p === '/api/feedback' || p.startsWith('/api/open-') || p.startsWith('/api/debug') || p === '/api/restart') throw new ApiError('service', 'mobile');

    if (p === '/api/regions/search') {
      const term = str(q.get('q'));
      return ok('regions', await cached('regions', term, () => (providerOf('regions', k) === 'live' ? live.searchRegions(k, term) : demo.searchRegions(term))));
    }
    if (p === '/api/regions/reverse') {
      const lat = num(q.get('lat')), lon = num(q.get('lon'));
      return ok('regions', await cached('regions', `rev:${lat},${lon}`, () => (providerOf('regions', k) === 'live' ? live.reverseRegion(k, lat, lon) : demo.reverseRegion(lat, lon))));
    }
    if (p === '/api/places/search') {
      const term = str(q.get('q'));
      return ok('places', await cached('places', term, () => (providerOf('places', k) === 'live' ? live.searchPlaces(k, term) : demo.searchPlaces(term))));
    }
    if (p === '/api/weather') {
      const lat = num(q.get('lat')), lon = num(q.get('lon'));
      return ok('weather', await cached('weather', `${lat},${lon}`, () => (providerOf('weather', k) === 'live' ? live.weather(k, lat, lon) : demo.weather(lat, lon))));
    }
    if (p === '/api/transit/search' || p === '/api/transit/nearby') {
      const type = q.get('type');
      const prov = providerOf(type, k);
      let v;
      if (p.endsWith('search')) {
        const term = str(q.get('q'));
        v = await cached('search', `${type}:${term}:${prov}`, () => {
          if (prov === 'demo') return demo.searchTransit(type, term);
          // 서울 버스 API는 보안 연결(https)이 없어 휴대폰 브라우저에서 부를 수 없다 → 경기 버스만
          if (type === 'bus') return dg.searchBusGg(k, term);
          if (type === 'subway') return dg.searchSubwayTago(k, term);
          return dg.searchSignalKlid(k, term);
        });
      } else {
        const lat = num(q.get('lat')), lon = num(q.get('lon'));
        v = await cached('search', `near:${type}:${lat},${lon}:${prov}`, () => {
          if (prov === 'demo') return demo.nearbyTransit(type, lat, lon);
          if (type === 'bus') return dg.nearbyBusGg(k, lat, lon);
          if (type === 'subway') return live.nearbySubway(lat, lon);
          return dg.nearbySignalKlid(k, lat, lon);
        });
      }
      return ok(type, v);
    }
    if (p === '/api/transit/bus') {
      const gg = q.get('gg');
      const id = str(gg || q.get('arsId'));
      const isLive = providerOf('bus', k) === 'live';
      if (isLive && !gg) throw new ApiError('service', 'https'); // 서울 버스
      return ok('bus', await cached('bus', (gg ? 'gg' : '') + id, () => (isLive ? dg.busGg(k, id) : demo.bus(id))));
    }
    if (p === '/api/transit/subway') {
      const st = str(q.get('station'));
      const prov = providerOf('subway', k);
      return ok('subway', await cached('subway', `${prov}:${st}`, () => (prov === 'schedule' ? dg.subwaySchedule(k, st) : demo.subway(st))));
    }
    if (p === '/api/transit/subway-status') {
      const st = str(q.get('station'));
      if (providerOf('subway', k) === 'schedule') return ok('subway', { lines: [], basis: 'schedule' });
      return ok('subway', await cached('subwayStatus', st, () => demo.subwayStatus(st)));
    }
    if (p === '/api/transit/route') {
      const o = { lat: num(q.get('sy')), lon: num(q.get('sx')), name: '' };
      const d = { lat: num(q.get('ey')), lon: num(q.get('ex')), name: '' };
      return ok('route', await cached('route', `${o.lat},${o.lon}>${d.lat},${d.lon}`, () => demo.route(o, d)));
    }
    if (p === '/api/transit/signal') {
      const id = str(q.get('id'));
      return ok('signal', await cached('signal', id, () => (id.startsWith('K-') && k.DATA_GO_KR_KEY ? dg.signalKlid(k, id) : demo.signal(id))));
    }
    throw new ApiError('notfound');
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError('service');
    return json(STATUS_BY_KIND[err.kind] || 502, { error: err.kind, detail: err.detail || undefined });
  }
}

const realFetch = window.fetch.bind(window);
export function installDirect() {
  if (!DIRECT) return;
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) return handle(url, init);
    return realFetch(input, init);
  };
}
