// 시험 도구 (Ctrl+Shift+D): 수용기준 확인용으로 지연·시간 초과·서비스 오류·한도 초과·조회 불가·오프라인을 흉내 낸다.
// 사용자 화면이 아니라 개발·검증용이다.
import { h, swap, btn } from '../ui.js';
import { getJSON, postJSON, recheckNet } from '../net.js';
import { testFlags, clearEverything } from '../store.js';
import { debugEntries, refreshActive } from '../data.js';

const LABEL = { network: '네트워크 전체', weather: '날씨', bus: '버스', subway: '지하철 도착', subwayStatus: '지하철 운행 현황', route: '경로', signal: '신호등', search: '검색', feedback: '피드백 제출', metrics: '지표 전송' };
const MODE = { none: '정상', delay: '5초 지연', timeout: '시간 초과', service: '서비스 오류', quota: '호출 한도 초과', notfound: '조회 불가', empty: '빈 응답(없음)', offline: '네트워크 없음' };

let panel = null;

export async function toggleDebug() {
  if (panel) { panel.remove(); panel = null; return; }
  panel = h('aside.debug', { role: 'complementary', 'aria-label': '시험 도구' });
  document.body.append(panel);
  await render();
}

async function render() {
  if (!panel) return;
  let f;
  let stats;
  try {
    f = await getJSON('/api/debug/faults');
    stats = await getJSON('/api/debug/stats');
  } catch {
    swap(panel, h('p', '서버에 연결할 수 없어요.'));
    return;
  }
  const rows = f.types.map((t) =>
    [h('label', { for: `dbg-${t}` }, LABEL[t] || t),
      h('select.select', { id: `dbg-${t}`, onchange: async (e) => { await postJSON('/api/debug/faults', { [t]: e.target.value, clearCache: true }); if (t === 'network') await recheckNet(); render(); } },
        f.modes.map((m) => h('option', { value: m, selected: f.faults[t] === m }, MODE[m] || m)))],
  );
  swap(
    panel,
    h('h2', '시험 도구 (Ctrl+Shift+D)'),
    h('p.small.muted', { style: { marginBottom: '8px' } }, '외부 API 응답을 일부러 바꿔서 화면의 로딩·오류·오프라인 상태를 확인해요.'),
    h('div.grid', rows.flat()),
    h('label.row', { style: { marginTop: '10px' } }, h('input', { type: 'checkbox', checked: testFlags.failSave, onchange: (e) => { testFlags.failSave = e.target.checked; } }), '기기 저장 실패 흉내'),
    h('p.small', { style: { marginTop: '10px' } }, '실제 외부 호출 수: ', Object.entries(stats.upstreamCalls).map(([k, v]) => `${k} ${v}`).join(' · ')),
    h('details', { style: { marginTop: '6px' } }, h('summary', '조회 항목 상태'), h('pre.small', { style: { whiteSpace: 'pre-wrap' } }, debugEntries().map((e) => `${e.key} ${e.loading ? '조회 중' : ''} ${e.error || ''} 실패${e.failCount}`).join('\n'))),
    h('div.row', { style: { marginTop: '10px', flexWrap: 'wrap' } },
      btn('모두 정상', { small: true, onClick: async () => { await postJSON('/api/debug/faults', { ...Object.fromEntries(f.types.map((t) => [t, 'none'])), clearCache: true }); await recheckNet(); render(); } }),
      btn('호출 수 초기화', { small: true, onClick: async () => { await postJSON('/api/debug/stats', {}); render(); } }),
      btn('새로 조회', { small: true, onClick: () => refreshActive({ force: true }).then(render) }),
      btn('앱 데이터 모두 지우기', { small: true, kind: 'danger', onClick: () => { if (confirm('이 PC에 저장한 설정·캐시를 모두 지울까요? (새로 설치한 상태)')) { clearEverything(); location.hash = '#/onboarding'; location.reload(); } } }),
      btn('닫기', { small: true, onClick: toggleDebug }),
    ),
  );
}
