// 프로토타입 로컬 서버 (Node 24, 외부 패키지 없음)
// - web/ 폴더의 앱 화면을 보여 준다
// - API_KEYS.bat의 키로 날씨·교통 API를 대신 호출한다 (키가 없으면 데모 데이터)
// - 피드백·익명 지표를 data/ 폴더에 저장하고 운영자 화면(/admin)을 제공한다
// 정밀 위치(좌표)는 로그·파일 어디에도 남기지 않는다 (FACT-07).
import http from 'node:http';
import os from 'node:os';
import dns from 'node:dns/promises';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, appendFileSync, statSync, renameSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, dirname, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readKeys, ensureKeysFile } from './keys.mjs';
import { ApiError, STATUS_BY_KIND } from './errors.mjs';
import * as demo from './demo.mjs';
import * as live from './live.mjs';
import * as dg from './datagokr.mjs';
import { remoteRelease, downloadUpdate, compareVersions } from './updater.mjs';

export const APP_ID = 'prototype-twt';
export const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version; } catch { return '1.0.0'; } })();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const DATA = process.env.PROTO_DATA_DIR ? resolve(process.env.PROTO_DATA_DIR) : join(ROOT, 'data');
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT || 48620);
const HOST = '127.0.0.1';

/* ───────────── 업데이트 감지: 발표된 버전(version.json) ─────────────
   파일 하나하나가 바뀔 때가 아니라, 업데이트를 다 만든 뒤 version.json의 버전을 올렸을 때만 알린다. */
const VERSION_FILE = join(ROOT, 'version.json');
function readRelease() {
  try {
    const j = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
    return { version: String(j.version || '0'), notes: Array.isArray(j.notes) ? j.notes.map(String).slice(0, 8) : [] };
  } catch {
    return { version: '0', notes: [] };
  }
}
ensureKeysFile(ROOT);
const BOOT_RELEASE = readRelease();
const BOOT_ID = Date.now().toString(36);
void createHash; void readdirSync;

/* ───────────── 로그 (경로만 기록, 검색어·좌표 없음) ───────────── */
const LOG = join(DATA, 'server.log');
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    if (existsSync(LOG) && statSync(LOG).size > 512 * 1024) renameSync(LOG, LOG + '.old');
    appendFileSync(LOG, line);
  } catch { /* 로그 실패는 무시 */ }
  if (process.stdout.isTTY) process.stdout.write(line);
}

/* ───────────── 공급자 선택 ───────────── */
const NEED_KEY = {
  regions: 'KAKAO_REST_KEY', places: 'KAKAO_REST_KEY', weather: 'DATA_GO_KR_KEY', bus: 'DATA_GO_KR_KEY',
  subway: 'SEOUL_OPENAPI_KEY', route: 'ODSAY_KEY', signal: 'TDATA_KEY',
};
export const LIVE_SOURCE = {
  regions: '카카오 로컬', places: '카카오 로컬',
  weather: '기상청 단기예보 조회서비스 (공공데이터포털)',
  bus: '서울특별시·경기도 버스도착정보 (공공데이터포털)',
  subway: '서울시 실시간 지하철 도착정보 (서울 열린데이터광장)',
  subwaySchedule: '국토교통부 TAGO 지하철 시간표 (공공데이터포털)',
  route: 'ODsay LAB 대중교통 길찾기',
  signal: '서울 교통빅데이터플랫폼 T-data (V2X 신호)',
  signalKlid: '행정안전부 한국지역정보개발원 교통안전 신호등 실시간 정보 (공공데이터포털)',
};
// 데이터 종류별로 어떤 공급자를 쓰는지: 전용 키가 있으면 그것, 없으면 공공데이터포털 키, 둘 다 없으면 데모
function providerOf(type, keys) {
  if (type === 'subway') return keys.SEOUL_OPENAPI_KEY ? 'realtime' : keys.DATA_GO_KR_KEY ? 'schedule' : 'demo';
  if (type === 'signal') return keys.TDATA_KEY ? 'tdata' : keys.DATA_GO_KR_KEY ? 'datagokr' : 'demo';
  return keys[NEED_KEY[type]] ? 'live' : 'demo';
}
function modeOf(type, keys) {
  return providerOf(type, keys) === 'demo' ? 'demo' : 'live';
}
function sourceOf(type, keys) {
  const p = providerOf(type, keys);
  if (p === 'demo') return demo.SOURCE;
  if (p === 'schedule') return LIVE_SOURCE.subwaySchedule;
  if (p === 'datagokr') return LIVE_SOURCE.signalKlid;
  return LIVE_SOURCE[type];
}

// 서울·경기 두 곳에 함께 물어보고, 한쪽이 실패해도 다른 쪽 결과는 보여 준다.
async function both(...calls) {
  const rs = await Promise.allSettled(calls.map((f) => f()));
  const ok = rs.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw rs[0].reason;
  return ok.flatMap((r) => r.value);
}

/* ───────────── 시험용 장애 주입 (앱의 Ctrl+Shift+D 패널) ───────────── */
const FAULT_TYPES = ['network', 'weather', 'bus', 'subway', 'subwayStatus', 'route', 'signal', 'search', 'feedback', 'metrics'];
const FAULT_MODES = ['none', 'delay', 'timeout', 'service', 'quota', 'notfound', 'empty', 'offline'];
const faults = Object.fromEntries(FAULT_TYPES.map((t) => [t, 'none']));
const upstreamCalls = Object.fromEntries(['weather', 'bus', 'subway', 'subwayStatus', 'route', 'signal', 'search', 'regions', 'places'].map((t) => [t, 0]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyFault(type) {
  if (faults.network === 'offline') throw new ApiError('offline');
  const f = faults[type] || 'none';
  if (f === 'none') return null;
  if (f === 'delay') { await sleep(5000); return null; }
  if (f === 'timeout') { await sleep(1200); throw new ApiError('timeout'); }
  if (f === 'empty') return 'empty';
  throw new ApiError(f);
}

/* ───────────── 외부 호출 묶기·재사용 (R-23, F-15) ───────────── */
// 같은 대상의 요청이 동시에 오면 하나로 묶고, 짧은 시간 안의 반복은 마지막 결과를 재사용한다.
// weather 60초: 기상청 실황은 1시간마다 바뀌지만, 새 관측이 나오면 1분 안에 보이게 한다.
// bus 8초: 앱이 10초마다 물어볼 때 항상 새로 받도록.
const TTL = { weather: 60e3, bus: 8e3, subway: 15e3, subwayStatus: 60e3, route: 120e3, signal: 4e3, search: 600e3, regions: 86400e3, places: 600e3 };
const cache = new Map();
const inflight = new Map();

// 공공데이터포털 개발계정의 하루 호출 한도(대략)를 넘지 않게, 많이 쓴 날은 스스로 재사용 시간을 늘린다.
// (날씨는 한 번 조회에 2~3번 호출, 버스는 정류장마다 1번)
const DAILY_LIMIT = { bus: 1000, weather: 10000 / 3, subway: 1000, signal: 10000, route: 1000 };
const daily = { day: '', counts: {} };
function kstDay() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
const DAILY_FILE = join(DATA, 'daily-calls.json');
try { Object.assign(daily, JSON.parse(readFileSync(DAILY_FILE, 'utf8'))); } catch { /* 첫 실행 */ }
let dailySaveTimer = null;
function countCall(type) {
  if (daily.day !== kstDay()) { daily.day = kstDay(); daily.counts = {}; }
  daily.counts[type] = (daily.counts[type] || 0) + 1;
  // 앱을 껐다 켜도 오늘 쓴 양을 기억하도록 파일에 저장 (몇 초에 한 번)
  if (!dailySaveTimer) dailySaveTimer = setTimeout(() => { dailySaveTimer = null; try { writeFileSync(DAILY_FILE, JSON.stringify(daily)); } catch { /* 무시 */ } }, 3000);
}
function ttlFor(type) {
  const limit = DAILY_LIMIT[type];
  if (!limit || daily.day !== kstDay()) return TTL[type];
  const used = (daily.counts[type] || 0) / limit;
  if (used > 0.95) return Math.max(TTL[type], 30 * 60e3);
  if (used > 0.85) return Math.max(TTL[type], 5 * 60e3);
  if (used > 0.6) return Math.max(TTL[type], 60e3);
  return TTL[type];
}

async function cached(type, key, fn) {
  const fault = await applyFault(type === 'regions' || type === 'places' ? 'search' : type);
  if (fault === 'empty') return { empty: true };
  const useCache = Object.values(faults).every((f) => f === 'none');
  const k = type + '|' + key;
  const hit = cache.get(k);
  if (useCache && hit && Date.now() - hit.at < ttlFor(type)) return hit.value;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    upstreamCalls[type] = (upstreamCalls[type] || 0) + 1;
    countCall(type);
    const value = await fn();
    cache.set(k, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return value;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/* ───────────── 저장소: 피드백·지표 ───────────── */
await mkdir(DATA, { recursive: true });
const FEEDBACK = join(DATA, 'feedback.jsonl');
const METRICS = join(DATA, 'metrics.jsonl');

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const feedbackIds = new Set(readJsonl(FEEDBACK).map((f) => f.id));
const metricIds = new Set(readJsonl(METRICS).map((e) => e.id));

const FEEDBACK_TYPES = { error: '오류', request: '요청', other: '기타' };

// 지표 이벤트별로 허용하는 속성만 남긴다. 좌표·주소·이름·피드백 본문은 들어갈 자리가 없다.
const METRIC_PROPS = {
  app_launch: ['firstLaunch'],
  first_launch: [],
  onboarding_done: ['skipped'],
  render_complete: ['area', 'ms', 'from'],
  tab_render: ['tab', 'ms', 'from'],
  favorite_saved: ['kind'],
  api_result: ['dataType', 'result'],
  feedback_submitted: ['feedbackType'],
};
function cleanEvent(e, deviceId) {
  if (!e || typeof e !== 'object' || !METRIC_PROPS[e.name] || typeof e.id !== 'string') return null;
  const props = {};
  for (const p of METRIC_PROPS[e.name]) {
    const v = e.props?.[p];
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 24 && /^[a-zA-Z0-9_-]*$/.test(v))) props[p] = v;
  }
  return { id: e.id.slice(0, 64), deviceId: String(deviceId).slice(0, 64), name: e.name, ts: Number(e.ts) || Date.now(), props, receivedAt: Date.now() };
}

/* ───────────── HTTP 도우미 ───────────── */
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function sendError(res, err) {
  const e = err instanceof ApiError ? err : new ApiError('service');
  if (!(err instanceof ApiError)) log('ERROR', err?.stack || err);
  send(res, STATUS_BY_KIND[e.kind] || 502, { error: e.kind, detail: e.detail || undefined });
}
async function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new ApiError('badrequest', 'too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { fail(new ApiError('badrequest')); }
    });
    req.on('error', fail);
  });
}
function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ApiError('badrequest');
  return n;
}
function str(v, max = 80) {
  const s = String(v ?? '').trim();
  if (!s || s.length > max) throw new ApiError('badrequest');
  return s;
}

/* ───────────── API 라우트 ───────────── */
async function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;
  const keys = readKeys(ROOT);
  const ok = (type, data) => send(res, 200, { data, source: sourceOf(type, keys), mode: modeOf(type, keys), fetchedAt: Date.now() });

  if (p === '/api/health') return send(res, 200, { app: APP_ID, version: VERSION });
  if (p === '/api/config') {
    return send(res, 200, {
      version: VERSION,
      modes: Object.fromEntries(Object.keys(NEED_KEY).map((t) => [t, modeOf(t, keys)])),
      providers: Object.fromEntries(Object.keys(NEED_KEY).map((t) => [t, providerOf(t, keys)])),
      sources: Object.fromEntries(Object.keys(LIVE_SOURCE).map((t) => [t, sourceOf(t, keys)])),
      platform: process.platform,
    });
  }
  if (p === '/api/net') {
    if (faults.network === 'offline') return send(res, 200, { online: false });
    try {
      await Promise.race([dns.lookup('apis.data.go.kr'), sleep(2500).then(() => { throw new Error('t'); })]);
      return send(res, 200, { online: true });
    } catch {
      return send(res, 200, { online: false });
    }
  }

  // 지역·장소 검색
  if (p === '/api/regions/search') {
    const term = str(q.get('q'), 40);
    return ok('regions', await cached('regions', term, () => (modeOf('regions', keys) === 'live' ? live.searchRegions(keys, term) : demo.searchRegions(term))).then((v) => (v.empty ? [] : v)));
  }
  if (p === '/api/regions/reverse') {
    const lat = num(q.get('lat')), lon = num(q.get('lon'));
    const v = await cached('regions', `rev:${lat.toFixed(3)},${lon.toFixed(3)}`, () => (modeOf('regions', keys) === 'live' ? live.reverseRegion(keys, lat, lon) : demo.reverseRegion(lat, lon)));
    return ok('regions', v.empty ? { name: '알 수 없는 지역', supported: false } : v);
  }
  if (p === '/api/places/search') {
    const term = str(q.get('q'), 40);
    return ok('places', await cached('places', term, () => (modeOf('places', keys) === 'live' ? live.searchPlaces(keys, term) : demo.searchPlaces(term))).then((v) => (v.empty ? [] : v)));
  }

  // 날씨
  if (p === '/api/weather') {
    const lat = num(q.get('lat')), lon = num(q.get('lon'));
    const v = await cached('weather', `${lat.toFixed(2)},${lon.toFixed(2)}`, () => (modeOf('weather', keys) === 'live' ? live.weather(keys, lat, lon) : demo.weather(lat, lon)));
    if (v.empty) throw new ApiError('service');
    return ok('weather', v);
  }

  // 교통 대상 검색
  if (p === '/api/transit/search' || p === '/api/transit/nearby') {
    const type = q.get('type');
    if (!['bus', 'subway', 'signal'].includes(type)) throw new ApiError('badrequest');
    const keyType = type;
    const prov = providerOf(type, keys);
    let v;
    if (p.endsWith('search')) {
      const term = str(q.get('q'), 40);
      v = await cached('search', `${type}:${term}:${prov}`, () => {
        if (prov === 'demo') return demo.searchTransit(type, term);
        if (type === 'bus') return both(() => live.searchBus(keys, term), () => dg.searchBusGg(keys, term));
        if (type === 'subway') return prov === 'realtime' ? live.searchSubway(keys, term) : dg.searchSubwayTago(keys, term);
        return prov === 'tdata' ? live.searchSignal(keys, term) : dg.searchSignalKlid(keys, term);
      });
    } else {
      const lat = num(q.get('lat')), lon = num(q.get('lon'));
      v = await cached('search', `near:${type}:${lat.toFixed(3)},${lon.toFixed(3)}:${prov}`, () => {
        if (prov === 'demo') return demo.nearbyTransit(type, lat, lon);
        if (type === 'bus') return both(() => live.nearbyBus(keys, lat, lon), () => dg.nearbyBusGg(keys, lat, lon)).then((l) => l.sort((a, b) => (a.distanceM ?? 9e9) - (b.distanceM ?? 9e9)).slice(0, 12));
        if (type === 'subway') return live.nearbySubway(lat, lon);
        return prov === 'tdata' ? live.nearbySignal(keys, lat, lon) : dg.nearbySignalKlid(keys, lat, lon);
      });
    }
    return ok(keyType, v.empty ? [] : v);
  }

  // 교통 실시간
  if (p === '/api/transit/bus') {
    const gg = q.get('gg');
    const id = str(gg || q.get('arsId'), 16);
    const isLive = modeOf('bus', keys) === 'live';
    const v = await cached('bus', (gg ? 'gg' : '') + id, () => {
      if (!isLive) return demo.bus(id);
      return gg ? dg.busGg(keys, id) : live.bus(keys, id);
    });
    return ok('bus', v.empty ? { state: 'none', arrivals: [] } : v);
  }
  if (p === '/api/transit/subway') {
    const st = str(q.get('station'), 30);
    const prov = providerOf('subway', keys);
    const v = await cached('subway', `${prov}:${st}`, () => (prov === 'realtime' ? live.subway(keys, st) : prov === 'schedule' ? dg.subwaySchedule(keys, st) : demo.subway(st)));
    return ok('subway', v.empty ? { state: 'none', lines: [] } : v);
  }
  if (p === '/api/transit/subway-status') {
    const st = str(q.get('station'), 30);
    const prov = providerOf('subway', keys);
    // 시간표 모드에는 운행 현황 정보가 없다 (빈 목록 + basis 표시)
    if (prov === 'schedule' && faults.subwayStatus === 'none' && faults.network === 'none') return ok('subway', { lines: [], basis: 'schedule' });
    const v = await cached('subwayStatus', `${prov}:${st}`, () => (prov === 'realtime' ? live.subwayStatus(keys, st) : demo.subwayStatus(st)));
    return ok('subway', v.empty ? { lines: [] } : v);
  }
  if (p === '/api/transit/route') {
    const o = { lat: num(q.get('sy')), lon: num(q.get('sx')), name: '' };
    const d = { lat: num(q.get('ey')), lon: num(q.get('ex')), name: '' };
    const v = await cached('route', `${o.lat},${o.lon}>${d.lat},${d.lon}`, () => (modeOf('route', keys) === 'live' ? live.route(keys, o, d) : demo.route(o, d)));
    return ok('route', v.empty ? { state: 'none', reason: 'noroute' } : v);
  }
  if (p === '/api/transit/signal') {
    const id = str(q.get('id'), 40);
    const prov = providerOf('signal', keys);
    // 저장할 때 쓴 공급자를 id 모양으로 구분한다: D-(데모) · K-(공공데이터포털) · 그 외(T-data)
    const v = await cached('signal', id, () => {
      if (id.startsWith('D-') || prov === 'demo') return demo.signal(id);
      if (id.startsWith('K-')) return keys.DATA_GO_KR_KEY ? dg.signalKlid(keys, id) : demo.signal(id);
      return keys.TDATA_KEY ? live.signal(keys, id) : { state: 'unsupported' };
    });
    return ok('signal', v.empty ? { state: 'unsupported' } : v);
  }

  // 피드백 (R-24): 유형·내용·(오류일 때) 앱·OS 버전만 저장한다.
  if (p === '/api/feedback' && req.method === 'POST') {
    const b = await readBody(req);
    const f = await applyFault('feedback');
    if (f === 'empty') throw new ApiError('service');
    const id = str(b.id, 64);
    const type = FEEDBACK_TYPES[b.type] ? b.type : null;
    const content = String(b.content ?? '').trim();
    if (!type || !content || content.length > 2000) throw new ApiError('badrequest');
    if (feedbackIds.has(id)) return send(res, 200, { ok: true, duplicate: true });
    const rec = { id, type, content, receivedAt: Date.now() };
    if (type === 'error') {
      rec.appVersion = String(b.appVersion || '').slice(0, 20);
      rec.osVersion = String(b.osVersion || '').slice(0, 40);
    }
    feedbackIds.add(id);
    await appendFile(FEEDBACK, JSON.stringify(rec) + '\n', 'utf8');
    return send(res, 200, { ok: true });
  }

  // 익명 지표 (R-25)
  if (p === '/api/metrics' && req.method === 'POST') {
    const b = await readBody(req, 256 * 1024);
    await applyFault('metrics');
    const deviceId = str(b.deviceId, 64);
    const lines = [];
    for (const e of Array.isArray(b.events) ? b.events.slice(0, 500) : []) {
      const c = cleanEvent(e, deviceId);
      if (c && !metricIds.has(c.id)) { metricIds.add(c.id); lines.push(JSON.stringify(c)); }
    }
    if (lines.length) await appendFile(METRICS, lines.join('\n') + '\n', 'utf8');
    return send(res, 200, { ok: true, accepted: lines.length });
  }

  // Windows 설정 열기 (권한 거부 안내의 'Windows 설정 열기' 버튼)
  if (p === '/api/open-settings' && req.method === 'POST') {
    const b = await readBody(req);
    const target = { location: 'ms-settings:privacy-location', notifications: 'ms-settings:notifications' }[b.target];
    if (!target) throw new ApiError('badrequest');
    if (process.platform !== 'win32') return send(res, 501, { error: 'unsupported' });
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/open-keys' && req.method === 'POST') {
    if (process.platform !== 'win32') return send(res, 501, { error: 'unsupported' });
    spawn('notepad.exe', [join(ROOT, 'API_KEYS.bat')], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }

  // 시험 도구
  // 업데이트: 앱 파일(web·server·exe)이 켜질 때와 달라졌는지 알려 준다.
  // 업데이트 확인: GitHub의 version.json이 이 PC보다 새로우면 알린다.
  // (이미 받아 두고 아직 다시 시작하지 않은 경우도 알린다)
  if (p === '/api/update') {
    const local = readRelease();
    const remote = await remoteRelease();
    const remoteNewer = remote && compareVersions(remote.version, local.version) > 0;
    const pending = local.version !== BOOT_RELEASE.version;
    const next = remoteNewer ? remote : local;
    return send(res, 200, {
      available: !!(remoteNewer || pending),
      current: BOOT_RELEASE.version,
      next: next.version,
      notes: next.notes,
      source: remoteNewer ? 'github' : 'local',
      bootId: BOOT_ID,
      canRestart: !!process.env.PROTO_LAUNCHER,
    });
  }
  // 업데이트 적용: GitHub에서 새 파일을 받은 뒤 종료 코드 42로 끝내면, Prototype.exe가 서버를 새로 켠다.
  if ((p === '/api/update/apply' || p === '/api/restart') && req.method === 'POST') {
    if (!process.env.PROTO_LAUNCHER) return send(res, 409, { error: 'nolauncher' });
    try {
      const local = readRelease();
      const remote = await remoteRelease();
      if (remote && compareVersions(remote.version, local.version) > 0) await downloadUpdate(ROOT, log);
    } catch (e) {
      log('update download failed:', e.message);
      return send(res, 502, { error: 'download', detail: String(e.message).slice(0, 120) });
    }
    send(res, 200, { ok: true });
    log('restart requested for update');
    setTimeout(() => process.exit(42), 300);
    return;
  }

  if (p === '/api/debug/faults') {
    if (req.method === 'POST') {
      const b = await readBody(req);
      for (const [t, m] of Object.entries(b || {})) if (FAULT_TYPES.includes(t) && FAULT_MODES.includes(m)) faults[t] = m;
      if (b?.clearCache) cache.clear();
    }
    return send(res, 200, { faults, types: FAULT_TYPES, modes: FAULT_MODES });
  }
  if (p === '/api/debug/stats') {
    if (req.method === 'POST') for (const k of Object.keys(upstreamCalls)) upstreamCalls[k] = 0;
    return send(res, 200, { upstreamCalls });
  }

  throw new ApiError('notfound');
}

/* ───────────── 운영자 화면 ───────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function p75(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.75) - 1)];
}
function adminPage(url) {
  const filter = url.searchParams.get('type') || '';
  const fb = readJsonl(FEEDBACK).filter((f) => !filter || f.type === filter).sort((a, b) => b.receivedAt - a.receivedAt);
  const ev = readJsonl(METRICS);
  const devices = new Set(ev.map((e) => e.deviceId));
  const firsts = new Set(ev.filter((e) => e.name === 'first_launch').map((e) => e.deviceId));
  const savedW = new Set(ev.filter((e) => e.name === 'favorite_saved' && e.props.kind === 'weather').map((e) => e.deviceId));
  const savedT = new Set(ev.filter((e) => e.name === 'favorite_saved' && e.props.kind !== 'weather').map((e) => e.deviceId));
  const setupDone = [...firsts].filter((d) => savedW.has(d) && savedT.has(d)).length;
  const render = {};
  for (const e of ev.filter((x) => x.name === 'render_complete')) (render[e.props.area] ||= []).push(e.props.ms);
  const tabs = ev.filter((x) => x.name === 'tab_render').map((e) => e.props.ms);
  const api = {};
  for (const e of ev.filter((x) => x.name === 'api_result')) {
    const a = (api[e.props.dataType] ||= { total: 0, fail: 0, byResult: {} });
    a.total++;
    if (e.props.result !== 'success') a.fail++;
    a.byResult[e.props.result] = (a.byResult[e.props.result] || 0) + 1;
  }
  const days = {};
  for (const e of ev.filter((x) => x.name === 'app_launch')) {
    const day = new Date(e.ts + 9 * 3600e3).toISOString().slice(0, 10);
    (days[e.deviceId] ||= new Set()).add(day);
  }
  const fbCount = {};
  for (const e of ev.filter((x) => x.name === 'feedback_submitted')) fbCount[e.props.feedbackType] = (fbCount[e.props.feedbackType] || 0) + 1;
  const ms = (v) => (v == null ? '—' : `${Math.round(v)}ms`);
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>운영자 화면</title><style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#14161a;--muted:#5b616b;--line:#e1e4e8;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--text:#eef0f3;--muted:#a7adb7;--line:#2a2f38;--accent:#60a5fa}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 "Segoe UI Variable","Malgun Gothic",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px 16px;overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child th,tr:last-child td{border-bottom:0}
th{font-weight:600;white-space:nowrap}nav a{margin-right:12px;color:var(--accent)}nav a[aria-current]{font-weight:700;text-decoration:none}
td.c{white-space:pre-wrap;word-break:break-word;max-width:520px}</style></head><body><main>
<h1>운영자 화면</h1><p class="muted">이 PC의 data 폴더에 모인 피드백과 익명 지표입니다. 좌표·주소·이름·피드백 본문은 지표에 저장되지 않습니다.</p>
<h2>지표 요약 (M-01 ~ M-05)</h2><div class="card"><table>
${row('기기 수 (익명)', devices.size)}
${row('M-01 홈 첫 표시 p75', Object.entries(render).map(([a, v]) => `${esc(a)} ${ms(p75(v))} (${v.length}건)`).join(' · ') || '—')}
${row('M-01 탭 전환 후 표시 p75', `${ms(p75(tabs))} (${tabs.length}건)`)}
${row('M-02 초기 설정 완료율', firsts.size ? `${Math.round((setupDone / firsts.size) * 100)}% (${setupDone}/${firsts.size})` : '—')}
${row('M-03 기기별 앱 실행 일수', Object.values(days).map((s) => s.size).join(', ') || '—')}
${row('M-04 조회 실패율', Object.entries(api).map(([t, a]) => `${esc(t)} ${((a.fail / a.total) * 100).toFixed(1)}% (${a.fail}/${a.total})`).join(' · ') || '—')}
${row('M-05 피드백 제출', Object.entries(fbCount).map(([t, n]) => `${esc(FEEDBACK_TYPES[t] || t)} ${n}`).join(' · ') || '—')}
</table></div>
<h2>피드백 (${fb.length}건)</h2>
<nav><a href="/admin" ${!filter ? 'aria-current="page"' : ''}>전체</a>${Object.entries(FEEDBACK_TYPES).map(([k, v]) => `<a href="/admin?type=${k}" ${filter === k ? 'aria-current="page"' : ''}>${v}</a>`).join('')}</nav>
<div class="card" style="margin-top:10px"><table><tr><th>받은 시각</th><th>유형</th><th>내용</th><th>앱·OS 버전</th></tr>
${fb.map((f) => `<tr><td>${esc(new Date(f.receivedAt).toLocaleString('ko-KR'))}</td><td>${esc(FEEDBACK_TYPES[f.type])}</td><td class="c">${esc(f.content)}</td><td>${f.type === 'error' ? esc(`${f.appVersion} / ${f.osVersion}`) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">아직 받은 피드백이 없어요.</td></tr>'}
</table></div></main></body></html>`;
}

/* ───────────── 정적 파일 ───────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = normalize(join(WEB, rel));
  if (!file.startsWith(WEB + sep)) return send(res, 403, 'forbidden', 'text/plain');
  try {
    const body = await readFile(file);
    send(res, 200, body, MIME[extname(file).toLowerCase()] || 'application/octet-stream');
  } catch {
    // 앱 안의 화면 주소는 모두 index.html이 처리한다.
    if (!extname(file)) return serveStatic(res, '/index.html');
    send(res, 404, 'not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  // 다른 웹사이트가 이 서버를 부르지 못하게, 브라우저 Origin이 있으면 우리 주소만 허용한다.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) return send(res, 403, { error: 'forbidden' });
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['/api/health', '/api/net'].includes(url.pathname) && !url.pathname.startsWith('/api/debug')) log(req.method, url.pathname);
      return await api(req, res, url);
    }
    if (url.pathname === '/admin') return send(res, 200, adminPage(url), 'text/html; charset=utf-8');
    return await serveStatic(res, url.pathname);
  } catch (err) {
    return sendError(res, err);
  }
});

server.on('error', (err) => {
  log('LISTEN ERROR', err.code || err.message);
  process.exit(err.code === 'EADDRINUSE' ? 3 : 1);
});
server.listen(PORT, HOST, () => {
  log(`server ready http://${HOST}:${PORT} (node ${process.version}, ${os.type()} ${os.release()})`);
});
