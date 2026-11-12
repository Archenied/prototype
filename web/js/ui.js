// 화면 조립 도우미: 요소 만들기, 대화상자, 알림 토스트, 시간 표시 형식.
import { icon } from './icons.js';
import { now as clockNow } from './clock.js';
import { t, prefs, locale as prefLocale } from './i18n.js';

const TRANSLATED_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);

// h('div.card#id', {attrs}, ...children)
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : TRANSLATED_ATTRS.has(k) ? t(v) : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(t(String(c))));
  }
}

// 같은 자리를 새 내용으로 바꾸되, 키보드 포커스가 있던 요소(data-fkey)는 그대로 이어지게 한다.
export function swap(container, ...children) {
  const active = document.activeElement;
  const fkey = active && container.contains(active) ? active.dataset.fkey : null;
  container.replaceChildren();
  append(container, children);
  if (fkey) {
    const next = container.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`);
    if (next) next.focus({ preventScroll: true });
  }
}

export function btn(label, opts = {}) {
  const { kind = '', iconName, onClick, small, disabled, busy, fkey, title, type = 'button', ariaLabel } = opts;
  return h(
    'button',
    {
      type,
      class: ['btn', kind && `btn-${kind}`, small && 'btn-sm', busy && 'is-busy'].filter(Boolean).join(' '),
      disabled: !!disabled,
      'aria-busy': busy ? 'true' : null,
      title,
      'aria-label': ariaLabel,
      dataset: fkey ? { fkey } : undefined,
      onclick: onClick,
    },
    iconName ? icon(iconName, 'icon-sm') : null,
    label,
  );
}

export function iconBtn(name, label, onClick, opts = {}) {
  return h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick: onClick, disabled: !!opts.disabled, dataset: opts.fkey ? { fkey: opts.fkey } : undefined }, icon(name));
}

export function spinner() {
  return h('span.spinner', { 'aria-hidden': 'true' });
}

/* ───────── 토스트 ───────── */
export function toast(message, ms = 3200) {
  const region = document.getElementById('toast-region');
  const t = h('div.toast', icon('check', 'icon-sm'), message);
  region.append(t);
  setTimeout(() => t.remove(), ms);
}

/* ───────── 대화상자 (포커스 가두기·Esc 닫기) ───────── */
export function dialog({ title, body, actions, onClose, dismissible = true }) {
  const root = document.getElementById('dialog-root');
  const previous = document.activeElement;
  const titleId = 'dlg-' + Math.random().toString(36).slice(2);
  const box = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
  const backdrop = h('div.dialog-backdrop', box);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    onClose?.(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); close(undefined); }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  box.append(h('h2', { id: titleId }, title));
  if (body) box.append(h('div.body', body));
  const acts = h('div.actions');
  for (const a of actions || []) {
    acts.append(btn(a.label, { kind: a.kind, iconName: a.icon, onClick: () => (a.onClick ? a.onClick(close) : close(a.value)) }));
  }
  box.append(acts);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) close(undefined); });
  document.addEventListener('keydown', onKey, true);
  root.append(backdrop);
  const focusTarget = box.querySelector('[data-autofocus]') || acts.querySelector('.btn-primary, .btn-danger-solid') || acts.querySelector('button');
  focusTarget?.focus();
  return { close, box };
}

export function confirmDialog({ title, body, confirmLabel = '확인', cancelLabel = '취소', danger = false }) {
  return new Promise((resolve) => {
    dialog({
      title,
      body,
      onClose: (v) => resolve(v === true),
      actions: [
        { label: cancelLabel, value: false },
        { label: confirmLabel, value: true, kind: danger ? 'danger-solid' : 'primary' },
      ],
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', hint = '', confirmLabel = '저장', allowEmpty = false }) {
  return new Promise((resolve) => {
    const input = h('input.input', { value, placeholder, 'data-autofocus': '', 'aria-label': label, maxlength: 30 });
    const err = h('p.small.muted', hint);
    const { box, close } = dialog({
      title,
      body: h('div.field', h('label', label), input, err),
      onClose: (v) => resolve(v),
      actions: [
        { label: '취소', value: undefined },
        { label: confirmLabel, kind: 'primary', onClick: (c) => { if (!allowEmpty && !input.value.trim()) return; c(input.value.trim()); } },
      ],
    });
    const saveBtn = box.querySelector('.btn-primary');
    const sync = () => { if (!allowEmpty) saveBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !saveBtn.disabled) saveBtn.click(); });
    sync();
    input.focus();
    input.select();
    void close;
  });
}

/* ───────── 시간 표시 ───────── */
const locale = () => prefLocale();

// 시계가 따르는 시간대 (홈 지역의 시간대). 없으면 이 기기의 시간대.
let clockZoneName;
export function setClockZone(z) { clockZoneName = z || undefined; }
const zoneOpt = () => (clockZoneName ? { timeZone: clockZoneName } : {});

export function fmtClock(d = new Date(), withSeconds = false) {
  const parts = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), ...zoneOpt() }).formatToParts(d);
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value || '';
  const time = parts.filter((p) => p.type !== 'dayPeriod' && !(p.type === 'literal' && !p.value.trim())).map((p) => p.value).join('').trim();
  return { dayPeriod, time };
}
export function fmtDate(d = new Date()) {
  return new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', weekday: 'long', ...zoneOpt() }).format(d);
}
export function fmtTime(ts) {
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}
export function fmtDateTime(ts) {
  return new Intl.DateTimeFormat(locale(), { month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}
// 지난 시간: "12초 전", "1분 5초 전", "2시간 3분 전" (매초 갱신)
export function ago(ts, now = clockNow()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  const en = prefs.lang === 'en';
  if (s < 60) return en ? `${s}s ago` : `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return en ? `${m}m ${s % 60}s ago` : `${m}분 ${s % 60}초 전`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return en ? `${hh}h ${m % 60}m ago` : `${hh}시간 ${m % 60}분 전`;
  return en ? `${Math.floor(hh / 24)}d ago` : `${Math.floor(hh / 24)}일 전`;
}
export function etaText(arriveAt, now = clockNow()) {
  const s = Math.round((arriveAt - now) / 1000);
  if (s <= 60) return prefs.lang === 'en' ? 'Arriving' : '곧 도착';
  return prefs.lang === 'en' ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 60)}분`;
}

export function uid() {
  return (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
}
