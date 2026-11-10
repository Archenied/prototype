// S-06 교통 확인 대상 관리 · S-18 종류 선택 · S-19 정류장·역·신호등 찾기 · S-20 경로 추가 · S-21 교통 대상 편집
import { h, swap, btn, iconBtn, toast, confirmDialog } from '../ui.js';
import { icon, KIND_ICON } from '../icons.js';
import { state, addTarget, editTarget, moveTarget, deleteTarget, targetLabel, SaveError, onChange } from '../store.js';
import { go, back, backSteps, page } from '../app.js';
import { getJSON, net, errorText } from '../net.js';
import { requestLocation, deniedNotice, coarse } from '../location.js';
import { track } from '../metrics.js';
import { t } from '../i18n.js';

const KIND_NAME = { bus: '버스 정류장', subway: '지하철역', signal: '신호등', route: '경로' };

function saveFailNotice(retry) {
  return h('div.notice.error', { role: 'alert' }, icon('alert'), h('div.grow', h('div', '이 PC에 저장하지 못했어요. 기존 목록과 순서는 그대로예요.'), h('div.actions', btn('다시 저장', { small: true, iconName: 'refresh', onClick: retry }))));
}
function offlineAddNotice() {
  return h('div.notice.offline', { role: 'status' }, icon('wifiOff'), h('div.grow', h('div', '오프라인이라 새 대상을 찾을 수 없어요. 연결되면 다시 시도해 주세요.'), h('div.small.muted', '저장한 대상의 이름·순서 변경과 삭제는 목록에서 할 수 있어요.')));
}
function targetSub(t) {
  return t.type === 'route' ? `${t.ref.origin.name} → ${t.ref.dest.name}` : t.sub || '';
}

// 저장을 마친 뒤 돌아갈 곳
function afterSave(from) {
  if (from === 'onboarding') go('/onboarding', { replace: true, force: true });
  else if (from === 'home') go('/home', { replace: true, force: true });
  else backSteps(2, '/settings/transit-targets');
}

async function confirmDelete(t) {
  return confirmDialog({ title: '교통 대상 삭제', body: h('div.stack', h('p', `‘${targetLabel(t)}’을(를) 삭제할까요?`), h('p.small', '마지막으로 받은 정보도 함께 지워져요.')), confirmLabel: '삭제', danger: true });
}

/* ───────── S-06 ───────── */
export function targetsListView({ query }) {
  const listSlot = h('div');
  const failSlot = h('div');
  const statusSlot = h('div', { 'aria-live': 'polite' });
  let lastOp = null;
  let dragId = null;

  function run(op, okMsg) {
    lastOp = op;
    try {
      op();
      swap(failSlot);
      lastOp = null;
      if (okMsg) swap(statusSlot, h('p.sr-only', okMsg));
      return true;
    } catch (e) {
      if (e instanceof SaveError) { swap(failSlot, saveFailNotice(() => lastOp && run(lastOp) && renderList())); return false; }
      throw e;
    }
  }

  function row(t, i, n) {
    const unavailable = !!state.unavailable[t.id];
    const el = h(
      'div.item',
      { draggable: 'true', dataset: { id: t.id }, id: `target-${t.id}` },
      h('span.drag-handle', { title: '끌어서 순서 변경', 'aria-hidden': 'true' }, icon('grip')),
      h(`span.kind-badge.${t.type}`, icon(KIND_ICON[t.type], 'icon-sm')),
      h(
        'div.grow',
        h('div.title.ellipsis', targetLabel(t)),
        h('div.desc.ellipsis', KIND_NAME[t.type], targetSub(t) ? ' · ' : '', targetSub(t)),
        unavailable ? h('div.row', { style: { marginTop: '4px', gap: '6px', flexWrap: 'wrap' } },
          h('span.tag.err', '조회 불가'),
          t.type === 'route'
            ? btn('출발지·목적지 수정', { small: true, onClick: () => go(`/settings/transit/${t.id}/edit`), fkey: `fix-${t.id}` })
            : btn('삭제', { small: true, kind: 'danger', iconName: 'trash', onClick: () => remove(t), fkey: `fixdel-${t.id}` })) : null,
      ),
      iconBtn('up', `${targetLabel(t)} 위로`, () => run(() => moveTarget(t.id, i - 1), '위로 옮겼어요') && renderList(`up-${t.id}`), { disabled: i === 0, fkey: `up-${t.id}` }),
      iconBtn('down', `${targetLabel(t)} 아래로`, () => run(() => moveTarget(t.id, i + 1), '아래로 옮겼어요') && renderList(`down-${t.id}`), { disabled: i === n - 1, fkey: `down-${t.id}` }),
      iconBtn('edit', `${targetLabel(t)} 수정`, () => go(`/settings/transit/${t.id}/edit`), { fkey: `edit-${t.id}` }),
      iconBtn('trash', `${targetLabel(t)} 삭제`, () => remove(t), { fkey: `del-${t.id}` }),
    );
    // 끌어서 순서 변경 (놓는 즉시 저장)
    el.addEventListener('dragstart', (e) => { dragId = t.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); });
    el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); clearDrop(); });
    el.addEventListener('dragover', (e) => {
      if (!dragId || dragId === t.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearDrop();
      el.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === t.id) return;
      const after = el.classList.contains('drop-after');
      const ids = state.targets.map((x) => x.id);
      const from = ids.indexOf(dragId);
      let to = ids.indexOf(t.id) + (after ? 1 : 0);
      if (from < to) to--;
      const id = dragId;
      clearDrop();
      if (run(() => moveTarget(id, to), '순서를 바꿨어요')) renderList();
    });
    return el;
  }

  function clearDrop() {
    for (const x of listSlot.querySelectorAll('.drop-before, .drop-after')) x.classList.remove('drop-before', 'drop-after');
  }

  async function remove(t) {
    if (!(await confirmDelete(t))) return;
    if (run(() => deleteTarget(t.id))) { toast('삭제했어요.'); renderList(); }
  }

  function renderList(focusKey) {
    if (!state.targets.length) {
      swap(listSlot, h('div.card', h('div.empty', icon('bus', 'icon-lg'), h('p', '저장한 교통 대상이 없어요. 자주 타는 정류장·역, 출퇴근 경로, 지나는 신호등을 추가해 보세요.'), btn('대상 추가', { kind: 'primary', iconName: 'plus', onClick: () => go('/settings/transit-targets/new'), fkey: 'tr-empty-add' }))));
      return;
    }
    const n = state.targets.length;
    swap(listSlot, h('div.group', state.targets.map((t, i) => row(t, i, n))));
    if (focusKey) listSlot.querySelector(`[data-fkey="${focusKey}"]:not([disabled])`)?.focus();
  }

  const el = page(
    '교통 확인 대상',
    { fallback: query.from === 'home' ? '/home' : '/settings', right: btn('대상 추가', { small: true, kind: 'primary', iconName: 'plus', onClick: () => go('/settings/transit-targets/new'), fkey: 'tr-add' }) },
    failSlot,
    statusSlot,
    h('p.small.muted', { style: { margin: '0 4px' } }, '홈 교통 영역에 이 순서대로 보여요. 손잡이를 끌거나 위·아래 버튼으로 순서를 바꿀 수 있어요.'),
    listSlot,
    h('p.small.faint', '모두 이 PC에만 저장돼요. 인터넷이 없어도 이름·순서 변경과 삭제는 할 수 있어요.'),
  );
  renderList();
  const unsub = onChange((what) => { if (what === 'unavailable') renderList(); });
  return {
    el,
    mounted() {
      if (query.focus) {
        const target = el.querySelector(`#target-${CSS.escape(query.focus)}`);
        if (target) {
          target.scrollIntoView({ block: 'center' });
          target.classList.add('highlight');
          target.querySelector('button')?.focus({ preventScroll: true });
        }
      }
    },
    unmount: unsub,
    keepFocus: !!query.focus,
  };
}

/* ───────── S-18 ───────── */
export function typeSelectView({ query }) {
  const from = query.from || '';
  const suffix = from ? `from=${from}` : '';
  const offlineSlot = h('div');
  const groupSlot = h('div');
  const types = [
    { type: 'bus', title: '버스 정류장', desc: '정류장의 노선별 버스 도착 정보를 봐요.' },
    { type: 'subway', title: '지하철역', desc: '호선·방향별 다음 열차와 운행 지연을 봐요.' },
    { type: 'signal', title: '신호등', desc: '교차로 이름과 보행 신호 상태를 봐요.' },
    { type: 'route', title: '경로', desc: '출발지→목적지 대중교통 예상 소요 시간만 보여 줘요. 길 안내는 하지 않아요.' },
  ];
  function render() {
    const off = !net.online;
    swap(offlineSlot, off ? offlineAddNotice() : null);
    swap(
      groupSlot,
      h(
        'div.group',
        types.map((t) =>
          h(
            'button.item',
            {
              type: 'button', 'aria-disabled': off ? 'true' : null, dataset: { fkey: `type-${t.type}` },
              onclick: () => {
                if (!net.online) return;
                go(t.type === 'route' ? `/settings/transit/add-route${suffix ? '?' + suffix : ''}` : `/settings/transit/add?type=${t.type}${suffix ? '&' + suffix : ''}`);
              },
            },
            h(`span.kind-badge.${t.type}`, icon(KIND_ICON[t.type], 'icon-sm')),
            h('div.grow', h('div.title', t.title), h('div.desc', t.desc)),
            h('span.chev', icon('chevron')),
          ),
        ),
      ),
    );
  }
  render();
  const unsub = net.onChange(render);
  const el = page('어떤 대상을 추가할까요?', { fallback: from === 'onboarding' ? '/onboarding' : from === 'home' ? '/home' : '/settings/transit-targets' }, offlineSlot, groupSlot);
  return { el, unmount: unsub };
}

/* ───────── S-19 ───────── */
export function findTargetView({ query }) {
  const from = query.from || '';
  let type = ['bus', 'subway', 'signal'].includes(query.type) ? query.type : 'bus';
  const input = h('input.input', { type: 'search', id: 'tr-q', maxlength: 40, dataset: { fkey: 'tr-q' } });
  const segSlot = h('div');
  const offlineSlot = h('div');
  const locSlot = h('div');
  const statusSlot = h('div', { 'aria-live': 'polite' });
  const resultSlot = h('div');
  let seq = 0;
  let busy = false;
  let lastAction = null;

  const placeholder = { bus: '정류장 이름 또는 번호 (예: 강남역, 22009)', subway: '역 이름 (예: 강남, 서울역)', signal: '교차로 이름 (예: 강남역 사거리)' };

  function renderSeg() {
    input.placeholder = placeholder[type];
    swap(
      segSlot,
      h('div.seg', { role: 'radiogroup', 'aria-label': '대상 종류' },
        ['bus', 'subway', 'signal'].map((t) => h('button', { type: 'button', role: 'radio', 'aria-checked': t === type ? 'true' : 'false', dataset: { fkey: `seg-${t}` }, onclick: () => { if (t !== type) { type = t; input.value = ''; seq++; busy = false; swap(resultSlot); swap(statusSlot); swap(locSlot); renderSeg(); input.focus(); } } }, icon(KIND_ICON[t], 'icon-sm'), KIND_NAME[t]))),
    );
  }

  function renderOffline() {
    swap(offlineSlot, net.online ? null : offlineAddNotice());
    return !net.online;
  }

  function save(r) {
    try {
      const res = addTarget({ type: r.type, key: r.id, name: r.name, sub: r.sub, ref: r.ref });
      if (res.duplicate) {
        swap(statusSlot, h('div.notice.warn', { role: 'alert' }, icon('info'), h('div.grow', `‘${r.name}’은(는) 이미 저장되어 있어요. 새로 만들지 않았어요.`)));
        return;
      }
      track('favorite_saved', { kind: r.type });
      toast(`‘${r.name}’을(를) 저장했어요. 홈 교통 영역 맨 아래에 추가됐어요.`);
      afterSave(from);
    } catch (e) {
      if (e instanceof SaveError) swap(statusSlot, saveFailNotice(() => save(r)));
      else throw e;
    }
  }

  function showResults(items, { nearby, coarseLoc } = {}) {
    if (!items.length) {
      swap(statusSlot, h('div.notice', icon('search'), h('div.grow',
        h('div', nearby ? `주변에서 ${KIND_NAME[type]}을(를) 찾지 못했어요.` : `‘${input.value.trim()}’에 맞는 ${KIND_NAME[type]}이(가) 없어요.`),
        h('div.small.muted', nearby ? '이름이나 번호로 직접 검색해 보세요.' : '다른 검색어로 찾아보세요. 서울·경기 지역만 지원해요.'))));
      swap(resultSlot);
      return;
    }
    swap(statusSlot, h('div.stack',
      coarseLoc ? h('div.notice.warn', icon('info'), h('div.grow', '대략적인 위치라 주변 결과가 정확하지 않을 수 있어요. 직접 검색도 해 보세요.')) : null,
      h('p.small.muted', `${nearby ? '주변 ' : ''}결과 ${items.length}개`)));
    swap(
      resultSlot,
      h('ul.group.result-list', items.map((r) => {
        const saved = state.targets.some((t) => t.key === r.id);
        return h('li', h('button.item', { type: 'button', 'aria-disabled': r.supported === false ? 'true' : null, onclick: () => (r.supported === false ? null : save(r)) },
          h(`span.kind-badge.${r.type}`, icon(KIND_ICON[r.type], 'icon-sm')),
          h('div.grow', h('div.title', r.name), h('div.desc', [r.sub, r.distanceM != null ? `${r.distanceM}m` : null].filter(Boolean).join(' · '))),
          r.supported === false ? h('span.tag.warn', '지원하지 않는 지역') : saved ? h('span.tag', '저장됨') : h('span.chev', icon('plus'))));
      })),
    );
  }

  function showError(e, retry) {
    if (e.kind === 'offline') { renderOffline(); swap(statusSlot); return; }
    swap(statusSlot, h('div.notice.error', { role: 'alert' }, icon('alert'), h('div.grow', h('div', errorText(e.kind, e.detail)),
      h('div.actions', btn('다시 시도', { small: true, iconName: 'refresh', onClick: retry, fkey: 'tr-retry' }), btn('직접 검색하기', { small: true, onClick: () => input.focus() })))));
  }

  async function search(q = input.value.trim()) {
    if (!q || busy || renderOffline()) return;
    busy = true;
    const my = ++seq;
    lastAction = () => search(q);
    swap(statusSlot, h('div.row.muted', h('span.spinner'), `‘${q}’ 검색 중…`));
    swap(resultSlot);
    try {
      const res = await getJSON(`/api/transit/search?type=${type}&q=${encodeURIComponent(q)}`);
      if (my === seq) showResults(res.data || []);
    } catch (e) {
      if (my === seq) showError(e, () => search(q));
    } finally {
      if (my === seq) busy = false;
    }
  }

  async function nearby() {
    if (busy || renderOffline()) return;
    swap(locSlot);
    const loc = await requestLocation('nearby');
    if (loc.status === 'denied') { swap(locSlot, deniedNotice({ onSearch: () => input.focus() })); input.focus(); return; }
    if (loc.status === 'error') {
      swap(locSlot, h('div.notice.error', { role: 'alert' }, icon('location'), h('div.grow',
        h('div', loc.reason === 'timeout' ? '위치를 확인하는 데 시간이 너무 걸려요.' : '위치를 가져오지 못했어요. Windows 위치 서비스가 꺼져 있을 수 있어요.'),
        h('div.actions', btn('위치 다시 시도', { small: true, iconName: 'refresh', onClick: nearby }), btn('직접 검색하기', { small: true, kind: 'primary', iconName: 'search', onClick: () => input.focus() })))));
      return;
    }
    if (loc.status !== 'ok') { input.focus(); return; }
    busy = true;
    const my = ++seq;
    swap(statusSlot, h('div.row.muted', h('span.spinner'), '주변에서 찾는 중…'));
    swap(resultSlot);
    try {
      // 지원 지역 확인 (서울·경기 밖이면 주변 결과 대신 안내)
      const rev = await getJSON(`/api/regions/reverse?lat=${coarse(loc.lat, 3)}&lon=${coarse(loc.lon, 3)}`).catch(() => null);
      if (my !== seq) return;
      if (rev && rev.data && rev.data.supported === false) {
        swap(statusSlot);
        swap(locSlot, h('div.notice.warn', { role: 'alert' }, icon('location'), h('div.grow', h('div', '지금 위치는 지원하는 지역(서울·경기)이 아니에요.'), h('div.small', '이름이나 번호로 직접 검색해 주세요.'))));
        input.focus();
        return;
      }
      const res = await getJSON(`/api/transit/nearby?type=${type}&lat=${coarse(loc.lat, 3)}&lon=${coarse(loc.lon, 3)}`);
      if (my === seq) showResults(res.data || [], { nearby: true, coarseLoc: loc.coarse });
    } catch (e) {
      if (my === seq) showError(e, nearby);
    } finally {
      if (my === seq) busy = false;
    }
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  renderSeg();

  const el = page(
    `${KIND_NAME[type]} 찾기`.replace(/^.*찾기$/, '정류장·역·신호등 찾기'),
    { fallback: from === 'onboarding' ? '/onboarding' : '/settings/transit-targets/new' },
    offlineSlot,
    segSlot,
    h('div.group', h('button.item', { type: 'button', onclick: nearby, dataset: { fkey: 'tr-near' } }, h('span.kind-badge', icon('crosshair', 'icon-sm')), h('div.grow', h('div.title', '주변에서 찾기'), h('div.desc', '누르면 위치를 쓰는 이유를 먼저 알려 드려요')), h('span.chev', icon('chevron')))),
    locSlot,
    h('div.field', h('label', { for: 'tr-q' }, '이름·번호로 검색'), h('div.search-box', input, btn('검색', { kind: 'primary', iconName: 'search', onClick: () => search(), fkey: 'tr-go' }))),
    statusSlot,
    resultSlot,
  );
  const unsub = net.onChange(() => { renderOffline(); if (net.online && lastAction) swap(statusSlot); });
  return { el, mounted() { renderOffline(); input.focus(); }, unmount: unsub, keepFocus: true };
}

/* ───────── 장소 고르기 (경로 출발지·목적지) ───────── */
function placePicker({ label, id, initial, onChange: changed }) {
  let selected = initial || null;
  const wrap = h('div.field');
  const input = h('input.input', { type: 'search', id, maxlength: 40, placeholder: '장소·역·주소 이름', dataset: { fkey: id } });
  const status = h('div', { 'aria-live': 'polite' });
  const results = h('div');
  let seq = 0;
  let busy = false;
  let lastQ = '';

  async function search(q = input.value.trim()) {
    if (!q || busy) return;
    if (!net.online) { swap(status, h('div.notice.offline', icon('wifiOff'), '오프라인이라 장소를 검색할 수 없어요.')); return; }
    busy = true;
    lastQ = q;
    const my = ++seq;
    swap(status, h('div.row.muted', h('span.spinner'), `‘${q}’ 검색 중…`));
    swap(results);
    try {
      const res = await getJSON(`/api/places/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      const items = res.data || [];
      if (!items.length) { swap(status, h('div.notice', icon('search'), `‘${q}’에 맞는 장소가 없어요. 다른 검색어로 찾아보세요.`)); return; }
      swap(status);
      swap(results, h('ul.group.result-list', items.map((p) => h('li', h('button.item', { type: 'button', 'aria-disabled': p.supported ? null : 'true', onclick: () => p.supported && pick(p) },
        icon('location'), h('div.grow', h('div.title', p.name), h('div.desc', p.address || '')), p.supported ? h('span.chev', icon('check')) : h('span.tag.warn', '지원하지 않는 지역'))))));
    } catch (e) {
      if (my !== seq) return;
      swap(status, h('div.notice.error', { role: 'alert' }, icon('alert'), h('div.grow', h('div', errorText(e.kind, e.detail)), h('div.actions', btn('다시 시도', { small: true, iconName: 'refresh', onClick: () => search(lastQ) })))));
    } finally {
      if (my === seq) busy = false;
    }
  }

  function pick(p) {
    selected = { name: p.name, lat: p.lat, lon: p.lon };
    render();
    changed(selected);
    wrap.querySelector('button')?.focus();
  }

  function render() {
    if (selected) {
      swap(wrap, h('div.label', label), h('div.group', h('div.item', icon('location'), h('div.grow', h('div.title', selected.name)), btn('바꾸기', { small: true, fkey: `${id}-change`, onClick: () => { selected = null; changed(null); render(); input.focus(); } }))));
    } else {
      swap(wrap, h('label', { for: id }, label), h('div.search-box', input, btn('검색', { iconName: 'search', onClick: () => search() })), status, results);
    }
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  render();
  return { el: wrap, get value() { return selected; }, setDisabled(d) { input.disabled = d; } };
}

function routeKey(o, d) {
  return `route:${o.lat.toFixed(4)},${o.lon.toFixed(4)}>${d.lat.toFixed(4)},${d.lon.toFixed(4)}`;
}
function samePlace(a, b) {
  return a && b && Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lon - b.lon) < 0.0005;
}

/* ───────── S-20 ───────── */
export function routeAddView({ query }) {
  const from = query.from || '';
  const nameInput = h('input.input', { id: 'rt-name', maxlength: 30, dataset: { fkey: 'rt-name' } });
  const statusSlot = h('div', { 'aria-live': 'polite' });
  const offlineSlot = h('div');
  const saveBtn = btn('저장', { kind: 'primary', onClick: () => save(), fkey: 'rt-save' });
  let saving = false;

  const sync = () => {
    const o = origin.value, d = dest.value;
    nameInput.placeholder = o && d ? `${o.name} → ${d.name}` : t('비워 두면 ‘출발지 → 목적지’로 보여요');
    saveBtn.disabled = !(o && d) || saving;
    if (o && d && samePlace(o, d)) {
      swap(statusSlot, h('div.notice.warn', { role: 'alert' }, icon('info'), '출발지와 목적지가 같아요. 목적지를 다른 곳으로 골라 주세요.'));
      saveBtn.disabled = true;
    } else swap(statusSlot);
  };
  const origin = placePicker({ label: '출발지', id: 'rt-o', onChange: sync });
  const dest = placePicker({ label: '목적지', id: 'rt-d', onChange: sync });

  function save() {
    const o = origin.value, d = dest.value;
    if (!o || !d || saving) return;
    saving = true;
    saveBtn.classList.add('is-busy');
    try {
      const name = `${o.name} → ${d.name}`;
      const res = addTarget({ type: 'route', key: routeKey(o, d), name, label: nameInput.value.trim(), sub: '', ref: { origin: o, dest: d } });
      if (res.duplicate) {
        swap(statusSlot, h('div.notice.warn', { role: 'alert' }, icon('info'), h('div.grow', '같은 출발지·목적지 경로가 이미 있어요. 새로 만들지 않고 기존 경로를 그대로 둘게요.')));
        return;
      }
      track('favorite_saved', { kind: 'route' });
      toast('경로를 저장했어요. 홈 교통 영역 맨 아래에 추가됐어요.');
      afterSave(from);
    } catch (e) {
      if (e instanceof SaveError) swap(statusSlot, saveFailNotice(save));
      else throw e;
    } finally {
      saving = false;
      saveBtn.classList.remove('is-busy');
    }
  }

  function renderOffline() {
    swap(offlineSlot, net.online ? null : h('div.notice.offline', icon('wifiOff'), h('div.grow', '오프라인이라 경로를 검색·추가할 수 없어요. 연결되면 다시 시도해 주세요.')));
    origin.setDisabled(!net.online);
    dest.setDisabled(!net.online);
  }

  sync();
  renderOffline();
  const unsub = net.onChange(renderOffline);
  const el = page(
    '경로 추가',
    { fallback: from === 'onboarding' ? '/onboarding' : '/settings/transit-targets/new' },
    h('div.notice', icon('info'), h('div.grow', '저장한 경로는 홈에서 대중교통 예상 소요 시간만 보여 줘요. 지도나 길 안내는 제공하지 않아요.')),
    offlineSlot,
    origin.el,
    dest.el,
    h('div.field', h('label', { for: 'rt-name' }, '경로 이름 (선택)'), nameInput, h('div.hint', '예: 출근길, 학원 가는 길')),
    statusSlot,
    h('div.footer-actions', btn('취소', { onClick: () => back('/settings/transit-targets') }), saveBtn),
  );
  return { el, unmount: unsub };
}

/* ───────── S-21 ───────── */
export function targetEditView({ params }) {
  const t = state.targets.find((x) => x.id === params[0]);
  if (!t) return { el: page('교통 대상 편집', { fallback: '/settings/transit-targets' }, h('div.notice.warn', icon('info'), '이 대상은 이미 삭제됐어요.')) };
  const unavailable = !!state.unavailable[t.id];
  const nameInput = h('input.input', { id: 'te-name', value: targetLabel(t), maxlength: 30, placeholder: t.name, dataset: { fkey: 'te-name' } });
  const statusSlot = h('div', { 'aria-live': 'polite' });
  const saveBtn = btn('저장', { kind: 'primary', onClick: () => save(), fkey: 'te-save' });
  let newOrigin = null, newDest = null;
  let routeSlot = null;
  let unsubNet = null;

  const dirty = () => (nameInput.value.trim() || t.name) !== targetLabel(t) || !!newOrigin || !!newDest;
  const sync = () => {
    let ok = dirty();
    if (t.type === 'route' && (newOrigin === false || newDest === false)) ok = false; // 바꾸는 중 (아직 안 고름)
    saveBtn.disabled = !ok;
  };
  nameInput.addEventListener('input', sync);

  if (t.type === 'route') {
    const o = placePicker({ label: '출발지', id: 'te-o', initial: t.ref.origin, onChange: (v) => { newOrigin = v || false; sync(); } });
    const d = placePicker({ label: '목적지', id: 'te-d', initial: t.ref.dest, onChange: (v) => { newDest = v || false; sync(); } });
    const offline = h('div');
    const renderOff = () => {
      swap(offline, net.online ? null : h('div.notice.offline', icon('wifiOff'), '오프라인이라 출발지·목적지는 지금 바꿀 수 없어요. 이름 변경은 할 수 있어요.'));
      o.setDisabled(!net.online);
      d.setDisabled(!net.online);
      for (const b of routeSlot?.querySelectorAll('button') || []) b.disabled = !net.online;
    };
    routeSlot = h('div.stack', h('div.label', { style: { fontWeight: 650 } }, '출발지·목적지 다시 지정'), offline, o.el, d.el);
    renderOff();
    unsubNet = net.onChange(renderOff);
  }

  function save() {
    const patch = { label: nameInput.value.trim() };
    if (t.type === 'route' && (newOrigin || newDest)) {
      const o = newOrigin || t.ref.origin, d = newDest || t.ref.dest;
      if (samePlace(o, d)) { swap(statusSlot, h('div.notice.warn', icon('info'), '출발지와 목적지가 같아요.')); return; }
      patch.ref = { origin: o, dest: d };
      patch.name = `${o.name} → ${d.name}`;
    }
    try {
      const res = editTarget(t.id, patch);
      if (res.duplicate) { swap(statusSlot, h('div.notice.warn', { role: 'alert' }, icon('info'), '같은 출발지·목적지 경로가 이미 있어요. 저장하지 않았어요.')); return; }
      toast('저장했어요.');
      back('/settings/transit-targets');
    } catch (e) {
      if (e instanceof SaveError) swap(statusSlot, saveFailNotice(save));
      else throw e;
    }
  }

  async function remove() {
    if (!(await confirmDelete(t))) return;
    try {
      deleteTarget(t.id);
      toast('삭제했어요.');
      back('/settings/transit-targets');
    } catch (e) {
      if (e instanceof SaveError) swap(statusSlot, saveFailNotice(remove));
      else throw e;
    }
  }

  sync();
  const el = page(
    '교통 대상 편집',
    { fallback: '/settings/transit-targets' },
    unavailable ? h('div.notice.warn', { role: 'alert' }, icon('alert'), h('div.grow', h('strong', '조회 불가'), h('div.small', t.type === 'route' ? '이 경로는 외부 데이터에서 조회되지 않아요. 출발지·목적지를 다시 지정하거나 삭제해 주세요.' : '이 대상은 외부 데이터에서 더 이상 조회되지 않아요. 삭제를 권해요.'))) : null,
    h('div.card', h('div.row', h(`span.kind-badge.${t.type}`, icon(KIND_ICON[t.type], 'icon-sm')), h('div.grow', h('div.small.faint', KIND_NAME[t.type]), h('div', { style: { fontWeight: 650 } }, t.name), t.type !== 'route' && t.sub ? h('div.small.muted', t.sub) : null))),
    h('div.field', h('label', { for: 'te-name' }, '표시 이름'), nameInput, h('div.hint', '홈에 보일 이름이에요. 비우면 원래 이름으로 돌아가요.')),
    routeSlot,
    statusSlot,
    h('div.footer-actions', btn('취소', { onClick: () => back('/settings/transit-targets') }), saveBtn),
    h('div.danger-zone', btn('이 대상 삭제', { kind: 'danger', iconName: 'trash', onClick: remove, fkey: 'te-delete' })),
  );
  return { el, unmount: () => unsubNet?.() };
}
