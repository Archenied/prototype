// 앱 시작: 화면 주소 등록, 네트워크 감시, 자동 갱신, 알림, 지표 시작.
import { route, render, go, config, parseHash, setAppVersion } from './app.js';
import { state, wasNewInstall } from './store.js';
import { startNetWatch } from './net.js';
import { startScheduler, refreshActive } from './data.js';
import { startMetrics, track } from './metrics.js';
import { startAlarms, setOpenHomeHandler } from './alarms.js';
import { homeView } from './views/home.js';
import { onboardingView } from './views/onboarding.js';
import { settingsView, sourcesView } from './views/settings.js';
import { regionsListView, regionAddView, regionEditView } from './views/regions.js';
import { targetsListView, typeSelectView, findTargetView, routeAddView, targetEditView } from './views/transit.js';
import { alarmsListView, alarmEditView } from './views/alarms.js';
import { feedbackView } from './views/feedback.js';
import { toggleDebug } from './views/debug.js';
import { applyTheme } from './i18n.js';
import { startUpdateCheck } from './update.js';
import { installDirect } from './direct.js';

applyTheme(); // 화면 모드·언어를 가장 먼저 적용 (깜빡임 방지)
installDirect(); // 모바일 웹(GitHub Pages)이면 '/api' 요청을 브라우저 안에서 처리

route(/^\/onboarding$/, onboardingView);
route(/^\/home$/, homeView);
route(/^\/settings$/, settingsView);
route(/^\/settings\/weather-regions$/, regionsListView);
route(/^\/settings\/weather-regions\/add$/, regionAddView);
route(/^\/settings\/weather-regions\/([^/]+)\/edit$/, regionEditView);
route(/^\/settings\/transit-targets$/, targetsListView);
route(/^\/settings\/transit-targets\/new$/, typeSelectView);
route(/^\/settings\/(?:transit\/add|transit-targets\/add)$/, findTargetView);
route(/^\/settings\/(?:transit\/add-route|transit-targets\/route)$/, routeAddView);
route(/^\/settings\/transit\/([^/]+)\/edit$/, targetEditView);
route(/^\/settings\/alarms$/, alarmsListView);
route(/^\/settings\/alarms\/edit$/, alarmEditView);
route(/^\/settings\/feedback$/, feedbackView);
route(/^\/settings\/sources$/, sourcesView);

// 어떤 공급자가 실제 데이터인지(키가 있는지) 서버에 물어본다. 실패해도 앱은 그대로 동작한다.
async function loadConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    Object.assign(config, await r.json(), { loaded: true });
    setAppVersion(config.version);
  } catch { /* 오프라인 등 */ }
}

function boot() {
  track('app_launch', { firstLaunch: wasNewInstall() });
  startNetWatch();
  startScheduler();
  startAlarms();
  setOpenHomeHandler(() => {
    if (parseHash().path !== '/home') go('/home', { force: false });
    else refreshActive();
  });

  const { path } = parseHash();
  if (!state.onboardingDone && path !== '/onboarding' && !path.startsWith('/settings')) history.replaceState(null, '', '#/onboarding');
  else if (path === '/' || path === '') history.replaceState(null, '', '#/home');
  render();
  loadConfig().then(() => { if (parseHash().path === '/home' || parseHash().path === '/settings') render(); });
  startMetrics();
  startUpdateCheck();

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleDebug(); }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); go('/settings'); }
    // 홈이 아닌 화면에서 F5는 앱 전체 새로고침 대신 무시 (입력 중인 내용 보호)
    if (e.key === 'F5' && parseHash().path !== '/home') e.preventDefault();
  });
}

boot();
