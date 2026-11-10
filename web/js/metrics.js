// 익명 사용 지표 (R-25). 익명 기기 식별자로만 모으고, 좌표·주소·이름·피드백 본문은 넣지 않는다.
// 오프라인이면 기기에 보관했다가 연결되면 묶어서 보낸다. 실패해도 화면에는 아무 영향이 없다.
import { state, saveQuiet } from './store.js';
import { net } from './net.js';
import { uid } from './ui.js';

const KEY = 'proto.metrics.v1';
const MAX = 500;
let queue = [];
try { queue = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { queue = []; }

function keep() {
  try { localStorage.setItem(KEY, JSON.stringify(queue)); } catch { /* 무시 */ }
}

export function track(name, props = {}) {
  try {
    queue.push({ id: uid(), name, ts: Date.now(), props });
    if (queue.length > MAX) queue = queue.slice(-MAX); // 오래된 것부터 버림
    keep();
  } catch { /* 지표 기록 실패는 무시 */ }
}

let sending = false;
export async function flush() {
  if (sending || !queue.length || !net.online) return;
  sending = true;
  const batch = queue.slice(0, 200);
  try {
    const r = await fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: state.deviceId, events: batch }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const sent = new Set(batch.map((e) => e.id));
      queue = queue.filter((e) => !sent.has(e.id));
      keep();
    }
  } catch { /* 다음에 다시 보냄 */ }
  sending = false;
}

export function startMetrics() {
  if (!state.firstLaunchLogged) {
    track('first_launch');
    state.firstLaunchLogged = true;
    saveQuiet();
  }
  // 지표 전송은 화면 조회보다 늦게 시작한다 (M-01 표시를 늦추지 않음).
  setTimeout(flush, 6000);
  setInterval(flush, 60000);
  net.onChange((on) => { if (on) setTimeout(flush, 4000); });
}
