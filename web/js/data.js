// 날씨·교통 데이터 관리자 (R-17, R-19, R-23, R-05)
// - 영역·항목마다 독립 조회, 같은 대상 중복 요청은 하나로 묶음
// - 성공 데이터는 기기 캐시에 저장하고 다음 실행·오프라인 때 먼저 보여 줌
// - 데이터 종류별 자동 갱신 간격, 간격 안의 반복 새로고침은 호출 없이 재사용
// - 연속 실패·호출 한도 초과 때 간격을 늘림, 화면이 숨겨져 있으면 갱신 안 함
// - 네트워크가 돌아오면 사용자 조작 없이 다시 조회
import { getJSON, net, recheckNet } from './net.js';
import { getCache, setCache, state, setUnavailable } from './store.js';
import { track } from './metrics.js';

// interval: 자동 갱신 간격, minGap: 이 시간 안의 반복 요청은 재사용
export const POLICY = {
  // 사용자 요청 (2026-11-09): 날씨·버스 10초마다. 서버가 하루 호출 한도를 넘지 않게 따로 조절한다.
  weather: { interval: 10e3, minGap: 5e3 },
  // 날씨 자세히 (Open-Meteo): 모델이 1시간마다 바뀌어서 10분이면 충분
  weatherDetail: { interval: 10 * 60e3, minGap: 5 * 60e3 },
  bus: { interval: 10e3, minGap: 5e3 },
  subway: { interval: 30e3, minGap: 15e3 },
  subwayStatus: { interval: 2 * 60e3, minGap: 60e3 },
  route: { interval: 5 * 60e3, minGap: 2 * 60e3 },
  signal: { interval: 10e3, minGap: 5e3 },
  // 내 주변 신호등 목록 (위치가 크게 바뀌지 않으니 5분마다)
  signalNearby: { interval: 5 * 60e3, minGap: 60e3 },
};
const MAX_CONCURRENT = 4;

const entries = new Map(); // key → entry
const typeBackoffUntil = {}; // 호출 한도 초과 때 데이터 종류 전체를 늦춘다
let active = new Set(); // 지금 홈에 보이는 항목 key
const listeners = new Set();
let running = 0;
const waiting = [];

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(key) {
  for (const fn of [...listeners]) {
    try { fn(key); } catch (e) { console.error(e); }
  }
}

// spec: { key, type, url:()=>string|Promise<string>, metricType }
export function register(spec) {
  let e = entries.get(spec.key);
  if (!e) {
    e = { key: spec.key, type: spec.type, loading: false, error: null, inflight: null, lastAttempt: 0, lastSuccess: 0, failCount: 0, nextAuto: 0 };
    entries.set(spec.key, e);
    const c = getCache(spec.key);
    if (c) e.lastSuccess = c.updatedAt;
  }
  e.spec = spec;
  return e;
}

export function setActive(keys) {
  active = new Set(keys);
}

export function view(key) {
  const e = entries.get(key);
  const cache = getCache(key);
  return {
    data: cache?.data ?? null,
    updatedAt: cache?.updatedAt ?? null,
    source: cache?.source ?? null,
    mode: cache?.mode ?? null,
    loading: !!e?.loading,
    error: e?.error || null,
  };
}

function runLimited(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn().then(resolve, reject).finally(() => {
        running--;
        waiting.shift()?.();
      });
    };
    if (running < MAX_CONCURRENT) go();
    else waiting.push(go);
  });
}

// opts.force: 간격 무시 (네트워크 복구·지역 변경 직후)
export function request(key, opts = {}) {
  const e = entries.get(key);
  if (!e) return Promise.resolve();
  if (e.inflight) return e.inflight; // 이미 조회 중이면 그 결과를 같이 기다린다
  const now = Date.now();
  const policy = POLICY[e.type];
  if (!opts.force && e.lastSuccess && now - e.lastSuccess < policy.minGap && !e.error) return Promise.resolve();
  if (!net.online) {
    e.error = { kind: 'offline' };
    notify(key);
    return Promise.resolve();
  }
  e.loading = true;
  e.lastAttempt = now;
  notify(key);
  e.inflight = runLimited(async () => {
    try {
      const res = e.spec.fetch ? await e.spec.fetch() : await getJSON(await e.spec.url());
      const data = res.data;
      setCache(key, { data, updatedAt: res.fetchedAt || Date.now(), source: res.source, mode: res.mode });
      e.lastSuccess = Date.now();
      e.error = null;
      e.failCount = 0;
      e.nextAuto = 0;
      if (e.spec.targetId) setUnavailable(e.spec.targetId, false);
      if (e.spec.metricType) track('api_result', { dataType: e.spec.metricType, result: 'success' });
    } catch (err) {
      const kind = err.kind || 'service';
      e.error = { kind, detail: err.detail };
      e.failCount++;
      const policy2 = POLICY[e.type];
      // 실패가 이어질수록 다음 자동 조회를 늦춘다 (최대 16배)
      e.nextAuto = Date.now() + policy2.interval * Math.min(16, 2 ** Math.min(e.failCount, 4)) * (e.type === 'signal' ? 0.5 : 1);
      if (kind === 'quota') typeBackoffUntil[e.type] = Date.now() + Math.max(5 * 60e3, policy2.interval * 4);
      if (kind === 'notfound' && e.spec.targetId) setUnavailable(e.spec.targetId, true);
      if (err.locationError) e.error = { kind: 'location', detail: err.locationError };
      else if (e.spec.metricType && kind !== 'offline') track('api_result', { dataType: e.spec.metricType, result: kind });
    } finally {
      e.loading = false;
      e.inflight = null;
      notify(key);
    }
  });
  return e.inflight;
}

export function refreshActive(opts = {}) {
  return Promise.all([...active].map((k) => request(k, opts)));
}

function due(e, now) {
  if (e.inflight || !net.online || document.hidden) return false;
  if (typeBackoffUntil[e.type] && now < typeBackoffUntil[e.type]) return false;
  if (e.error && now < e.nextAuto) return false;
  return !e.lastSuccess || now - e.lastSuccess >= POLICY[e.type].interval;
}

function tick() {
  const now = Date.now();
  for (const key of active) {
    const e = entries.get(key);
    if (e && due(e, now)) request(key);
  }
}

let recovering = false;
const recoverListeners = new Set();
export function onRecovering(fn) {
  recoverListeners.add(fn);
  return () => recoverListeners.delete(fn);
}
export function isRecovering() {
  return recovering;
}

export function startScheduler() {
  setInterval(tick, 1000);
  // 화면으로 돌아오면 간격이 지난 항목만 바로 조회 (F-15-AC-03)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  net.onChange(async (online) => {
    if (!online) {
      for (const e of entries.values()) if (active.has(e.key) && !e.inflight) e.error = { kind: 'offline' };
      notify('*');
      return;
    }
    // 네트워크 복구 → 조작 없이 모두 다시 조회하고, 끝나면 오프라인 배너를 내린다 (R-05)
    recovering = true;
    for (const fn of recoverListeners) fn(true);
    for (const e of entries.values()) if (e.error?.kind === 'offline') { e.error = null; e.nextAuto = 0; }
    await refreshActive({ force: true });
    recovering = false;
    const stillOffline = [...active].some((k) => entries.get(k)?.error?.kind === 'offline');
    if (stillOffline) recheckNet();
    for (const fn of recoverListeners) fn(false);
  });
}

// 시험 도구용
export function debugEntries() {
  return [...entries.values()].map((e) => ({ key: e.key, type: e.type, loading: e.loading, error: e.error?.kind, failCount: e.failCount }));
}
export function hasDataTypeBackoff(type) {
  return typeBackoffUntil[type] && Date.now() < typeBackoffUntil[type];
}
export { state };
