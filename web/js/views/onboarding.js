// S-01 첫 실행 안내 — 권한은 묻지 않는다. 건너뛰어도 홈을 쓸 수 있다.
import { h, btn } from '../ui.js';
import { icon } from '../icons.js';
import { state, update, homeRegion, regionLabel } from '../store.js';
import { go } from '../app.js';
import { track } from '../metrics.js';

export function onboardingView() {
  const region = homeRegion();
  const weatherDone = state.regions.length > 0;
  const transitDone = state.targets.length > 0;
  const anyDone = weatherDone || transitDone;

  function finish(skipped) {
    try {
      update((s) => { s.onboardingDone = true; });
    } catch {
      state.onboardingDone = true; // 저장 실패해도 이번 실행에서는 홈으로 간다
    }
    track('onboarding_done', { skipped });
    go('/home', { replace: true, force: true });
  }

  const item = (done, title, desc, doneText, onClick, fkey) =>
    h(
      'button.item',
      { type: 'button', onclick: onClick, dataset: { fkey } },
      h(`span.check${done ? '.done' : ''}`, icon('check', 'icon-sm')),
      h('div.grow', h('div.title', title), h('div.desc', done ? doneText : desc)),
      h('span.chev', icon('chevron')),
    );

  const el = h(
    'div.onb',
    h(
      'main.onb-card',
      h(
        'div.onb-hero',
        h('img', { src: 'icon.svg', alt: '' }),
        h('h1', { 'data-page-title': '' }, '시각·날씨·교통을 한 화면에서'),
        h('p.muted', '출발 전에 여러 앱을 오갈 필요 없이, 지금 시각과 날씨, 자주 타는 버스·지하철·경로·신호등을 한눈에 확인해요. 먼저 두 가지만 저장해 두면 홈이 채워져요.'),
      ),
      h(
        'div.group',
        item(weatherDone, '지역 저장', '날씨를 볼 지역을 고르세요.', `저장됨 · ${regionLabel(region) || '지역'}`, () => go('/settings/weather-regions/add?from=onboarding'), 'onb-wx'),
        item(transitDone, '교통 대상 저장', '정류장·역·경로·신호등을 고르세요.', `저장됨 · ${state.targets.length}개`, () => go('/settings/transit-targets/new?from=onboarding'), 'onb-tr'),
      ),
      h('p.small.faint', '위치나 알림 권한은 지금 묻지 않아요. 그 기능을 쓸 때만 물어봐요.'),
      h(
        'div.footer-actions',
        btn('건너뛰기', { kind: 'ghost', onClick: () => finish(true), fkey: 'onb-skip' }),
        btn('시작하기', { kind: anyDone ? 'primary' : '', onClick: () => finish(!anyDone), fkey: 'onb-start' }),
      ),
    ),
  );
  return { el };
}
