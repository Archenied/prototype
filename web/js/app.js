// 화면 이동(라우터)과 앱 전체에서 쓰는 정보.
// 화면 주소는 docs/UI.md의 라우트를 그대로 쓴다 (#/home, #/settings/...).
import { h, iconBtn } from './ui.js';

// 서버가 version.json에서 읽은 버전으로 바뀐다 (loadConfig)
export let APP_VERSION = '1.0.0';
export function setAppVersion(v) { if (v) APP_VERSION = v; }
export const config = { modes: {}, sources: {}, loaded: false };

const routes = [];
let current = null; // { path, view }
let depth = 0; // 앱 안에서 쌓인 이동 수 (뒤로 가기 판단용)
let bypassGuard = false;

export function route(pattern, factory) {
  routes.push({ pattern, factory });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export async function go(path, { replace = false, force = false } = {}) {
  if (!force && current?.view?.beforeLeave) {
    const okToLeave = await current.view.beforeLeave();
    if (!okToLeave) return false;
  }
  bypassGuard = true;
  if (replace || location.hash === '#' + path) {
    history.replaceState(null, '', '#' + path);
    render();
  } else {
    depth++;
    location.hash = path;
  }
  return true;
}

// 앱 안의 '뒤로' 버튼. 앱 안에서 들어온 경우에만 브라우저 기록을 되돌린다.
export async function back(fallback = '/home') {
  if (current?.view?.beforeLeave) {
    const okToLeave = await current.view.beforeLeave();
    if (!okToLeave) return;
  }
  bypassGuard = true;
  if (depth > 0) {
    depth--;
    history.back();
  } else {
    history.replaceState(null, '', '#' + fallback);
    render();
  }
}

// 저장을 마친 뒤 여러 단계 앞 화면으로 돌아갈 때 (예: 종류 선택 → 찾기 → 저장 → 목록)
export function backSteps(n, fallback) {
  bypassGuard = true;
  if (depth >= n) {
    depth -= n;
    history.go(-n);
  } else {
    depth = 0;
    history.replaceState(null, '', '#' + fallback);
    render();
  }
}

// 저장하지 않은 입력이 있는 화면에서 Alt+← 같은 기록 이동이 일어나면 확인을 먼저 받는다.
window.addEventListener('hashchange', async (e) => {
  if (!bypassGuard && current?.view?.beforeLeave) {
    const okToLeave = await current.view.beforeLeave();
    if (!okToLeave) {
      history.pushState(null, '', '#' + current.path + (current.qs ? '?' + current.qs : ''));
      return;
    }
  }
  bypassGuard = false;
  void e;
  render();
});

export function render() {
  bypassGuard = false;
  const { path, query } = parseHash();
  let match = null;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) { match = { r, params: m.slice(1) }; break; }
  }
  if (!match) {
    history.replaceState(null, '', '#/home');
    return render();
  }
  try { current?.view?.unmount?.(); } catch (e) { console.error(e); }
  const app = document.getElementById('app');
  const view = match.r.factory({ params: match.params, query });
  current = { path, qs: location.hash.split('?')[1] || '', view };
  app.replaceChildren(view.el);
  view.mounted?.();
  // 화면이 바뀌면 제목으로 초점을 옮겨 스크린리더·키보드 사용자가 위치를 알 수 있게 한다.
  const heading = view.el.querySelector('[data-page-title]');
  if (heading && !view.keepFocus) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}

export function currentView() {
  return current?.view;
}

// 설정 하위 화면의 공통 머리 (뒤로 + 제목 + 오른쪽 동작)
export function pageHead(title, { onBack, fallback = '/settings', right } = {}) {
  return h(
    'div.page-head',
    iconBtn('back', '뒤로', onBack || (() => back(fallback)), { fkey: 'back' }),
    h('h1', { 'data-page-title': '' }, title),
    right || null,
  );
}

export function page(title, opts, ...content) {
  return h('div.page', h('div.page-inner', pageHead(title, opts), ...content));
}
