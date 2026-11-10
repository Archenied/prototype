// 위치 권한 목적 안내와 위치 가져오기 (R-20, S-14)
// '현재 위치 사용'이나 '주변 찾기'를 누를 때만 요청한다. 앱을 열기만 해서는 절대 묻지 않는다.
import { h, dialog, btn } from './ui.js';
import { icon } from './icons.js';
import { postJSON } from './net.js';

export async function permissionState() {
  if (!('geolocation' in navigator)) return 'unsupported';
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state; // granted · denied · prompt
  } catch {
    return 'prompt';
  }
}

export function openWindowsSettings(target) {
  return postJSON('/api/open-settings', { target }).catch(() => null);
}

const PURPOSE = {
  weather: '현재 지역의 날씨를 보여 주기 위해 위치를 한 번 확인해요.',
  nearby: '주변 정류장·역·신호등을 찾기 위해 위치를 한 번 확인해요.',
};

// 화면에 띄우는 권한 거부 안내 (같은 화면에서 직접 검색으로 이어짐)
export function deniedNotice({ onSearch } = {}) {
  return h(
    'div.notice.warn',
    { role: 'alert' },
    icon('location'),
    h(
      'div.grow',
      h('strong', '위치를 쓸 수 없어요.'),
      h('div.small', '아래 검색창에서 직접 찾을 수 있어요. 위치를 다시 쓰려면 Windows 위치 설정을 켜거나, 앱 창 오른쪽 위 ⋯ 메뉴 → 사이트 권한에서 위치를 허용해 주세요.'),
      h(
        'div.actions',
        btn('Windows 위치 설정 열기', { small: true, iconName: 'external', onClick: () => openWindowsSettings('location') }),
        onSearch ? btn('직접 검색하기', { small: true, kind: 'primary', iconName: 'search', onClick: onSearch }) : null,
      ),
    ),
  );
}

function getPosition(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120000 });
  });
}

// 반환: {status:'ok', lat, lon, coarse} | {status:'denied'} | {status:'error', reason} | {status:'cancel'} | {status:'search'}
export async function requestLocation(purpose) {
  const perm = await permissionState();
  if (perm === 'unsupported') return { status: 'error', reason: 'unsupported' };
  if (perm === 'denied') return { status: 'denied' };
  if (perm === 'prompt') {
    // 목적을 한 문장으로 먼저 알린 뒤 브라우저(Windows) 권한 요청을 띄운다.
    const choice = await new Promise((resolve) => {
      dialog({
        title: '위치 사용',
        body: h('div.stack', h('p', PURPOSE[purpose]), h('p.small.faint', '정확한 위치는 이 PC 안에서만 쓰고, 서버·지표·피드백 어디에도 남기지 않아요.')),
        onClose: (v) => resolve(v || 'cancel'),
        actions: [
          { label: '직접 검색', value: 'search' },
          { label: '계속', value: 'go', kind: 'primary' },
        ],
      });
    });
    if (choice !== 'go') return { status: choice === 'search' ? 'search' : 'cancel' };
  }
  // 위치 확인 중 표시 (취소하면 직접 검색으로)
  let cancelled = false;
  const waiting = dialog({
    title: '위치 확인 중',
    body: h('div.row', h('span.spinner'), '현재 위치를 가져오고 있어요…'),
    onClose: (v) => { if (v !== 'done') cancelled = true; },
    actions: [{ label: '취소', value: 'cancel' }],
  });
  try {
    const pos = await getPosition();
    if (cancelled) return { status: 'cancel' };
    waiting.close('done');
    return { status: 'ok', lat: pos.coords.latitude, lon: pos.coords.longitude, coarse: pos.coords.accuracy > 2000 };
  } catch (err) {
    if (cancelled) return { status: 'cancel' };
    waiting.close('done');
    if (err.code === 1) return { status: 'denied' };
    return { status: 'error', reason: err.code === 3 ? 'timeout' : 'unavailable' };
  }
}

// 홈의 '현재 위치' 날씨처럼 조용히 위치가 필요한 곳: 이미 허용된 경우에만 가져온다.
export async function silentLocation() {
  const perm = await permissionState();
  if (perm !== 'granted') {
    const e = new Error('location');
    e.locationError = perm === 'denied' ? 'denied' : 'needsPermission';
    throw e;
  }
  try {
    const pos = await getPosition(10000);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch (err) {
    const e = new Error('location');
    e.locationError = err.code === 1 ? 'denied' : 'unavailable';
    throw e;
  }
}

// 서버로는 날씨 조회에 충분한 정도(약 1km)로만 줄여서 보낸다.
export const coarse = (v, digits = 2) => Number(v).toFixed(digits);
