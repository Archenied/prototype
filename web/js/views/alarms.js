// S-09 출발 알림 목록 · S-10 출발 알림 추가·수정
// 알림 권한은 '알림 추가'를 누를 때 처음 묻는다. 거부하면 저장하지 않고 설정 이동 안내를 보여 준다.
import { h, swap, btn, toast, confirmDialog, dialog, uid, fmtDateTime } from '../ui.js';
import { icon } from '../icons.js';
import { state, saveAlarm, deleteAlarm, update, SaveError } from '../store.js';
import { go, back, page } from '../app.js';
import { DAY_NAMES, nextFire, repeatText, scheduleNotice, notificationSupport } from '../alarms.js';
import { openWindowsSettings } from '../location.js';
import { t } from '../i18n.js';

function deniedNotice() {
  return h(
    'div.notice.warn',
    { role: 'alert' },
    icon('bellOff'),
    h('div.grow',
      h('strong', '알림이 꺼져 있어 출발 알림이 표시되지 않아요.'),
      h('div.small', 'Windows 알림 설정에서 Microsoft Edge 알림을 켜고, 앱 창 오른쪽 위 ⋯ 메뉴 → 사이트 권한에서 알림을 허용해 주세요.'),
      h('div.actions', btn('Windows 알림 설정 열기', { small: true, iconName: 'external', onClick: () => openWindowsSettings('notifications') }))),
  );
}

async function ensurePermission() {
  const s = notificationSupport();
  if (s === 'unsupported') return 'unsupported';
  if (s !== 'default') return s;
  const go2 = await confirmDialog({ title: '알림 허용', body: '정한 출발 시각에 알려 드리려면 알림 권한이 필요해요. 다음 창에서 허용을 눌러 주세요.', confirmLabel: '계속', cancelLabel: '나중에' });
  if (!go2) return 'default';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/* ───────── S-09 ───────── */
export function alarmsListView() {
  const topSlot = h('div');
  const listSlot = h('div');
  const failSlot = h('div');

  async function onAdd() {
    const p = await ensurePermission();
    if (p === 'unsupported') {
      dialog({ title: '알림을 쓸 수 없어요', body: '이 환경에서는 알림을 지원하지 않아요. 알림은 저장하지 않았어요.', actions: [{ label: '확인', kind: 'primary' }] });
      return;
    }
    if (p === 'denied') {
      render();
      swap(failSlot, h('div.notice.warn', { role: 'alert' }, icon('bellOff'), h('div.grow', h('div', '알림 권한이 없어 알림을 저장하지 않았어요.'), h('div.actions', btn('Windows 알림 설정 열기', { small: true, iconName: 'external', onClick: () => openWindowsSettings('notifications') })))));
      return;
    }
    if (p === 'granted') go('/settings/alarms/edit');
  }

  function toggle(a, on) {
    try {
      saveAlarm({ ...a, enabled: on, nextAt: on ? nextFire(a) : null });
      swap(failSlot);
      if (on) toast(scheduleNotice({ ...a, nextAt: nextFire(a) }));
    } catch (e) {
      if (e instanceof SaveError) swap(failSlot, h('div.notice.error', { role: 'alert' }, icon('alert'), '이 PC에 저장하지 못했어요. 다시 시도해 주세요.'));
      else throw e;
    }
    render();
  }

  async function remove(a) {
    if (!(await confirmDialog({ title: '알림 삭제', body: `‘${a.name}’ 알림을 삭제할까요? 예약도 함께 지워져요.`, confirmLabel: '삭제', danger: true }))) return;
    try { deleteAlarm(a.id); toast('알림을 삭제했어요.'); } catch (e) { if (!(e instanceof SaveError)) throw e; swap(failSlot, h('div.notice.error', icon('alert'), '삭제하지 못했어요. 다시 시도해 주세요.')); }
    render();
  }

  function render() {
    const s = notificationSupport();
    swap(topSlot, s === 'denied' ? deniedNotice() : null);
    const list = [...state.alarms].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    if (!list.length) {
      swap(listSlot, h('div.card', h('div.empty', icon('bell', 'icon-lg'), h('p', '출발 시각을 정해 두면 그 시각에 알림을 보내 드려요. 알림을 누르면 바로 시각·날씨·교통을 확인할 수 있어요.'), btn('알림 추가', { kind: 'primary', iconName: 'plus', onClick: onAdd, fkey: 'al-empty-add' }))));
      return;
    }
    swap(
      listSlot,
      h('div.group', list.map((a) => {
        const sw = h('input', { type: 'checkbox', role: 'switch', checked: a.enabled, 'aria-label': `${a.name} 켜기`, onchange: (e) => toggle(a, e.target.checked) });
        const time = new Intl.DateTimeFormat(navigator.language || 'ko-KR', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, a.hour, a.minute));
        return h(
          `div.item${a.enabled ? '' : '.alarm-off'}`,
          h('button.grow', { type: 'button', style: { background: 'none', border: 0, textAlign: 'left', padding: '4px 0', cursor: 'pointer' }, dataset: { fkey: `al-${a.id}` }, onclick: () => go(`/settings/alarms/edit?id=${a.id}`) },
            h('div.alarm-time', time),
            h('div.title', a.name),
            h('div.desc', repeatText(a), ' · ', a.enabled && a.nextAt ? `다음 알림 ${fmtDateTime(a.nextAt)}` : '꺼짐')),
          h('span.switch', sw),
          btn('', { kind: 'ghost', iconName: 'trash', ariaLabel: `${a.name} 삭제`, onClick: () => remove(a), fkey: `al-del-${a.id}` }),
        );
      })),
    );
  }

  render();
  const el = page(
    '출발 알림',
    { right: btn('알림 추가', { small: true, kind: 'primary', iconName: 'plus', onClick: onAdd, fkey: 'al-add' }) },
    topSlot,
    failSlot,
    listSlot,
    h('p.small.faint', 'Windows 버전에서는 앱이 열려 있을 때(최소화 포함) 알림이 표시돼요. 앱을 닫아 두면 알림이 오지 않아요.'),
  );
  const onVis = () => { if (!document.hidden) render(); };
  document.addEventListener('visibilitychange', onVis);
  return { el, unmount: () => document.removeEventListener('visibilitychange', onVis) };
}

/* ───────── 시각 고르기: 숫자를 눌러 입력 · 휠로 1씩 · ▲▼ 버튼 · 방향키 ───────── */
function timePicker(draft, onChange) {
  const wrap = h('div.time-picker', { role: 'group', 'aria-labelledby': 'al-time-label' });
  const period = h('div.tp-period');

  function unit(key, max, label) {
    const box = h('div.tp-unit');
    let editing = false;
    let wheelAcc = 0;
    const set = (v) => {
      draft[key] = ((v % (max + 1)) + (max + 1)) % (max + 1); // 끝에서 처음으로 돌아감 (23→0, 59→0)
      draw();
      onChange();
    };
    const num = h('button.tp-num', {
      type: 'button', role: 'spinbutton', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(max),
      onclick: () => startEdit(),
      onkeydown: (e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); set(draft[key] + 1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); set(draft[key] - 1); }
        if (/^\d$/.test(e.key)) { e.preventDefault(); startEdit(e.key); }
      },
    });
    // 마우스 휠: 한 칸에 1씩. 터치패드처럼 조금씩 오는 값은 모아서 한 칸이 되면 움직인다.
    box.addEventListener('wheel', (e) => {
      if (editing) return;
      e.preventDefault();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) >= 50) { // 마우스 휠 한 칸(보통 100) = 1
        set(draft[key] + (wheelAcc > 0 ? -1 : 1));
        wheelAcc = 0;
      }
    }, { passive: false });
    const input = h('input.tp-input', { type: 'text', inputmode: 'numeric', maxlength: '2', 'aria-label': label });
    function startEdit(first = '') {
      editing = true;
      input.value = first || String(draft[key]).padStart(2, '0');
      box.replaceChildren(up, input, down);
      input.focus();
      if (!first) input.select();
    }
    function commit() {
      if (!editing) return;
      editing = false;
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v)) draft[key] = Math.max(0, Math.min(max, v));
      box.replaceChildren(up, num, down);
      draw();
      onChange();
    }
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); if (input.value.length === 2) commit(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') commit();
      if (e.key === 'Escape') { e.stopPropagation(); input.value = String(draft[key]); commit(); }
    });
    input.addEventListener('blur', commit);
    const up = h('button.tp-step', { type: 'button', 'aria-label': `${label} +1`, tabindex: '-1', onclick: () => set(draft[key] + 1) }, icon('up', 'icon-sm'));
    const down = h('button.tp-step', { type: 'button', 'aria-label': `${label} -1`, tabindex: '-1', onclick: () => set(draft[key] - 1) }, icon('down', 'icon-sm'));
    function draw() {
      num.textContent = String(draft[key]).padStart(2, '0');
      num.setAttribute('aria-valuenow', String(draft[key]));
      const ap = draft.hour < 12 ? '오전' : '오후';
      const h12 = draft.hour % 12 === 0 ? 12 : draft.hour % 12;
      period.textContent = `${t(ap)} ${h12}:${String(draft.minute).padStart(2, '0')}`;
    }
    box.append(up, num, down);
    draw();
    return box;
  }

  wrap.append(unit('hour', 23, '시'), h('div.tp-colon', ':'), unit('minute', 59, '분'), period);
  return wrap;
}

/* ───────── S-10 ───────── */
export function alarmEditView({ query }) {
  const existing = state.alarms.find((a) => a.id === query.id);
  const now = new Date();
  const draft = existing
    ? structuredClone(existing)
    : { id: uid(), name: '', hour: (now.getHours() + 1) % 24, minute: 0, repeat: 'weekly', days: [1, 2, 3, 4, 5], enabled: true, nextAt: null };
  const initial = JSON.stringify({ n: draft.name, h: draft.hour, m: draft.minute, r: draft.repeat, d: draft.days });
  let saved = false;

  const nameInput = h('input.input', { id: 'al-name', maxlength: 30, value: draft.name, placeholder: '예: 출근, 학원 가기', dataset: { fkey: 'al-name' } });
  const timeInput = timePicker(draft, () => render());
  const repeatSlot = h('div');
  const daysSlot = h('div');
  const previewSlot = h('div', { 'aria-live': 'polite' });
  const statusSlot = h('div');
  const saveBtn = btn(existing ? '저장' : '알림 저장', { kind: 'primary', onClick: () => save(), fkey: 'al-save' });

  const valid = () => draft.name.trim() && (draft.repeat === 'once' || draft.days.length > 0);
  const dirty = () => JSON.stringify({ n: draft.name, h: draft.hour, m: draft.minute, r: draft.repeat, d: draft.days }) !== initial;

  function render() {
    swap(repeatSlot, h('div.seg', { role: 'radiogroup', 'aria-label': '반복 방식' },
      [['once', '한 번만'], ['weekly', '요일 반복']].map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': draft.repeat === v ? 'true' : 'false', dataset: { fkey: `rep-${v}` }, onclick: () => { draft.repeat = v; render(); } }, l))));
    swap(daysSlot, draft.repeat === 'weekly'
      ? h('div.field', h('div.label', '울릴 요일'),
          h('div.days', { role: 'group', 'aria-label': '요일 선택' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('button.day', { type: 'button', 'aria-pressed': draft.days.includes(d) ? 'true' : 'false', dataset: { fkey: `day-${d}` }, onclick: () => { draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d]; render(); } }, DAY_NAMES[d]))),
          draft.days.length ? null : h('div.hint', { style: { color: 'var(--err)' } }, '요일을 하나 이상 골라 주세요.'))
      : null);
    const next = nextFire(draft);
    swap(previewSlot, valid() || draft.repeat === 'once'
      ? h('div.notice.ok', icon('bell'), h('div.grow', h('div', '다음 알림: ', h('strong', next ? fmtDateTime(next) : '—')), h('div.small', scheduleNotice({ ...draft, nextAt: next }))))
      : null);
    saveBtn.disabled = !valid();
  }

  nameInput.addEventListener('input', () => { draft.name = nameInput.value; render(); });

  function save() {
    if (!valid()) return;
    if (notificationSupport() === 'denied') {
      swap(statusSlot, deniedNotice());
      return;
    }
    saveBtn.classList.add('is-busy');
    const alarm = { ...draft, name: draft.name.trim(), enabled: true, nextAt: nextFire(draft) };
    try {
      saveAlarm(alarm);
      saved = true;
      toast(scheduleNotice(alarm), 4500);
      back('/settings/alarms');
    } catch (e) {
      if (e instanceof SaveError) swap(statusSlot, h('div.notice.error', { role: 'alert' }, icon('alert'), h('div.grow', h('div', '알림을 저장·예약하지 못했어요. 입력한 내용은 그대로예요.'), h('div.actions', btn('다시 저장', { small: true, iconName: 'refresh', onClick: save })))));
      else throw e;
    } finally {
      saveBtn.classList.remove('is-busy');
    }
  }

  render();
  const el = page(
    existing ? '출발 알림 수정' : '출발 알림 추가',
    { fallback: '/settings/alarms' },
    h('div.field', h('div.label', { id: 'al-time-label' }, '알림 시각'), timeInput, h('div.hint', '숫자를 눌러 직접 입력하거나, 숫자 위에서 마우스 휠을 돌려 1씩 바꿀 수 있어요.')),
    h('div.field', h('label', { for: 'al-name' }, '알림 이름'), nameInput, h('div.hint', '알림에 이 이름이 함께 표시돼요.')),
    h('div.field', h('div.label', '반복 방식'), repeatSlot),
    daysSlot,
    previewSlot,
    statusSlot,
    h('div.footer-actions', btn('취소', { onClick: () => back('/settings/alarms') }), saveBtn),
  );
  return {
    el,
    async beforeLeave() {
      if (saved || !dirty()) return true;
      return confirmDialog({ title: '입력 내용 버리기', body: existing ? '저장하지 않으면 기존 알림과 예약이 그대로 유지돼요. 버리고 나갈까요?' : '입력한 알림을 저장하지 않고 나갈까요?', confirmLabel: '버리기', cancelLabel: '계속 작성', danger: true });
    },
  };
}
void update;
