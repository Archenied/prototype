// 앱 시계: 기기(PC·휴대폰) 시계를 그대로 쓰되, 인터넷 표준 시각과 다르면 그 차이만큼 고쳐서 보여 준다.
//  - 평소: 기기 시계 (끊김 없이 0.01초까지 매끄럽게 움직임)
//  - 인터넷 시각과 오차 범위보다 확실히 다르면 → 그 차이(보정값)를 더한다
//  - 와이파이·데이터가 끊겨도 마지막 보정값을 계속 쓴다 (기기 시계는 그동안에도 움직이므로 정확도가 유지됨)
//  - 기기 시계가 갑자기 바뀌면(사용자가 시각을 바꿈, 절전 해제 등) 바로 알아채고 다시 맞춘다
// 인터넷 상태를 함께 따진다:
//  - 요청이 오가는 데 걸린 시간(왕복 지연)의 절반만큼 늦게 도착했다고 보고 시각을 보정한다
//  - 인터넷이 느리면(지연이 크면) 그만큼 "오차 범위"가 커지고, 그 범위 안의 차이로는 시계를 고치지 않는다
//  - 웹 버전은 여러 번 재서 가장 빠르게 온(=가장 정확한) 것을 쓴다
//  - 옛 측정값과 새 측정값이 겹치면 정확한 쪽에 더 무게를 두고 합친다 (옛 값은 시간이 지날수록 덜 믿는다)
// 보정값은 서버(PC: NTP), 휴대폰 앱(Android: NTP), 웹 버전(웹 서버 Date 헤더, 1초 단위)에서 받는다.

const STORE = 'proto.clock.v1';
const RESYNC_MS = 10 * 60e3; // 10분마다 다시 확인
const JUMP_MS = 1500; // 기기 시계가 이만큼 튀면 다시 맞춘다
const SAMPLES = 3; // 웹 버전: 여러 번 재서 가장 정확한 것을 쓴다
const DRIFT_MS_PER_S = 0.1; // 기기 시계가 하루에 조금씩 틀어지는 정도 (옛 측정을 덜 믿는 속도)

let offset = 0; // 표준 시각 - 기기 시각 (ms), 화면에 실제로 더하는 값
let info = { source: null, at: 0, offset: 0, precisionMs: null, applied: false, rtt: null, jitter: null, quality: null, samples: 0 };

// 웹 버전에서 저장을 허용하지 않았다면 쓰지 않는다 (consent.js와 같은 규칙. 순환을 피하려고 여기서 직접 읽음)
function storeOk() {
  try { return localStorage.getItem('proto.consent') !== 'no' && !/(?:^|;\s*)proto_consent=no/.test(document.cookie); } catch { return false; }
}
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved && Number.isFinite(saved.offset)) { info = { ...info, ...saved }; offset = saved.applied ? saved.offset : 0; }
} catch { /* 무시 */ }

const listeners = new Set();
export function onClockChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** 보정된 지금 시각 (ms). Date.now() 대신 쓴다. */
export function now() { return Date.now() + offset; }
/** 보정된 지금 시각 (Date) */
export function nowDate() { return new Date(now()); }
export function clockInfo() { return { ...info, appliedOffset: offset }; }

// 인터넷 상태: 왕복 지연(ms)으로 나눈다
export function qualityOf(rtt) {
  if (!Number.isFinite(rtt)) return 'offline';
  return rtt < 120 ? 'good' : rtt < 400 ? 'ok' : 'bad';
}

async function oneSample() {
  const t0 = Date.now();
  const r = await fetch('/api/time', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const t1 = Date.now();
  if (!r.ok) return null;
  const j = await r.json();
  if (!Number.isFinite(j.trueNow)) return null;
  const rtt = t1 - t0;
  return {
    // 응답이 오는 데 걸린 시간의 절반만큼 뒤의 시각이 지금
    offset: j.trueNow + rtt / 2 - t1,
    rtt,
    // 오차 범위 = 서버가 말한 정확도 + 지연의 절반
    precision: (j.precisionMs ?? 1000) + rtt / 2,
    source: j.source || 'net',
    // PC·Android는 서버/앱이 인터넷 시간 서버와 주고받은 지연을 알려 준다 (이 요청은 기기 안이라 거의 0ms)
    netRtt: Number.isFinite(j.rtt) ? j.rtt : null,
  };
}

let syncing = null;
export function syncClock(opts = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const first = await oneSample();
      if (!first) { markOffline(); return; }
      const all = [first];
      if (first.source === 'http-date') {
        // 웹 버전: 인터넷이 직접 끼어 있으니 몇 번 더 재서 가장 정확한 것을 쓴다
        for (let i = 1; i < SAMPLES; i++) {
          await new Promise((r) => setTimeout(r, 250));
          try { const s = await oneSample(); if (s) all.push(s); } catch { /* 이번 한 번은 건너뜀 */ }
        }
      }
      const best = all.reduce((a, b) => (b.precision < a.precision ? b : a));
      const rtts = all.map((s) => s.rtt);
      const jitter = rtts.length > 1 ? Math.max(...rtts) - Math.min(...rtts) : null;
      const netRtt = best.netRtt ?? best.rtt;
      const t = Date.now();

      // 옛 측정과 합치기
      let off = best.offset, prec = best.precision;
      const prev = !opts.fresh && info.source && info.source !== 'device' && Number.isFinite(info.precisionMs) && info.at ? info : null;
      if (prev) {
        const prevPrec = prev.precisionMs + Math.max(0, t - prev.at) / 1000 * DRIFT_MS_PER_S;
        if (Math.abs(best.offset - prev.offset) <= best.precision + prevPrec) {
          const w1 = 1 / (best.precision ** 2), w2 = 1 / (prevPrec ** 2);
          off = (best.offset * w1 + prev.offset * w2) / (w1 + w2);
          prec = Math.sqrt(1 / (w1 + w2));
        }
      }
      // 오차 범위(=인터넷이 느릴수록 커짐)보다 확실히 다를 때만 고친다. 작은 흔들림으로 시계가 튀지 않게.
      const threshold = Math.max(300, prec * 1.5);
      const applied = Math.abs(off) > threshold;
      const next = applied ? Math.round(off) : 0;
      info = { source: best.source, at: t, offset: Math.round(off), precisionMs: Math.round(prec), applied, rtt: Math.round(netRtt), jitter, quality: qualityOf(netRtt), samples: all.length };
      if (storeOk()) { try { localStorage.setItem(STORE, JSON.stringify(info)); } catch { /* 무시 */ } }
      if (next !== offset) { offset = next; for (const fn of listeners) fn(); }
    } catch { markOffline(); } finally { syncing = null; }
  })();
  return syncing;
}

// 인터넷이 안 될 때: 마지막 보정값은 그대로 쓰고, 상태만 '연결 안 됨'으로
function markOffline() {
  info = { ...info, quality: 'offline' };
}

// 기기 시계가 튀었는지 감시: performance.now()는 시계를 바꿔도 영향을 받지 않는다.
let lastWall = Date.now();
let lastMono = performance.now();
function watchJump() {
  const wall = Date.now();
  const mono = performance.now();
  const jump = (wall - lastWall) - (mono - lastMono);
  lastWall = wall; lastMono = mono;
  // (휴대폰이 잠들었다 깨어날 때도 여기에 걸리므로 보정값을 짐작하지 않고 다시 재기만 한다. 옛 측정은 믿지 않는다)
  if (Math.abs(jump) > JUMP_MS) syncClock({ fresh: true });
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
