// 출발 시각 알림 (F-08, R-15) — 웹 버전 규칙: 브라우저(Windows) 알림으로 표시, 앱이 열려 있어야 울림.
import { state, saveAlarm, saveQuiet } from './store.js';

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function notificationSupport() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // default · granted · denied
}

// 다음 알림 예정 일시 계산
export function nextFire(alarm, from = Date.now()) {
  const base = new Date(from);
  for (let d = 0; d <= 7; d++) {
    const c = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, alarm.hour, alarm.minute, 0, 0);
    if (c.getTime() <= from) continue;
    if (alarm.repeat === 'once') return c.getTime();
    if (alarm.days.includes(c.getDay())) return c.getTime();
  }
  return null;
}

export function repeatText(alarm) {
  if (alarm.repeat === 'once') return '한 번만';
  const d = [...alarm.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const key = d.join(',');
  if (key === '1,2,3,4,5') return '평일 반복';
  if (key === '6,0') return '주말 반복';
  if (d.length === 7) return '매일 반복';
  return d.map((x) => DAY_NAMES[x]).join('·') + ' 반복';
}

// 저장할 때 보여 줄 예약 안내 문구 (F-08-AC-06, AC-07)
export function scheduleNotice(alarm, now = Date.now()) {
  const next = alarm.nextAt;
  if (!next) return '';
  const n = new Date(next);
  const today = new Date(now);
  const dayDiff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400e3);
  const time = new Intl.DateTimeFormat(navigator.language || 'ko-KR', { hour: 'numeric', minute: '2-digit' }).format(n);
  const dayWord = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : dayDiff < 7 ? `이번 ${DAY_NAMES[n.getDay()]}요일` : `다음 주 ${DAY_NAMES[n.getDay()]}요일`;
  const todayPassed = alarm.repeat === 'once' ? dayDiff === 1 && new Date(now).getHours() * 60 + new Date(now).getMinutes() >= alarm.hour * 60 + alarm.minute : false;
  const weeklySkip = alarm.repeat === 'weekly' && alarm.days.includes(today.getDay()) && dayDiff > 0;
  const prefix = todayPassed ? '오늘은 이미 지난 시각이라 ' : weeklySkip ? '오늘 시각은 이미 지나서 ' : '';
  return `${prefix}${dayWord} ${time}에 예약했어요.`;
}

let onOpenHome = () => {};
export function setOpenHomeHandler(fn) {
  onOpenHome = fn;
}

function fire(alarm) {
  try {
    if (notificationSupport() !== 'granted') return;
    const n = new Notification(alarm.name || '출발 알림', {
      body: '출발할 시간이에요. 눌러서 시각·날씨·교통을 확인하세요.',
      tag: 'alarm-' + alarm.id,
      requireInteraction: true,
      icon: 'icon.svg',
    });
    n.onclick = () => {
      window.focus();
      n.close();
      onOpenHome();
    };
  } catch (e) {
    console.warn('notification failed', e);
  }
}

function check() {
  const now = Date.now();
  let changed = false;
  for (const a of state.alarms) {
    if (!a.enabled || !a.nextAt || a.nextAt > now) continue;
    // 앱이 닫혀 있던 동안 지나간 알림은 늦게 울리지 않는다.
    if (now - a.nextAt < 2 * 60e3) fire(a);
    if (a.repeat === 'once') {
      a.enabled = false;
      a.nextAt = null;
    } else {
      a.nextAt = nextFire(a, now + 1000);
    }
    changed = true;
  }
  if (changed) {
    try { saveAlarm(state.alarms[0]); } catch { saveQuiet(); }
  }
}

export function startAlarms() {
  // 다시 켜졌을 때 예약이 비어 있는 켜진 알림을 바로잡는다.
  for (const a of state.alarms) if (a.enabled && !a.nextAt) a.nextAt = nextFire(a);
  check();
  setInterval(check, 5000);
  document.addEventListener('visibilitychange', check);
}
