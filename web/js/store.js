// 기기 저장소: 지역·교통 대상·출발 알림·안내 완료 여부(설정)와 항목별 마지막 성공 데이터(캐시).
// 로그인 없이 이 PC의 앱 창에만 저장된다 (PRD 로그인 없음·기기 저장).
import { uid } from './ui.js';

const SETTINGS_KEY = 'proto.settings.v1';
const CACHE_KEY = 'proto.cache.v1';

export class SaveError extends Error {}

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what) {
  for (const fn of [...listeners]) {
    try { fn(what); } catch (e) { console.error(e); }
  }
}

function defaults() {
  return {
    regions: [], // {id, kind:'place'|'current', name, label, lat, lon}
    homeRegionId: null,
    targets: [], // {id, type:'bus'|'subway'|'signal'|'route', name, label, sub, ref}
    alarms: [], // {id, name, hour, minute, repeat:'once'|'weekly', days:[0-6], enabled, nextAt}
    events: [], // 달력 내 일정 {id, date:'YYYY-MM-DD', time:'HH:MM'|'', title, memo, repeat:'none'|'yearly'|'monthly'|'weekly'}
    unavailable: {}, // targetId → true (외부 데이터에서 조회 불가)
    onboardingDone: false,
    lastTab: 'weather',
    deviceId: uid(),
    firstLaunchLogged: false,
    notifAsked: false,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults(), isNew: true };
    return { ...defaults(), ...JSON.parse(raw), isNew: false };
  } catch {
    // 읽지 못하면 비어 있는 상태로 계속 동작한다 (F-16 예외)
    return { ...defaults(), isNew: true, readFailed: true };
  }
}

export const state = load();
const isNewInstall = state.isNew;
delete state.isNew;
export function wasNewInstall() { return isNewInstall; }

// 다운로드 페이지의 '미리보기'(주소 뒤 ?preview): 아무것도 저장하지 않은 사람에게는 예시 지역·교통을 넣어서
// 앱이 실제로 돌아가는 모습을 보여 준다. 예시를 쓰는 동안에는 이 기기에 아무것도 저장하지 않는다.
export const PREVIEW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('preview');
let sample = false;
if (PREVIEW && !state.onboardingDone && !state.regions.length && !state.targets.length) {
  sample = true;
  Object.assign(state, {
    regions: [{ id: 'sample-r', kind: 'place', name: '서울특별시 중구 명동', label: '', lat: 37.5609, lon: 126.9863 }],
    homeRegionId: 'sample-r',
    targets: [
      { id: 'sample-b', type: 'bus', key: 'bus:01001', name: '광화문', label: '', sub: '시청 방면 · 정류소 01001', ref: { arsId: '01001' } },
      { id: 'sample-s', type: 'subway', key: 'subway:시청', name: '시청역', label: '', sub: '1호선 · 2호선', ref: { station: '시청', lines: ['1호선', '2호선'] } },
    ],
    onboardingDone: true,
  });
}
export function usingSample() { return sample; }

// 시험 도구에서 '기기 저장 실패'를 흉내 낼 수 있게 한다.
export const testFlags = { failSave: false };

function persist(next) {
  if (testFlags.failSave) throw new SaveError('test');
  if (sample) return; // 미리보기 예시: 저장하지 않음
  try {
    const { readFailed, ...rest } = next;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  } catch (e) {
    throw new SaveError(e?.message || 'save failed');
  }
}

// 바꾼 내용을 저장하고, 실패하면 이전 상태로 되돌린 뒤 SaveError를 던진다.
export function update(mutator, what = 'settings') {
  const before = structuredClone(state);
  mutator(state);
  try {
    persist(state);
  } catch (e) {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, before);
    throw e;
  }
  emit(what);
}
export function saveQuiet() {
  try { persist(state); } catch { /* 지표·탭 기억 같은 부가 정보는 실패해도 무시 */ }
}

/* ───────── 지역 ───────── */
export const regionLabel = (r) => (r ? r.label || r.name : '');
export function homeRegion() {
  return state.regions.find((r) => r.id === state.homeRegionId) || null;
}
export function sameRegion(a, b) {
  if (a.kind === 'current' || b.kind === 'current') return a.kind === b.kind;
  return a.name === b.name || (Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lon - b.lon) < 0.002);
}
export function addRegion(r) {
  if (state.regions.some((x) => sameRegion(x, r))) return { duplicate: true };
  const region = { id: uid(), label: '', ...r };
  update((s) => {
    s.regions.push(region);
    if (!s.homeRegionId || !s.regions.some((x) => x.id === s.homeRegionId)) s.homeRegionId = region.id;
  }, 'regions');
  return { region };
}
export function editRegion(id, { label, makeHome }) {
  update((s) => {
    const r = s.regions.find((x) => x.id === id);
    if (!r) return;
    if (label !== undefined) r.label = label.trim() === r.name ? '' : label.trim();
    if (makeHome) s.homeRegionId = id;
  }, 'regions');
}
export function setHomeRegion(id) {
  update((s) => { s.homeRegionId = id; }, 'regions');
}
export function deleteRegion(id) {
  update((s) => {
    s.regions = s.regions.filter((r) => r.id !== id);
    if (s.homeRegionId === id) s.homeRegionId = s.regions[0]?.id || null;
  }, 'regions');
  dropCache(`weather:${id}`);
}

/* ───────── 교통 대상 ───────── */
export const targetLabel = (t) => (t ? t.label || t.name : '');
export function sameTarget(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'route') {
    const near = (p, q) => Math.abs(p.lat - q.lat) < 0.0005 && Math.abs(p.lon - q.lon) < 0.0005;
    return near(a.ref.origin, b.ref.origin) && near(a.ref.dest, b.ref.dest);
  }
  return a.key === b.key;
}
export function addTarget(t) {
  if (state.targets.some((x) => sameTarget(x, t))) return { duplicate: true };
  const target = { id: uid(), label: '', ...t };
  update((s) => { s.targets.push(target); }, 'targets');
  return { target };
}
export function editTarget(id, patch) {
  const t = state.targets.find((x) => x.id === id);
  if (!t) return {};
  if (patch.ref && t.type === 'route') {
    const probe = { ...t, ref: patch.ref };
    if (state.targets.some((x) => x.id !== id && sameTarget(x, probe))) return { duplicate: true };
  }
  update((s) => {
    const x = s.targets.find((y) => y.id === id);
    if (patch.label !== undefined) x.label = patch.label.trim() === x.name ? '' : patch.label.trim();
    if (patch.ref) {
      x.ref = patch.ref;
      x.name = patch.name || x.name;
      delete s.unavailable[id];
    }
  }, 'targets');
  if (patch.ref) dropCache(`t:${id}`);
  return { ok: true };
}
export function moveTarget(id, toIndex) {
  update((s) => {
    const from = s.targets.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [t] = s.targets.splice(from, 1);
    s.targets.splice(Math.max(0, Math.min(toIndex, s.targets.length)), 0, t);
  }, 'targets');
}
export function deleteTarget(id) {
  update((s) => {
    s.targets = s.targets.filter((t) => t.id !== id);
    delete s.unavailable[id];
  }, 'targets');
  dropCache(`t:${id}`);
  dropCache(`ts:${id}`);
}
// 달력 내 일정 저장·삭제
export function saveEvent(ev) {
  update((s) => {
    const i = s.events.findIndex((x) => x.id === ev.id);
    if (i >= 0) s.events[i] = ev;
    else s.events.push(ev);
  }, 'events');
}
export function deleteEvent(id) {
  update((s) => { s.events = s.events.filter((x) => x.id !== id); }, 'events');
}
export function setUnavailable(id, flag) {
  if (!!state.unavailable[id] === !!flag) return;
  if (flag) state.unavailable[id] = true;
  else delete state.unavailable[id];
  saveQuiet();
  emit('unavailable');
}

/* ───────── 출발 알림 ───────── */
export function saveAlarm(alarm) {
  update((s) => {
    const i = s.alarms.findIndex((a) => a.id === alarm.id);
    if (i >= 0) s.alarms[i] = alarm;
    else s.alarms.push(alarm);
  }, 'alarms');
}
export function deleteAlarm(id) {
  update((s) => { s.alarms = s.alarms.filter((a) => a.id !== id); }, 'alarms');
}

/* ───────── 마지막 성공 데이터 (캐시) ───────── */
let cacheMem;
function cacheAll() {
  if (cacheMem) return cacheMem;
  try {
    cacheMem = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
  } catch {
    cacheMem = {}; // 캐시를 읽을 수 없으면 캐시 없음으로 처리 (F-14)
  }
  return cacheMem;
}
function cacheFlush() {
  if (sample) return; // 미리보기 예시: 저장하지 않음
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cacheMem)); } catch { /* 캐시 저장 실패는 앱 실행에 영향 없음 */ }
}
export function getCache(key) {
  return cacheAll()[key] || null;
}
export function setCache(key, entry) {
  cacheAll()[key] = entry;
  cacheFlush();
}
export function dropCache(key) {
  const all = cacheAll();
  if (key in all) { delete all[key]; cacheFlush(); }
}
export function clearEverything() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem('proto.metrics.v1');
  } catch { /* 무시 */ }
}
