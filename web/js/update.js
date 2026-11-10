// 자동 업데이트 알림
// 업데이트를 다 만든 뒤 version.json의 버전을 올리면, 왼쪽 아래에 '새 버전 x.y.z · 업데이트'가 뜬다.
// 누르면 서버가 종료 코드 42로 끝나고 Prototype.exe가 서버만 새로 켠다. 화면은 새 서버를 알아채고 다시 열린다.
import { h, swap, btn, toast } from './ui.js';
import { icon } from './icons.js';
import { t, isEn } from './i18n.js';

const slot = h('div.update-pill', { role: 'status', 'aria-live': 'polite', hidden: true });
const DONE_KEY = 'proto.updatedTo';
let info = null;
let busy = false;

async function check() {
  if (busy) return;
  try {
    const r = await fetch('/api/update', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    info = await r.json();
  } catch {
    return; // 서버가 다시 시작하는 중일 수 있음
  }
  render();
}

function render() {
  if (!info?.available) { slot.hidden = true; return; }
  slot.hidden = false;
  if (busy) {
    swap(slot, h('span.spinner'), t('GitHub에서 업데이트를 받는 중… 잠시 후 앱이 다시 열려요.'));
    return;
  }
  const notes = (info.notes || []).join(' · ');
  swap(
    slot,
    icon('download', 'icon-sm'),
    h('div', h('div', isEn() ? `Version ${info.next} is ready` : `새 버전 ${info.next}이(가) 있어요`), notes ? h('div.small.muted', { style: { fontWeight: 500 } }, notes) : null),
    btn(t('업데이트'), { small: true, kind: 'primary', onClick: apply, fkey: 'update-apply' }),
  );
}

async function apply() {
  if (!info?.canRestart) {
    // 예전 실행 파일이거나 개발용 서버: 직접 다시 열어야 한다.
    swap(slot, icon('info', 'icon-sm'), h('span', t('앱을 닫고 Prototype.exe를 다시 열면 업데이트돼요.')));
    return;
  }
  busy = true;
  render();
  const old = info.bootId;
  const target = info.next;
  // GitHub에서 새 파일을 받은 뒤 서버가 다시 시작한다.
  try {
    const r = await fetch('/api/update/apply', { method: 'POST', signal: AbortSignal.timeout(120000) });
    if (!r.ok) {
      busy = false;
      swap(slot, icon('alert', 'icon-sm'), h('span', t('GitHub에서 업데이트를 받지 못했어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.')), btn(t('다시 시도'), { small: true, onClick: apply }));
      return;
    }
  } catch { /* 서버가 이미 다시 시작하는 중 */ }
  // 새 서버가 뜰 때까지 기다렸다가 화면을 새로 연다.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 700));
    try {
      const j = await (await fetch('/api/update', { cache: 'no-store' })).json();
      if (j.bootId !== old) {
        try { sessionStorage.setItem(DONE_KEY, target); } catch { /* 무시 */ }
        location.reload();
        return;
      }
    } catch { /* 아직 다시 시작 중 */ }
  }
  busy = false;
  swap(slot, icon('alert', 'icon-sm'), h('span', t('업데이트가 끝나지 않았어요. 앱을 닫고 다시 열어 주세요.')));
}

export function startUpdateCheck() {
  document.body.append(slot);
  // 방금 업데이트로 다시 열린 경우: 끝났다고 알려 준다.
  try {
    const done = sessionStorage.getItem(DONE_KEY);
    if (done) {
      sessionStorage.removeItem(DONE_KEY);
      setTimeout(() => toast(isEn() ? `Updated to version ${done}.` : `${done} 버전으로 업데이트됐어요.`, 5000), 600);
    }
  } catch { /* 무시 */ }
  setTimeout(check, 3000);
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
