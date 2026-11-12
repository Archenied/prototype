// 웹 버전: "이 브라우저에 내 설정을 저장해도 될까요?"를 처음에 딱 한 번만 묻고, 대답을 기억한다 (다시 묻지 않음).
//  - 대답은 쿠키(proto_consent)와 브라우저 저장소에 함께 적어 둔다.
//  - 허용: 지역·교통 대상·일정·화면 설정이 이 브라우저에 저장돼서, 다음에 열어도 그대로 보인다.
//  - 허용 안 함: 쓰는 동안만 기억하고, 브라우저를 닫으면 사라진다.
//  - PC 앱·Android 앱은 이 기기 안에 저장하는 앱이라 묻지 않는다.
import { DIRECT, NATIVE } from './direct.js';
import { h, dialog } from './ui.js';

const KEY = 'proto.consent';
const isWeb = () => DIRECT && !NATIVE;
const cookiePath = () => location.pathname.replace(/[^/]*$/, '') || '/';

function readCookie() {
  try { const m = document.cookie.match(/(?:^|;\s*)proto_consent=(yes|no)/); return m ? m[1] : null; } catch { return null; }
}
function writeCookie(v) {
  try { document.cookie = `proto_consent=${v}; max-age=${365 * 86400}; path=${cookiePath()}; SameSite=Lax`; } catch { /* 무시 */ }
}

/** 'yes' · 'no' · null(아직 안 물어봄). 앱(PC·Android)은 항상 'yes'. */
export function consent() {
  if (!isWeb()) return 'yes';
  let v = readCookie();
  if (!v) { try { v = localStorage.getItem(KEY); } catch { /* 무시 */ } }
  return v === 'yes' || v === 'no' ? v : null;
}
export function setConsent(v) {
  writeCookie(v);
  try { localStorage.setItem(KEY, v); } catch { /* 무시 */ }
}
export const canStore = () => !isWeb() || consent() === 'yes';
export const needsConsent = () => isWeb() && consent() === null;

export function askConsent() {
  return new Promise((resolve) => {
    dialog({
      title: '설정을 이 브라우저에 저장할까요?',
      body: h('div.stack',
        h('p', '이 웹 버전은 내가 고른 지역·교통 대상·일정·화면 설정을 이 브라우저에만(쿠키·브라우저 저장소) 저장해요. 허용하면 다음에 열 때 다시 고르지 않아도 돼요.'),
        h('p.small.faint', '서버에는 아무것도 보내지 않아요. 한 번만 물어보고 다시 묻지 않아요. 나중에 설정에서 바꿀 수 있어요.')),
      dismissible: false,
      actions: [
        { label: '저장 안 함', value: 'no' },
        { label: '저장 허용', kind: 'primary', value: 'yes' },
      ],
      onClose: (v) => { setConsent(v === 'yes' ? 'yes' : 'no'); resolve(v); },
    });
  });
}
