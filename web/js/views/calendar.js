// 홈 → 달력 탭: 오늘(또는 고른 날)의 모든 특별한 날 + 내 일정, 월/주 달력, 달·해 이동, 일정 추가
import { h, swap, btn, iconBtn, toast, dialog, confirmDialog, uid } from '../ui.js';
import { icon } from '../icons.js';
import { isEn } from '../i18n.js';
import { now as clockNow } from '../clock.js';
import { state, saveEvent, deleteEvent } from '../store.js';
import { daysOn, isRedDay, toLunar, keyOf, KIND } from '../days.js';

const L = (ko, en) => (isEn() ? en : ko);
const WD = () => (isEn() ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['일', '월', '화', '수', '목', '금', '토']);

// 한국 날짜 기준 오늘
export function todayKST() {
  const d = new Date(clockNow() + 9 * 3600e3);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}
const parse = (k) => k.split('-').map(Number);
const wdOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const add = (y, m, d, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 화면을 다시 그려도(몇 초마다) 보던 달·고른 날·보기 방식 유지
const ui = { y: null, m: null, sel: null, mode: 'month', scroll: 0 };

/* ───────── 내 일정 ───────── */
export function eventsOn(y, m, d) {
  const k = keyOf(y, m, d);
  return (state.events || []).filter((e) => {
    if (e.date === k) return true;
    const [ey, em, ed] = parse(e.date);
    if (k < e.date) return false; // 시작일 이전에는 반복도 없음
    if (e.repeat === 'yearly') return em === m && ed === d;
    if (e.repeat === 'monthly') return ed === d;
    if (e.repeat === 'weekly') return wdOf(ey, em, ed) === wdOf(y, m, d);
    return false;
  }).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

function editEvent(existing, dateKey, rerender) {
  const ev = existing ? { ...existing } : { id: uid(), date: dateKey, time: '', title: '', memo: '', repeat: 'none' };
  const title = h('input.input', { id: 'ev-title', value: ev.title, maxlength: '60', 'data-autofocus': '', placeholder: L('예: 수학 학원, 엄마 생신', 'e.g. Piano lesson, Mom\'s birthday') });
  const date = h('input.input', { id: 'ev-date', type: 'date', value: ev.date });
  const time = h('input.input', { id: 'ev-time', type: 'time', value: ev.time || '' });
  const repeat = h('select.select', { id: 'ev-repeat' },
    [['none', L('반복 안 함', 'Does not repeat')], ['weekly', L('매주', 'Every week')], ['monthly', L('매달', 'Every month')], ['yearly', L('매년 (생일·기념일)', 'Every year (birthdays)')]]
      .map(([v, t]) => h('option', { value: v, selected: ev.repeat === v }, t)));
  const memo = h('textarea.textarea', { id: 'ev-memo', rows: '3', maxlength: '300' }, ev.memo || '');
  const err = h('p.small', { style: { color: 'var(--err)', minHeight: '18px' } });
  const actions = [
    { label: L('취소', 'Cancel'), value: 'cancel' },
    {
      label: L('저장', 'Save'), kind: 'primary', icon: 'check', onClick: (close) => {
        const t = title.value.trim();
        if (!t) { err.textContent = L('제목을 적어 주세요.', 'Please enter a title.'); title.focus(); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { err.textContent = L('날짜를 골라 주세요.', 'Please pick a date.'); date.focus(); return; }
        try {
          saveEvent({ ...ev, title: t, date: date.value, time: time.value || '', repeat: repeat.value, memo: memo.value.trim() });
          close('saved');
          toast(L('일정을 저장했어요.', 'Saved.'));
          ui.sel = date.value;
          const [y, m] = parse(date.value);
          ui.y = y; ui.m = m;
          rerender();
        } catch {
          err.textContent = L('저장하지 못했어요. 다시 시도해 주세요.', 'Could not save. Please try again.');
        }
      },
    },
  ];
  if (existing) {
    actions.unshift({
      label: L('삭제', 'Delete'), icon: 'trash', onClick: async (close) => {
        close('delete');
        if (await confirmDialog({ title: L('일정 삭제', 'Delete event'), body: L(`"${ev.title}" 일정을 지울까요?`, `Delete "${ev.title}"?`), confirmLabel: L('삭제', 'Delete'), danger: true })) {
          deleteEvent(ev.id);
          toast(L('일정을 지웠어요.', 'Deleted.'));
          rerender();
        }
      },
    });
  }
  dialog({
    title: existing ? L('일정 고치기', 'Edit event') : L('일정 추가', 'New event'),
    body: h('div.stack',
      h('div.field', h('label', { for: 'ev-title' }, L('제목', 'Title')), title),
      h('div.ev-row', h('div.field', h('label', { for: 'ev-date' }, L('날짜', 'Date')), date), h('div.field', h('label', { for: 'ev-time' }, L('시간 (선택)', 'Time (optional)')), time)),
      h('div.field', h('label', { for: 'ev-repeat' }, L('반복', 'Repeat')), repeat),
      h('div.field', h('label', { for: 'ev-memo' }, L('메모 (선택)', 'Note (optional)')), memo),
      err),
    actions,
  });
}

/* ───────── 고른 날 자세히 ───────── */
function dayDetail(y, m, d, today, rerender) {
  const k = keyOf(y, m, d);
  const isToday = k === keyOf(...today);
  const list = daysOn(y, m, d);
  const mine = eventsOn(y, m, d);
  const lunar = toLunar(y, m, d);
  const wd = WD()[wdOf(y, m, d)];
  const red = isRedDay(y, m, d);
  return h(
    'section.card.cal-day',
    { 'aria-label': L(`${m}월 ${d}일`, `${m}/${d}`) },
    h('div.cal-day-head',
      h('div',
        h('div.cal-day-tag', isToday ? L('오늘', 'Today') : L('고른 날', 'Selected')),
        h(`div.cal-day-date${red ? '.red' : wdOf(y, m, d) === 6 ? '.blue' : ''}`, L(`${m}월 ${d}일 ${wd}요일`, `${wd}, ${m}/${d}`)),
        h('div.small.muted', `${y}${L('년', '')}${lunar ? L(` · 음력 ${lunar.leap ? '윤' : ''}${lunar.month}월 ${lunar.day}일`, ` · Lunar ${lunar.leap ? 'leap ' : ''}${lunar.month}/${lunar.day}`) : ''}`)),
      btn(L('일정 추가', 'Add event'), { small: true, kind: 'primary', iconName: 'plus', fkey: 'cal-add', onClick: () => editEvent(null, k, rerender) })),
    list.length || mine.length
      ? h('ul.cal-list',
        mine.map((e) => h('li.cal-item.mine',
          h('span.cal-kind.mine', KIND.mine[isEn() ? 'en' : 'ko']),
          h('div.grow', h('div.cal-name', e.time ? `${e.time} · ${e.title}` : e.title), e.memo ? h('div.cal-desc', e.memo) : null,
            e.repeat !== 'none' ? h('div.cal-desc', { 'data-notr': '' }, { weekly: L('매주 반복', 'Weekly'), monthly: L('매달 반복', 'Monthly'), yearly: L('매년 반복', 'Yearly') }[e.repeat]) : null),
          iconBtn('edit', L('고치기', 'Edit'), () => editEvent(e, k, rerender), { fkey: `ev-${e.id}` }))),
        list.map((x) => h(`li.cal-item.${x.kind}`,
          h(`span.cal-kind.${x.kind}`, KIND[x.kind][isEn() ? 'en' : 'ko']),
          h('div.grow', h('div.cal-name', x.name), x.desc ? h('div.cal-desc', x.desc) : null))))
      : h('p.muted', { style: { marginTop: '12px' } }, L('특별한 날도, 일정도 없는 평범한 날이에요.', 'Nothing special on this day.')),
  );
}

/* ───────── 칸 하나 ───────── */
function cell(y, m, d, { today, inMonth = true, week = false, pick }) {
  const k = keyOf(y, m, d);
  const list = daysOn(y, m, d);
  const mine = eventsOn(y, m, d);
  const wd = wdOf(y, m, d);
  const red = isRedDay(y, m, d);
  const items = [...mine.map((e) => ({ name: e.title, kind: 'mine' })), ...list];
  const max = week ? 99 : 3;
  const lunar = (d === 1 || week) ? toLunar(y, m, d) : null;
  return h(
    `button.cal-cell${k === keyOf(...today) ? '.today' : ''}${k === ui.sel ? '.sel' : ''}${inMonth ? '' : '.out'}${week ? '.week' : ''}`,
    { type: 'button', 'aria-label': `${m}/${d} ${items.map((x) => x.name).join(', ')}`, 'aria-pressed': k === ui.sel ? 'true' : 'false', onClick: () => pick(k) },
    h('div.cal-num-row',
      h(`span.cal-num${red ? '.red' : wd === 6 ? '.blue' : ''}`, String(d)),
      lunar ? h('span.cal-lunar', `${lunar.leap ? L('윤', 'L') : ''}${lunar.month}.${lunar.day}`) : null),
    items.slice(0, max).map((x) => h(`span.cal-label.${x.kind}`, x.name)),
    items.length > max ? h('span.cal-more', L(`+${items.length - max}개`, `+${items.length - max}`)) : null,
  );
}

/** 홈의 달력 탭 내용 */
export function calendarPanel() {
  const today = todayKST();
  if (ui.y == null) { ui.y = today[0]; ui.m = today[1]; ui.sel = keyOf(...today); }
  const root = h('div.cal-wrap');
  const rerender = () => {
    swap(root, ...build());
  };
  const pick = (k) => {
    ui.sel = k;
    const [y, m] = parse(k);
    if (ui.mode === 'month' && (y !== ui.y || m !== ui.m)) { ui.y = y; ui.m = m; }
    rerender();
  };
  const move = (dm) => {
    if (ui.mode === 'week') {
      const [y, m, d] = add(...parse(ui.sel), dm * 7);
      ui.sel = keyOf(y, m, d); ui.y = y; ui.m = m;
    } else {
      let y = ui.y, m = ui.m + dm;
      while (m < 1) { m += 12; y--; }
      while (m > 12) { m -= 12; y++; }
      ui.y = y; ui.m = m;
      // 고른 날도 같은 날짜로 따라간다 (없으면 그 달 마지막 날)
      const [, , sd] = parse(ui.sel);
      ui.sel = keyOf(y, m, Math.min(sd, daysInMonth(y, m)));
    }
    rerender();
  };
  const build = () => {
    const [sy, sm, sd] = parse(ui.sel);
    const title = ui.mode === 'month'
      ? L(`${ui.y}년 ${ui.m}월`, `${ui.y} / ${ui.m}`)
      : (() => { const [a, b, c] = add(sy, sm, sd, -wdOf(sy, sm, sd)); const [e, f, g] = add(a, b, c, 6); return L(`${a}년 ${b}월 ${c}일 – ${f}월 ${g}일`, `${b}/${c}/${a} – ${f}/${g}`); })();
    const head = h('div.cal-head',
      iconBtn('back', ui.mode === 'month' ? L('1년 전', 'Previous year') : L('4주 전', '4 weeks back'), () => move(ui.mode === 'month' ? -12 : -4), { fkey: 'cal-py' }),
      iconBtn('back', ui.mode === 'month' ? L('이전 달', 'Previous month') : L('이전 주', 'Previous week'), () => move(-1), { fkey: 'cal-pm' }),
      h('h2.cal-title', title),
      iconBtn('chevron', ui.mode === 'month' ? L('다음 달', 'Next month') : L('다음 주', 'Next week'), () => move(1), { fkey: 'cal-nm' }),
      iconBtn('chevron', ui.mode === 'month' ? L('1년 뒤', 'Next year') : L('4주 뒤', '4 weeks ahead'), () => move(ui.mode === 'month' ? 12 : 4), { fkey: 'cal-ny' }),
      h('div.grow'),
      btn(L('오늘', 'Today'), { small: true, fkey: 'cal-today', onClick: () => { ui.y = today[0]; ui.m = today[1]; ui.sel = keyOf(...today); rerender(); } }),
      h('div.seg', { role: 'group', 'aria-label': L('보기', 'View') },
        btn(L('월', 'Month'), { small: true, kind: ui.mode === 'month' ? 'primary' : '', fkey: 'cal-month', onClick: () => { ui.mode = 'month'; ui.y = sy; ui.m = sm; rerender(); } }),
        btn(L('주', 'Week'), { small: true, kind: ui.mode === 'week' ? 'primary' : '', fkey: 'cal-week', onClick: () => { ui.mode = 'week'; rerender(); } })),
    );
    // 해 이동 버튼은 화살표가 두 개 (◀◀ ▶▶) 로 보이게
    head.children[0].classList.add('dbl');
    head.children[4].classList.add('dbl');
    const wdRow = h('div.cal-wd', WD().map((w, i) => h(`span${i === 0 ? '.red' : i === 6 ? '.blue' : ''}`, w)));
    let grid;
    if (ui.mode === 'month') {
      const first = wdOf(ui.y, ui.m, 1);
      const cells = [];
      const [py, pm, pd0] = add(ui.y, ui.m, 1, -first);
      const total = Math.ceil((first + daysInMonth(ui.y, ui.m)) / 7) * 7;
      for (let i = 0; i < total; i++) {
        const [y, m, d] = add(py, pm, pd0, i);
        cells.push(cell(y, m, d, { today, inMonth: m === ui.m, pick }));
      }
      grid = h('div.cal-grid', { style: { gridTemplateRows: `repeat(${total / 7}, minmax(78px, 1fr))` } }, cells);
    } else {
      const start = add(sy, sm, sd, -wdOf(sy, sm, sd));
      grid = h('div.cal-grid.weekgrid', Array.from({ length: 7 }, (_, i) => { const [y, m, d] = add(...start, i); return cell(y, m, d, { today, week: true, pick }); }));
    }
    return [
      dayDetail(sy, sm, sd, today, rerender),
      h('section.card.cal-main', { 'aria-label': L('달력', 'Calendar') }, head, wdRow, grid,
        h('div.cal-legend',
          ['holiday', 'legal', 'term', 'folk', 'intl', 'fun', 'mine'].map((k) => h(`span.cal-label.${k}`, KIND[k][isEn() ? 'en' : 'ko'])))),
    ];
  };
  swap(root, ...build());
  // 다시 그려도 세로 위치 유지
  setTimeout(() => {
    if (!root.isConnected) return;
    root.scrollTop = ui.scroll;
    setTimeout(() => root.addEventListener('scroll', () => { if (root.isConnected) ui.scroll = root.scrollTop; }, { passive: true }), 50);
  }, 0);
  return root;
}

/** 시계 카드 아래에 붙는 '오늘은' 한 줄 */
export function todayLine() {
  const t = todayKST();
  const list = [...eventsOn(...t).map((e) => e.title), ...daysOn(...t).map((x) => x.name)];
  if (!list.length) return null;
  const shown = list.slice(0, 3).join(' · ');
  return h('div.clock-days', { title: list.join('\n') }, icon('calendar', 'icon-sm'), h('span.ellipsis', list.length > 3 ? L(`${shown} 외 ${list.length - 3}개`, `${shown} +${list.length - 3}`) : shown));
}
