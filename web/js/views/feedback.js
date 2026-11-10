// S-11 피드백 보내기 (R-24)
// 오류 유형만 앱·OS 버전을 붙인다. 위치·저장 경로 주소는 절대 보내지 않는다.
import { h, swap, btn, toast, confirmDialog, uid } from '../ui.js';
import { icon } from '../icons.js';
import { back, page, APP_VERSION } from '../app.js';
import { postJSON, net, errorText } from '../net.js';
import { track } from '../metrics.js';

async function osVersion() {
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const v = await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion']);
      if (v.platform === 'Windows') return Number(v.platformVersion.split('.')[0]) >= 13 ? 'Windows 11' : 'Windows 10';
      return `${v.platform} ${v.platformVersion}`.trim();
    }
  } catch { /* 아래 방법으로 */ }
  const m = navigator.userAgent.match(/Windows NT [\d.]+|Mac OS X [\d_]+|Android [\d.]+|iPhone OS [\d_]+/);
  return m ? m[0].replace(/_/g, '.') : navigator.platform || '알 수 없음';
}

const TYPES = [['error', '오류'], ['request', '요청'], ['other', '기타']];

export function feedbackView() {
  let type = '';
  let sending = false;
  let sent = false;
  let os = '';
  // 같은 내용을 다시 보내도 서버에 한 번만 저장되도록 제출 묶음마다 고유 번호를 쓴다.
  let submissionId = uid();
  let lastSentKey = '';
  osVersion().then((v) => { os = v; renderAttach(); });

  const ta = h('textarea.textarea', { id: 'fb-text', maxlength: 2000, placeholder: '어떤 점이 불편했는지, 무엇이 있었으면 좋겠는지 자유롭게 적어 주세요.', dataset: { fkey: 'fb-text' } });
  const typeSlot = h('div');
  const attachSlot = h('div');
  const statusSlot = h('div', { 'aria-live': 'polite' });
  const submit = btn('보내기', { kind: 'primary', iconName: 'message', onClick: () => send(), fkey: 'fb-send' });

  const valid = () => type && ta.value.trim();
  const sync = () => { submit.disabled = !valid() || sending; };

  function renderType() {
    swap(typeSlot, h('div.seg', { role: 'radiogroup', 'aria-label': '피드백 유형' }, TYPES.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': type === v ? 'true' : 'false', dataset: { fkey: `fbt-${v}` }, onclick: () => { type = v; renderType(); renderAttach(); sync(); } }, l))));
  }
  function renderAttach() {
    swap(attachSlot, type === 'error'
      ? h('div.notice', icon('info'), h('div.grow', h('div', '오류 신고에는 아래 정보가 함께 전송돼요. 위치 정보는 보내지 않아요.'), h('div.small.muted', `앱 버전 ${APP_VERSION} · ${os || '운영체제 확인 중'}`)))
      : null);
  }

  async function send() {
    if (!valid() || sending) return;
    const content = ta.value.trim();
    const key = type + '\n' + content;
    if (key !== lastSentKey) { submissionId = uid(); lastSentKey = key; }
    if (!net.online) {
      swap(statusSlot, h('div.notice.offline', { role: 'alert' }, icon('wifiOff'), h('div.grow', h('div', '오프라인이라 보내지 못했어요. 입력한 내용은 그대로 있어요.'), h('div.actions', btn('다시 시도', { small: true, iconName: 'refresh', onClick: send, fkey: 'fb-retry' })))));
      return;
    }
    sending = true;
    submit.classList.add('is-busy');
    sync();
    swap(statusSlot);
    try {
      await postJSON('/api/feedback', { id: submissionId, type, content, ...(type === 'error' ? { appVersion: APP_VERSION, osVersion: os } : {}) }, { timeout: 15000 });
      sent = true;
      track('feedback_submitted', { feedbackType: type });
      ta.value = '';
      toast('피드백을 보냈어요. 고마워요!');
      back('/settings');
    } catch (e) {
      swap(statusSlot, h('div.notice.error', { role: 'alert' }, icon(e.kind === 'offline' ? 'wifiOff' : 'alert'), h('div.grow', h('div', errorText(e.kind)), h('div.small.muted', '입력한 내용은 그대로 있어요.'), h('div.actions', btn('다시 시도', { small: true, iconName: 'refresh', onClick: send, fkey: 'fb-retry' })))));
    } finally {
      sending = false;
      submit.classList.remove('is-busy');
      sync();
    }
  }

  ta.addEventListener('input', sync);
  renderType();
  sync();
  const el = page(
    '피드백 보내기',
    {},
    h('div.field', h('div.label', '유형'), typeSlot),
    attachSlot,
    h('div.field', h('label', { for: 'fb-text' }, '내용'), ta),
    statusSlot,
    h('div.footer-actions', submit),
  );
  return {
    el,
    async beforeLeave() {
      if (sent || sending || !ta.value.trim()) return true;
      return confirmDialog({ title: '작성 중인 내용 버리기', body: '입력한 피드백을 보내지 않고 나갈까요?', confirmLabel: '버리기', cancelLabel: '계속 작성', danger: true });
    },
  };
}
