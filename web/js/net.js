// 로컬 서버 호출과 네트워크 상태.
// 오류는 화면이 구분하는 원인 유형(kind)으로 바뀐다: offline · timeout · service · quota · notfound

export class RequestError extends Error {
  constructor(kind, detail) {
    super(kind);
    this.kind = kind;
    this.detail = detail;
  }
}

const listeners = new Set();
export const net = {
  // online: OS 네트워크 연결 + 서버가 외부에 닿는지
  online: navigator.onLine,
  serverReachable: true,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
function setOnline(v) {
  if (net.online === v) return;
  net.online = v;
  for (const fn of [...listeners]) fn(v);
}

let probeTimer = null;
async function probe() {
  try {
    const r = await fetch('/api/net', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    net.serverReachable = true;
    setOnline(navigator.onLine && !!j.online);
  } catch {
    net.serverReachable = false;
  }
  scheduleProbe();
}
function scheduleProbe() {
  clearTimeout(probeTimer);
  // 오프라인일 때만 자주 확인해서 복구를 빨리 알아챈다.
  probeTimer = setTimeout(probe, net.online ? 60000 : 5000);
}
export function startNetWatch() {
  window.addEventListener('online', () => probe());
  window.addEventListener('offline', () => { setOnline(false); scheduleProbe(); });
  probe();
}
// 서버가 '네트워크 없음'을 알려 주면 바로 오프라인으로 바꾸고 복구를 기다린다.
export function reportOffline() {
  setOnline(false);
  scheduleProbe();
}
export function recheckNet() {
  return probe();
}

export async function getJSON(path, { timeout = 10000 } = {}) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new RequestError('timeout');
    throw new RequestError(navigator.onLine ? 'service' : 'offline');
  }
  let body = null;
  try { body = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const kind = body?.error || 'service';
    if (kind === 'offline') reportOffline();
    throw new RequestError(['offline', 'timeout', 'service', 'quota', 'notfound'].includes(kind) ? kind : 'service', body?.detail);
  }
  return body;
}

export async function postJSON(path, data, { timeout = 10000 } = {}) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new RequestError('timeout');
    throw new RequestError(navigator.onLine ? 'service' : 'offline');
  }
  let body = null;
  try { body = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) throw new RequestError(body?.error || 'service', body?.detail);
  return body;
}

// 원인별 안내 문구 (기술 용어 없이 한 문장)
export function errorText(kind, detail) {
  if (detail === 'https') return '서울 버스 정보는 Windows 버전과 Android 앱에서만 볼 수 있어요. (서울시 버스 API가 휴대폰 브라우저의 보안 연결을 지원하지 않아요)';
  if (detail === 'mobile') return '이 기능은 모바일 웹 버전에서는 아직 쓸 수 없어요. Windows 버전에서 써 주세요.';
  if (detail === 'key') return '이 정보는 아직 쓸 수 없어요. data.go.kr에서 이 서비스 활용신청이 승인됐는지, API_KEYS.bat의 키가 맞는지 확인해 주세요.';
  switch (kind) {
    case 'offline': return '인터넷에 연결되어 있지 않아요.';
    case 'timeout': return '응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.';
    case 'quota': return '요청이 많아 잠시 쉬고 있어요. 조금 뒤 자동으로 다시 불러와요.';
    case 'notfound': return '더 이상 조회되지 않는 대상이에요.';
    default: return '정보를 주는 곳에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  }
}
