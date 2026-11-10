// S-04 지역 관리 · S-05 지역 검색·추가 · S-16 지역 편집
import { h, swap, btn, iconBtn, toast, confirmDialog, promptDialog } from '../ui.js';
import { icon } from '../icons.js';
import { state, addRegion, editRegion, setHomeRegion, deleteRegion, regionLabel, SaveError } from '../store.js';
import { go, back, page } from '../app.js';
import { getJSON, net, errorText } from '../net.js';
import { requestLocation, deniedNotice, coarse } from '../location.js';
import { track } from '../metrics.js';

function saveFailNotice(retry) {
  return h('div.notice.error', { role: 'alert' }, icon('alert'), h('div.grow', h('div', '이 PC에 저장하지 못했어요. 기존 내용은 그대로예요.'), h('div.actions', btn('다시 저장', { small: true, iconName: 'refresh', onClick: retry }))));
}

function deleteMessage(region) {
  const isHome = state.homeRegionId === region.id;
  const others = state.regions.filter((r) => r.id !== region.id);
  return h(
    'div.stack',
    h('p', `‘${regionLabel(region)}’ 지역을 삭제할까요?`),
    isHome ? h('p.small', others.length ? `홈 표시 지역은 ‘${regionLabel(others[0])}’(으)로 바뀌어요.` : '남은 지역이 없어서 홈 날씨 영역이 빈 상태로 바뀌어요.') : null,
  );
}

/* ───────── S-04 ───────── */
export function regionsListView({ query }) {
  const fromHome = query.from === 'home';
  const listSlot = h('div.stack');
  const failSlot = h('div');
  let lastOp = null;

  function run(op) {
    lastOp = op;
    try {
      op();
      swap(failSlot);
      lastOp = null;
      return true;
    } catch (e) {
      if (e instanceof SaveError) swap(failSlot, saveFailNotice(() => lastOp && run(lastOp)));
      else throw e;
      return false;
    }
  }

  function renderList() {
    if (!state.regions.length) {
      swap(listSlot, h('div.card', h('div.empty', icon('sun', 'icon-lg'), h('p', '저장한 지역이 없어요. 날씨를 볼 지역을 추가해 주세요.'), btn('지역 추가', { kind: 'primary', iconName: 'plus', onClick: () => go('/settings/weather-regions/add'), fkey: 'rg-empty-add' }))));
      return;
    }
    swap(
      listSlot,
      h('p.small.muted', { style: { margin: '0 4px' } }, '홈에 보일 지역을 하나 고르세요.'),
      h(
        'div.group',
        { role: 'radiogroup', 'aria-label': '홈 표시 지역' },
        state.regions.map((r) => {
          const isHome = state.homeRegionId === r.id;
          return h(
            'div.item',
            h(
              'button.row.grow',
              { type: 'button', role: 'radio', 'aria-checked': isHome ? 'true' : 'false', style: { background: 'none', border: 0, padding: '6px 0', textAlign: 'left', cursor: 'pointer', minHeight: '44px' }, dataset: { fkey: `rg-${r.id}` }, onclick: () => run(() => setHomeRegion(r.id)) && renderList() },
              h(`span.radio-dot${isHome ? '.on' : ''}`),
              h(
                'div.grow',
                h('div.title', regionLabel(r), isHome ? h('span.tag.accent', { style: { marginLeft: '8px' } }, '홈 표시') : null),
                h('div.desc', r.kind === 'current' ? '이 PC의 위치를 기준으로 조회해요' : r.label ? r.name : '저장한 지역'),
              ),
            ),
            iconBtn('edit', `${regionLabel(r)} 이름 변경`, async () => {
              const v = await promptDialog({ title: '이름 변경', label: '표시 이름', value: regionLabel(r), hint: `원래 이름: ${r.name}`, allowEmpty: false });
              if (v !== undefined && run(() => editRegion(r.id, { label: v }))) { toast('이름을 바꿨어요.'); renderList(); }
            }, { fkey: `rg-edit-${r.id}` }),
            iconBtn('trash', `${regionLabel(r)} 삭제`, async () => {
              if (await confirmDialog({ title: '지역 삭제', body: deleteMessage(r), confirmLabel: '삭제', danger: true })) {
                if (run(() => deleteRegion(r.id))) { toast('삭제했어요.'); renderList(); }
              }
            }, { fkey: `rg-del-${r.id}` }),
            iconBtn('chevron', `${regionLabel(r)} 편집 화면`, () => go(`/settings/weather-regions/${r.id}/edit`), { fkey: `rg-open-${r.id}` }),
          );
        }),
      ),
    );
  }

  const el = page(
    '지역',
    { fallback: fromHome ? '/home' : '/settings', right: btn('지역 추가', { small: true, iconName: 'plus', kind: 'primary', onClick: () => go('/settings/weather-regions/add'), fkey: 'rg-add' }) },
    failSlot,
    listSlot,
    h('p.small.faint', '지역은 이 PC에만 저장돼요. 인터넷이 없어도 이름 변경·삭제·홈 표시 지역 선택은 할 수 있어요.'),
  );
  renderList();
  return { el };
}

/* ───────── S-05 ───────── */
export function regionAddView({ query }) {
  const from = query.from || '';
  const input = h('input.input', { type: 'search', placeholder: '예: 역삼동, 분당구 정자동', 'aria-label': '지역 이름 검색', maxlength: 40, dataset: { fkey: 'rg-q' } });
  const statusSlot = h('div', { 'aria-live': 'polite' });
  const resultSlot = h('div');
  const locSlot = h('div');
  let searching = false;
  let lastQuery = '';
  let seq = 0;

  function done(region, label) {
    track('favorite_saved', { kind: 'weather' });
    toast(`‘${label}’을(를) 저장했어요.`);
    if (from === 'onboarding') go('/onboarding', { replace: true, force: true });
    else back('/settings/weather-regions');
    void region;
  }

  function save(r) {
    try {
      const res = addRegion(r);
      if (res.duplicate) {
        swap(statusSlot, h('div.notice.warn', { role: 'alert' }, icon('info'), h('div.grow', `‘${r.name}’은(는) 이미 저장한 지역이에요. 새로 만들지 않았어요.`)));
        return;
      }
      done(res.region, r.kind === 'current' ? '현재 위치' : r.name);
    } catch (e) {
      if (e instanceof SaveError) swap(statusSlot, saveFailNotice(() => save(r)));
      else throw e;
    }
  }

  function renderOfflineState() {
    if (!net.online) {
      swap(resultSlot);
      swap(statusSlot, h('div.notice.offline', icon('wifiOff'), h('div.grow', '오프라인이라 지역을 찾을 수 없어요. 인터넷에 연결된 뒤 다시 시도해 주세요.')));
      return true;
    }
    return false;
  }

  async function search(q = input.value.trim()) {
    if (!q || searching) return;
    if (renderOfflineState()) return;
    lastQuery = q;
    searching = true;
    const my = ++seq;
    swap(statusSlot, h('div.row.muted', { 'aria-busy': 'true' }, h('span.spinner'), `‘${q}’ 검색 중…`));
    swap(resultSlot);
    try {
      const res = await getJSON(`/api/regions/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      const items = res.data || [];
      if (!items.length) {
        swap(statusSlot, h('div.notice', icon('search'), h('div.grow', h('div', `‘${q}’에 맞는 지역이 없어요.`), h('div.small.muted', '동 이름이나 구 이름처럼 다른 검색어로 찾아보세요.'))));
        return;
      }
      swap(statusSlot, h('p.small.muted', `검색 결과 ${items.length}개`));
      swap(
        resultSlot,
        h(
          'ul.group.result-list',
          items.map((r) => {
            const saved = state.regions.some((x) => x.kind !== 'current' && (x.name === r.name || (Math.abs(x.lat - r.lat) < 0.002 && Math.abs(x.lon - r.lon) < 0.002)));
            return h(
              'li',
              h(
                'button.item',
                { type: 'button', 'aria-disabled': r.supported ? null : 'true', onclick: () => (r.supported ? save({ kind: 'place', name: r.name, lat: r.lat, lon: r.lon }) : null) },
                icon('location'),
                h('div.grow', h('div.title', r.name), r.address && r.address !== r.name ? h('div.desc', r.address) : null),
                !r.supported ? h('span.tag.warn', '지원하지 않는 지역') : saved ? h('span.tag', '저장됨') : h('span.chev', icon('plus')),
              ),
            );
          }),
        ),
      );
    } catch (e) {
      if (my !== seq) return;
      if (e.kind === 'offline') return renderOfflineState();
      swap(
        statusSlot,
        h('div.notice.error', { role: 'alert' }, icon('alert'), h('div.grow', h('div', errorText(e.kind, e.detail)), h('div.actions', btn('다시 시도', { small: true, iconName: 'refresh', onClick: () => search(lastQuery), fkey: 'rg-retry' })))),
      );
    } finally {
      if (my === seq) searching = false;
    }
  }

  async function useCurrent() {
    swap(locSlot);
    if (state.regions.some((r) => r.kind === 'current')) {
      swap(statusSlot, h('div.notice.warn', icon('info'), h('div.grow', '‘현재 위치’는 이미 저장되어 있어요.')));
      return;
    }
    const r = await requestLocation('weather');
    if (r.status === 'ok') {
      let supported = true;
      if (net.online) {
        try {
          const rev = await getJSON(`/api/regions/reverse?lat=${coarse(r.lat, 3)}&lon=${coarse(r.lon, 3)}`);
          supported = rev.data.supported;
        } catch { /* 확인 못 해도 저장은 진행 */ }
      }
      if (!supported) {
        swap(locSlot, h('div.notice.warn', { role: 'alert' }, icon('location'), h('div.grow', h('div', '지금 위치는 지원하는 지역(서울·경기)이 아니에요.'), h('div.small', '아래에서 지역을 직접 검색해 주세요.'))));
        input.focus();
        return;
      }
      save({ kind: 'current', name: '현재 위치', lat: null, lon: null });
    } else if (r.status === 'denied') {
      swap(locSlot, deniedNotice({ onSearch: () => input.focus() }));
      input.focus();
    } else if (r.status === 'error') {
      swap(
        locSlot,
        h('div.notice.error', { role: 'alert' }, icon('location'), h('div.grow',
          h('div', r.reason === 'timeout' ? '위치를 확인하는 데 시간이 너무 걸려요.' : '위치를 가져오지 못했어요. Windows 위치 서비스가 꺼져 있을 수 있어요.'),
          h('div.actions', btn('위치 다시 시도', { small: true, iconName: 'refresh', onClick: useCurrent }), btn('직접 검색하기', { small: true, kind: 'primary', iconName: 'search', onClick: () => input.focus() })))),
      );
    } else {
      input.focus();
    }
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });

  const el = page(
    '지역 추가',
    { fallback: from === 'onboarding' ? '/onboarding' : '/settings/weather-regions' },
    h('div.group', h('button.item', { type: 'button', onclick: useCurrent, dataset: { fkey: 'rg-cur' } }, h('span.kind-badge', icon('crosshair', 'icon-sm')), h('div.grow', h('div.title', '현재 위치 사용'), h('div.desc', '누르면 위치를 쓰는 이유를 먼저 알려 드려요')), h('span.chev', icon('chevron')))),
    locSlot,
    h('div.field', h('label', { for: 'rg-q' }, '지역 이름으로 검색'), h('div.search-box', Object.assign(input, { id: 'rg-q' }), btn('검색', { kind: 'primary', iconName: 'search', onClick: () => search(), fkey: 'rg-go' })), h('div.hint', '서울특별시·경기도 지역을 지원해요.')),
    statusSlot,
    resultSlot,
  );
  const unsub = net.onChange(() => { if (!net.online) renderOfflineState(); else swap(statusSlot); });
  return {
    el,
    mounted() { if (!renderOfflineState()) input.focus(); },
    unmount() { unsub(); },
    keepFocus: true,
  };
}

/* ───────── S-16 ───────── */
export function regionEditView({ params }) {
  const region = state.regions.find((r) => r.id === params[0]);
  if (!region) {
    return { el: page('지역 편집', { fallback: '/settings/weather-regions' }, h('div.notice.warn', icon('info'), '이 지역은 이미 삭제됐어요.')) };
  }
  const original = { label: regionLabel(region), home: state.homeRegionId === region.id };
  const input = h('input.input', { id: 'rg-label', value: regionLabel(region), maxlength: 30, placeholder: region.name, dataset: { fkey: 'rg-label' } });
  const homeSwitch = h('input', { type: 'checkbox', role: 'switch', id: 'rg-home', checked: original.home, 'aria-label': '홈 표시 지역으로 지정' });
  const failSlot = h('div');
  const saveBtn = btn('저장', { kind: 'primary', onClick: () => save(), fkey: 'rg-save' });
  let leaving = false;

  const dirty = () => (input.value.trim() || region.name) !== original.label || homeSwitch.checked !== original.home;
  const sync = () => { saveBtn.disabled = !dirty(); };
  input.addEventListener('input', sync);
  homeSwitch.addEventListener('change', sync);

  function save() {
    try {
      editRegion(region.id, { label: input.value.trim(), makeHome: homeSwitch.checked && !original.home });
      // 홈 표시를 끄면 다른 저장 지역이 홈 표시를 이어받는다.
      const other = state.regions.find((r) => r.id !== region.id);
      if (original.home && !homeSwitch.checked && other) setHomeRegion(other.id);
      leaving = true;
      toast('저장했어요.');
      back('/settings/weather-regions');
    } catch (e) {
      if (e instanceof SaveError) swap(failSlot, saveFailNotice(save));
      else throw e;
    }
  }

  async function remove() {
    if (!(await confirmDialog({ title: '지역 삭제', body: deleteMessage(region), confirmLabel: '삭제', danger: true }))) return;
    try {
      deleteRegion(region.id);
      leaving = true;
      toast('삭제했어요.');
      back('/settings/weather-regions');
    } catch (e) {
      if (e instanceof SaveError) swap(failSlot, saveFailNotice(remove));
      else throw e;
    }
  }

  sync();
  const el = page(
    '지역 편집',
    { fallback: '/settings/weather-regions' },
    failSlot,
    h('div.card', h('div.small.faint', '원래 지역명'), h('div', { style: { fontWeight: 650, marginTop: '2px' } }, region.kind === 'current' ? '현재 위치 (이 PC의 위치)' : region.name)),
    h('div.field', h('label', { for: 'rg-label' }, '표시 이름'), input, h('div.hint', '홈과 목록에 보일 이름이에요. 비우면 원래 지역명을 써요.')),
    h('div.group', h('label.item', { for: 'rg-home', style: { cursor: 'pointer' } }, h('div.grow', h('div.title', '홈에 표시'), h('div.desc', '켜면 다른 지역의 홈 표시가 해제돼요.')), h('span.switch', homeSwitch))),
    h('div.footer-actions', btn('취소', { onClick: () => back('/settings/weather-regions') }), saveBtn),
    h('div.danger-zone', btn('이 지역 삭제', { kind: 'danger', iconName: 'trash', onClick: remove, fkey: 'rg-delete' })),
  );
  return {
    el,
    async beforeLeave() {
      if (leaving || !dirty()) return true;
      return confirmDialog({ title: '변경 내용 버리기', body: '저장하지 않은 변경 내용이 있어요. 버리고 나갈까요?', confirmLabel: '버리기', cancelLabel: '계속 편집', danger: true });
    },
  };
}
