// 앱 시계: 기기(PC·휴대폰) 시계를 그대로 쓰되, 인터넷 표준 시각과 다르면 그 차이만큼 고쳐서 보여 준다.
//  - 평소: 기기 시계 (끊김 없이 0.01초까지 매끄럽게 움직임)
//  - 인터넷 시각(NTP)과 0.3초 넘게 다르면 → 그 차이(보정값)를 더한다
//  - 와이파이·데이터가 끊겨도 마지막 보정값을 계속 쓴다 (기기 시계는 그동안에도 움직이므로 정확도가 유지됨)
//  - 기기 시계가 갑자기 바뀌면(사용자가 시각을 바꿈, 절전 해제 등) 바로 알아채고 다시 맞춘다
// 보정값은 서버(PC: NTP), 휴대폰 앱(Android: NTP), 모바일 웹(웹 서버 Date 헤더, 1초 단위)에서 받는다.

const STORE = 'proto.clock.v1';
const RESYNC_MS = 10 * 60e3; // 10분마다 다시 확인
const JUMP_MS = 1500; // 기기 시계가 이만큼 튀면 다시 맞춘다

let offset = 0; // 표준 시각 - 기기 시각 (ms)
let info = { source: null, at: 0, offset: 0, precisionMs: null, applied: false };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved && Number.isFinite(saved.offset)) { info = saved; offset = saved.applied ? saved.offset : 0; }
} catch { /* 무시 */ }

const listeners = new Set();
export function onClockChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** 보정된 지금 시각 (ms). Date.now() 대신 쓴다. */
export function now() { return Date.now() + offset; }
/** 보정된 지금 시각 (Date) */
export function nowDate() { return new Date(now()); }
export function clockInfo() { return { ...info, appliedOffset: offset }; }

let syncing = null;
export function syncClock() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const t0 = Date.now();
      const r = await fetch('/api/time', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const t1 = Date.now();
      if (!r.ok) return;
      const j = await r.json();
      if (!Number.isFinite(j.trueNow)) return;
      // 응답이 오는 데 걸린 시간의 절반만큼 뒤의 시각이 지금
      const measured = j.trueNow + (t1 - t0) / 2 - t1;
      const precision = (j.precisionMs ?? 1000) + (t1 - t0) / 2;
      // 기기 시계가 측정 오차보다 확실히 다를 때만 고친다 (작은 흔들림으로 시계가 튀지 않게)
      const threshold = Math.max(300, precision);
      const applied = Math.abs(measured) > threshold;
      const next = applied ? Math.round(measured) : 0;
      info = { source: j.source || 'net', at: t1, offset: Math.round(measured), precisionMs: Math.round(precision), applied };
      try { localStorage.setItem(STORE, JSON.stringify(info)); } catch { /* 무시 */ }
      if (next !== offset) { offset = next; for (const fn of listeners) fn(); }
    } catch { /* 오프라인: 마지막 보정값 그대로 */ } finally { syncing = null; }
  })();
  return syncing;
}

// 기기 시계가 튀었는지 감시: performance.now()는 시계를 바꿔도 영향을 받지 않는다.
let lastWall = Date.now();
let lastMono = performance.now();
function watchJump() {
  const wall = Date.now();
  const mono = performance.now();
  const jump = (wall - lastWall) - (mono - lastMono);
  lastWall = wall; lastMono = mono;
  // (휴대폰이 잠들었다 깨어날 때도 여기에 걸리므로 보정값을 짐작하지 않고 다시 재기만 한다)
  if (Math.abs(jump) > JUMP_MS) syncClock();
}

let started = false;
export function startClock() {
  if (started) return;
  started = true;
  syncClock();
  setInterval(syncClock, RESYNC_MS);
  setInterval(watchJump, 1000);
  addEventListener('online', () => syncClock());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { watchJump(); syncClock(); } });
}
