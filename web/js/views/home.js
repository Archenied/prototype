// S-02 홈 화면
// 상단: 시각·날씨·교통 요약 (항상 보임) / 아래: 세분화된 상세 탭 (날씨·교통 전체·버스·지하철·경로·신호등)
// 각 탭 상세는 스크롤 없이 한 화면에 들어오게 하고, 넘치면 페이지로 나눈다.
import { h, swap, btn, iconBtn, fmtClock, fmtDate, fmtTime, ago, etaText, toast, dialog } from '../ui.js';
import { icon, KIND_ICON, WX_ICON } from '../icons.js';
import { state, homeRegion, regionLabel, targetLabel, saveQuiet, onChange, setHomeRegion } from '../store.js';
import { register, setActive, view, request, refreshActive, subscribe, POLICY, isRecovering, onRecovering } from '../data.js';
import { net, errorText, getJSON } from '../net.js';
import { silentLocation, coarse, openWindowsSettings } from '../location.js';
import { go, config } from '../app.js';
import { track } from '../metrics.js';
import { t } from '../i18n.js';
import { now as clockNow, nowDate } from '../clock.js';
import { weatherMore, windText, keepOuterScroll } from './weather.js';

const TYPE_NAME = { bus: '버스', subway: '지하철', route: '경로', signal: '신호등' };
const KIND_NAME = { bus: '버스 정류장', subway: '지하철역', route: '경로', signal: '신호등' };
const LINE_COLOR = {
  '1호선': '#0052a4', '2호선': '#00a84d', '3호선': '#ef7c1c', '4호선': '#00a5de', '5호선': '#996cac', '6호선': '#cd7c2f', '7호선': '#747f00', '8호선': '#e6186c', '9호선': '#bdb092',
  신분당선: '#d4003b', 수인분당선: '#f5a200', 경의중앙선: '#77c4a3', 공항철도: '#0090d2', 경춘선: '#0c8e72', 경강선: '#003da5', 'GTX-A': '#9a6292', 우이신설선: '#b0ce18', 서해선: '#81a914',
};

let launchMetricsDone = { clock: false, weather: false, transit: false };

/* ───────── 데이터 등록 ───────── */
function weatherKey(region) {
  return region.kind === 'current' ? 'weather:current' : `weather:${region.id}`;
}
const detailKey = (region) => 'wxd:' + weatherKey(region);

function registerAll() {
  const keys = [];
  const region = homeRegion();
  if (region) {
    const key = weatherKey(region);
    if (region.kind === 'current') {
      register({
        key, type: 'weather', metricType: 'weather',
        fetch: async () => {
          const pos = await silentLocation();
          const lat = coarse(pos.lat), lon = coarse(pos.lon);
          const [wx, place] = await Promise.all([
            getJSON(`/api/weather?lat=${lat}&lon=${lon}`),
            getJSON(`/api/regions/reverse?lat=${coarse(pos.lat, 3)}&lon=${coarse(pos.lon, 3)}`).catch(() => null),
          ]);
          return { ...wx, data: { ...wx.data, placeName: place?.data?.name || '' } };
        },
      });
    } else {
      register({ key, type: 'weather', metricType: 'weather', url: () => `/api/weather?lat=${coarse(region.lat)}&lon=${coarse(region.lon)}` });
    }
    keys.push(key);
    // 날씨 자세히 (7일·기압·구름·안개·대기질 등)
    const dk = detailKey(region);
    if (region.kind === 'current') {
      register({ key: dk, type: 'weatherDetail', metricType: 'weather', fetch: async () => { const pos = await silentLocation(); return getJSON(`/api/weather/detail?lat=${coarse(pos.lat)}&lon=${coarse(pos.lon)}`); } });
    } else {
      register({ key: dk, type: 'weatherDetail', metricType: 'weather', url: () => `/api/weather/detail?lat=${coarse(region.lat)}&lon=${coarse(region.lon)}` });
    }
    keys.push(dk);
  }
  for (const t of state.targets) {
    const key = `t:${t.id}`;
    if (t.type === 'bus') register({ key, type: 'bus', metricType: 'bus', targetId: t.id, url: () => (t.ref.ggStationId ? `/api/transit/bus?gg=${encodeURIComponent(t.ref.ggStationId)}` : `/api/transit/bus?arsId=${encodeURIComponent(t.ref.arsId)}`) });
    if (t.type === 'subway') {
      register({ key, type: 'subway', metricType: 'subway', targetId: t.id, url: () => `/api/transit/subway?station=${encodeURIComponent(t.ref.station)}` });
      register({ key: `ts:${t.id}`, type: 'subwayStatus', metricType: 'subway', url: () => `/api/transit/subway-status?station=${encodeURIComponent(t.ref.station)}` });
      keys.push(`ts:${t.id}`);
    }
    if (t.type === 'route') {
      const o = t.ref.origin, d = t.ref.dest;
      register({ key, type: 'route', metricType: 'route', targetId: t.id, url: () => `/api/transit/route?sx=${o.lon}&sy=${o.lat}&ex=${d.lon}&ey=${d.lat}` });
    }
    if (t.type === 'signal') register({ key, type: 'signal', metricType: 'signal', targetId: t.id, url: () => `/api/transit/signal?id=${encodeURIComponent(t.ref.signalId)}` });
    keys.push(key);
  }
  setActive(keys);
  return keys;
}

/* ───────── 공통 상태 표시 ───────── */
function isUnavailable(t, v) {
  return v.error?.kind === 'notfound' || !!state.unavailable[t.id];
}

// 신호 정보는 시간이 지나면 의미가 없어서, 오프라인·오류·오래된 캐시는 보여 주지 않는다.
function usable(type, v) {
  if (!v.data) return false;
  if (type === 'signal') return net.online && !v.error && Date.now() - v.updatedAt < 20e3;
  return true;
}

function chips(type, v) {
  const out = [];
  const hasData = usable(type, v);
  if (v.loading && hasData) out.push(h('span.chip.loading', h('span.spinner'), '새로 고치는 중'));
  if (!net.online && hasData) out.push(h('span.chip.offline', icon('wifiOff', 'icon-sm'), '오프라인 · 마지막 정보'));
  else if (hasData && !v.loading && Date.now() - v.updatedAt > POLICY[type].interval * 3) out.push(h('span.chip.stale', icon('clock', 'icon-sm'), '오래된 정보'));
  return out;
}

function meta(v) {
  if (!v.updatedAt) return null;
  return h(
    'div.meta',
    h('span', '갱신 ', h('span.tnum', fmtTime(v.updatedAt)), ' · ', h('span', { 'data-ago': v.updatedAt }, ago(v.updatedAt))),
    // 날씨는 기상청이 몇 시에 관측한 값인지 따로 보여 준다 (자주 새로 받아도 관측은 1시간마다 바뀜)
    v.data?.observedAt && v.mode !== 'demo' ? h('span', '기상청 ', h('span.tnum', fmtTime(v.data.observedAt)), ' 관측') : null,
    v.source ? h('span.src', v.source) : null,
  );
}

function errorNotice(key, v, { compact } = {}) {
  if (!v.error || !net.online || v.error.kind === 'offline' || v.error.kind === 'notfound' || v.error.kind === 'location') return null;
  return h(
    'div.notice.error',
    { role: 'alert' },
    icon('alert'),
    h(
      'div.grow',
      h('div', errorText(v.error.kind, v.error.detail)),
      compact ? null : h('div.small.muted', v.data ? '아래는 마지막으로 받은 정보예요.' : ''),
      h('div.actions', btn('다시 시도', { small: true, iconName: 'refresh', busy: v.loading, fkey: `retry-${key}`, onClick: () => request(key) })),
    ),
  );
}

function offlineNotice(text = '오프라인이라 정보를 불러올 수 없어요. 연결되면 자동으로 다시 불러와요.') {
  return h('div.notice.offline', icon('wifiOff'), h('div.grow', text));
}

function loadingBlock(lines = 3) {
  return h(
    'div.stack',
    { 'aria-busy': 'true' },
    h('div.row.small.muted', h('span.spinner'), '불러오는 중'),
    ...Array.from({ length: lines }, (_, i) => h('div.skeleton', { style: { height: '18px', width: `${90 - i * 15}%` } })),
  );
}

/* ───────── 교통 항목 내용 ───────── */
function futureArrivals(arrivals, now = clockNow()) {
  return (arrivals || []).filter((a) => a.arriveAt > now - 20e3);
}

function busBody(data, max = 4) {
  if (data.state === 'none') return h('div.notice', icon('info'), '도착 예정 버스 없음');
  const byRoute = new Map();
  for (const a of futureArrivals(data.arrivals)) {
    if (!byRoute.has(a.route)) byRoute.set(a.route, []);
    byRoute.get(a.route).push(a);
  }
  if (!byRoute.size) return h('div.notice', icon('clock'), '표시할 도착 정보가 없어요. (받은 정보의 도착 시간이 모두 지났어요)');
  const rows = [...byRoute.entries()].sort((a, b) => a[1][0].arriveAt - b[1][0].arriveAt).slice(0, max);
  return h(
    'ul.arr-list',
    rows.map(([route, list]) =>
      h(
        'li.arr-row',
        h('span.route-no', route),
        h('span.eta', { 'data-arrive': list[0].arriveAt }, etaText(list[0].arriveAt)),
        list[0].stopsLeft ? h('span.small.faint', `${list[0].stopsLeft}정류장 전`) : null,
        h('span.grow'),
        list[1] ? h('span.eta-2', '다음 ', h('span', { 'data-arrive': list[1].arriveAt }, etaText(list[1].arriveAt))) : null,
      ),
    ),
  );
}

function statusFor(statusView, line) {
  if (!statusView) return null;
  return statusView.lines?.find((l) => l.line === line) || null;
}

function subwayBody(t, data, sv, maxRows = 4) {
  const statusV = view(`ts:${t.id}`);
  const statusFailed = statusV.error && statusV.error.kind !== 'offline' && net.online;
  const items = [];
  // 공공데이터포털 키만 있을 때는 실시간이 아니라 시간표로 계산한 값이다.
  if (data.basis === 'schedule') items.push(h('div.small', { style: { color: 'var(--warn)', fontWeight: 650, marginBottom: '4px' } }, icon('clock', 'icon-sm'), ' 시간표 기준 · 실시간 도착 정보가 아니에요'));
  if (data.state === 'none') items.push(h('div.notice', icon('info'), '도착 예정 열차 없음'));
  let rows = 0;
  const lines = data.lines || [];
  for (const [li, l] of lines.entries()) {
    if (rows >= maxRows) {
      // 칸이 모자라면 남은 호선은 이름만 모아 보여 준다 (지연이 있으면 함께 표시)
      const rest = lines.slice(li);
      const delayed = rest.filter((x) => (statusFor(sv, x.line)?.status || 'normal') !== 'normal').map((x) => x.line);
      items.push(h('div.small.faint', { style: { marginTop: '6px' } }, `외 ${rest.map((x) => x.line).join('·')}`, delayed.length ? h('span', { style: { color: 'var(--warn)', fontWeight: 700 } }, ` (${delayed.join('·')} 지연)`) : null));
      break;
    }
    const st = statusFor(sv, l.line);
    const lineHead = h(
      'div.row',
      { style: { marginTop: items.length ? '6px' : '0' } },
      h('span.line-tag', { style: { background: LINE_COLOR[l.line] || '#6b7280' } }, l.line),
      st && st.status !== 'normal'
        ? h(`span.status-line.${st.status}`, icon('alert', 'icon-sm'), st.status === 'delay' ? '지연' : '운행 중단', h('span.small', { style: { fontWeight: 500 } }, ' ', st.message))
        : st ? h('span.status-line.normal', icon('check', 'icon-sm'), '정상 운행') : null,
    );
    items.push(lineHead);
    const dirs = (l.directions || []).filter((d) => futureArrivals(d.trains).length);
    for (const d of dirs) {
      if (rows >= maxRows) break;
      const tr = futureArrivals(d.trains);
      items.push(
        h(
          'div.arr-row',
          h('span.grow.ellipsis', d.dir),
          h('span.eta', { 'data-arrive': tr[0].arriveAt }, etaText(tr[0].arriveAt)),
          tr[1] ? h('span.eta-2', '다음 ', h('span', { 'data-arrive': tr[1].arriveAt }, etaText(tr[1].arriveAt))) : null,
        ),
      );
      rows++;
    }
    if (data.state !== 'none' && !dirs.length) items.push(h('div.small.faint', '표시할 도착 정보가 없어요.'));
  }
  // 도착 정보는 받았고 운행 현황만 실패한 경우: 그 부분에만 안내 (F-05-AC-03)
  if (statusFailed) {
    items.push(
      h('div.notice.warn', { style: { marginTop: '8px', padding: '8px 12px' } }, icon('alert', 'icon-sm'),
        h('div.grow.small', '운행 현황을 확인할 수 없어요.'),
        btn('다시 시도', { small: true, busy: statusV.loading, fkey: `retry-ts-${t.id}`, onClick: () => request(`ts:${t.id}`) })),
    );
  }
  return h('div', ...items);
}

function routeBody(t, data) {
  if (data.state === 'none') return h('div.notice', icon('info'), '현재 이용 가능한 경로 없음');
  return h(
    'div.stack',
    h('div.big-value', data.minutes, h('small', '분')),
    h('div.small.muted', '대중교통 예상 소요 시간', data.transfers ? ` · 환승 ${data.transfers}회` : ' · 환승 없음', data.walkMinutes ? ` · 걷기 약 ${data.walkMinutes}분` : ''),
  );
}

function signalBody(data, at) {
  if (data.state === 'unsupported') return h('div.notice', icon('info'), '신호 정보 제공 안 됨');
  return h(
    'div',
    data.phases.map((p) =>
      h(
        'div.sig-row',
        h(`span.sig-light.${p.color}`, icon(p.color === 'green' ? 'walk' : 'ban', 'icon-sm')),
        h('div.grow', h('div', { style: { fontWeight: 650 } }, p.dir), h('div.small.muted', p.color === 'green' ? '보행 신호 (초록)' : p.color === 'red' ? '정지 신호 (빨강)' : p.color === 'yellow' ? '곧 바뀜 (주의)' : '신호 상태 확인 중')),
        h('span.sig-remain', { 'data-sig-end': at + p.remainSec * 1000 }, `${p.remainSec}초`),
      ),
    ),
  );
}

function targetCard(t, { compact = false } = {}) {
  const key = `t:${t.id}`;
  const v = view(key);
  const unavailable = isUnavailable(t, v);
  const showData = !unavailable && usable(t.type, v);
  let body;
  if (unavailable) {
    body = h(
      'div.notice.warn',
      icon('alert'),
      h('div.grow', h('strong', '조회 불가'), h('div.small', '외부 데이터에서 더 이상 조회되지 않아요. 교통 대상 관리에서 수정하거나 삭제해 주세요.'),
        h('div.actions', btn('교통 대상 관리로 이동', { small: true, iconName: 'chevron', fkey: `unavail-${t.id}`, onClick: () => go(`/settings/transit-targets?focus=${t.id}`) }))),
    );
  } else if (showData) {
    if (t.type === 'bus') body = busBody(v.data, compact ? 3 : 4);
    else if (t.type === 'subway') body = subwayBody(t, v.data, view(`ts:${t.id}`).data, compact ? 2 : 4);
    else if (t.type === 'route') body = routeBody(t, v.data);
    else body = signalBody(v.data, v.updatedAt);
  } else if (!net.online) {
    body = offlineNotice(t.type === 'signal' ? '신호 정보는 실시간이라 오프라인에서는 보여 주지 않아요. 연결되면 자동으로 다시 불러와요.' : undefined);
  } else if (v.loading || !v.error) {
    body = loadingBlock(t.type === 'route' ? 2 : 3);
  } else {
    body = null; // 오류 안내만 아래에 표시 (이전 값처럼 보이는 표시 없음)
  }
  const sub = t.type === 'route' ? `${t.ref.origin.name} → ${t.ref.dest.name}` : t.sub;
  return h(
    'article.card.dcard',
    { 'aria-label': `${KIND_NAME[t.type]} ${targetLabel(t)}`, 'aria-busy': v.loading ? 'true' : 'false' },
    h(
      'div.dcard-head',
      h(`span.kind-badge.${t.type}`, icon(KIND_ICON[t.type], 'icon-sm')),
      h('div.grow', h('div.dcard-name.ellipsis', targetLabel(t)), h('div.dcard-sub.ellipsis', KIND_NAME[t.type], sub ? ' · ' : '', sub || '')),
      ...chips(t.type, v),
    ),
    h('div.dcard-body', body, unavailable ? null : errorNotice(key, v, { compact })),
    showData ? meta(v) : null,
  );
}

/* ───────── 요약 영역 ───────── */
// 시:분:초 + 100분의 1초(.00). 숫자는 화면 갱신 때마다 제자리에서 바꾼다 (updateClockText).
function clockCard() {
  const now = nowDate();
  const { dayPeriod, time } = fmtClock(now, true);
  return h(
    'section.card.clock-card',
    { 'aria-label': '현재 시각' },
    h('div.card-title', icon('clock', 'icon-sm'), '현재 시각'),
    h('div.clock-time', { 'aria-live': 'off' },
      h('span.clock-ampm', { 'data-clock': 'ampm' }, dayPeriod),
      h('span', { 'data-clock': 'main' }, time),
      h('span.clock-cs', { 'data-clock': 'cs' }, '.' + String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0'))),
    h('div.clock-date', { 'data-clock': 'date' }, fmtDate(now)),
  );
}

function updateClockText(root) {
  const now = nowDate();
  const cs = root.querySelector('[data-clock="cs"]');
  if (!cs) return;
  cs.textContent = '.' + String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
  const { dayPeriod, time } = fmtClock(now, true);
  const main = root.querySelector('[data-clock="main"]');
  if (main.textContent !== time) {
    main.textContent = time;
    root.querySelector('[data-clock="ampm"]').textContent = dayPeriod;
    const date = fmtDate(now);
    const de = root.querySelector('[data-clock="date"]');
    if (de.textContent !== date) de.textContent = date;
  }
}

function weatherIcon(code, cls = 'wx-icon') {
  const el = icon(WX_ICON[code] || 'cloud', cls);
  return el;
}

function regionName(region, v) {
  if (region.kind === 'current') return v.data?.placeName ? `현재 위치 · ${v.data.placeName.split(' ').slice(-1)[0]}` : '현재 위치';
  return regionLabel(region);
}

function weatherLocationNotice(v) {
  if (v.error?.kind !== 'location') return null;
  const denied = v.error.detail === 'denied';
  return h(
    'div.notice.warn',
    icon('location'),
    h('div.grow',
      h('div', denied ? '위치를 쓸 수 없어 현재 위치 날씨를 볼 수 없어요.' : v.error.detail === 'needsPermission' ? '현재 위치 날씨를 보려면 위치 사용을 허용해야 해요.' : '현재 위치를 확인하지 못했어요.'),
      h('div.actions',
        btn('지역 관리', { small: true, fkey: 'wx-loc-manage', onClick: () => go('/settings/weather-regions?from=home') }),
        denied ? btn('Windows 위치 설정 열기', { small: true, iconName: 'external', onClick: () => openWindowsSettings('location') }) : btn('다시 시도', { small: true, iconName: 'refresh', busy: v.loading, onClick: () => request('weather:current', { force: true }) }))),
  );
}

// 홈에서 바로 지역 바꾸기: 저장한 지역 중 하나를 고르거나, 추가·관리 화면으로 간다.
function openRegionPicker() {
  const current = homeRegion();
  const list = h(
    'div.group',
    { role: 'radiogroup', 'aria-label': '지역' },
    state.regions.map((r) =>
      h(
        'button.item',
        { type: 'button', role: 'radio', 'aria-checked': r.id === current?.id ? 'true' : 'false', onclick: () => pick(r.id) },
        h(`span.radio-dot${r.id === current?.id ? '.on' : ''}`),
        h('div.grow', h('div.title', regionLabel(r)), r.label ? h('div.desc', r.name) : null),
      ),
    ),
  );
  const { close } = dialog({
    title: '지역',
    body: state.regions.length ? list : h('p', '저장한 지역이 없어요.'),
    actions: [
      { label: '지역 관리', onClick: (c) => { c(); go('/settings/weather-regions?from=home'); } },
      { label: '지역 추가', kind: 'primary', icon: 'plus', onClick: (c) => { c(); go('/settings/weather-regions/add'); } },
    ],
  });
  function pick(id) {
    close();
    if (id === current?.id) return;
    try {
      setHomeRegion(id);
      go('/home', { replace: true, force: true }); // 새 지역으로 홈을 다시 그리고 날씨를 새로 조회
    } catch { toast('이 PC에 저장하지 못했어요. 다시 시도해 주세요.'); }
  }
}

function weatherSummary() {
  const region = homeRegion();
  if (!region) {
    return h(
      'section.card',
      { 'aria-label': '날씨 요약' },
      h('div.card-title', icon('sun', 'icon-sm'), '날씨'),
      h('div.empty', { style: { marginTop: '10px' } }, h('p', '지역을 저장하면 여기에 날씨가 보여요.'), btn('지역 설정', { kind: 'primary', iconName: 'plus', small: true, fkey: 'wx-empty', onClick: () => go('/settings/weather-regions?from=home') })),
    );
  }
  const key = weatherKey(region);
  const v = view(key);
  let body;
  if (v.data) {
    body = h(
      'div.wx-sum',
      weatherIcon(v.data.code),
      h('div', h('div.wx-temp', `${Math.round(v.data.temp)}°`)),
      h('div.grow', h('div.wx-cond', v.data.text), h('div.wx-region.ellipsis', regionName(region, v)),
        h('div.small.muted.tnum', `습도 ${v.data.humidity}%`, v.data.pop != null ? ` · 강수확률 ${v.data.pop}%` : '')),
    );
  } else if (v.error?.kind === 'location') {
    body = h('div', { style: { marginTop: '10px' } }, weatherLocationNotice(v));
  } else if (!net.online) {
    body = h('div', { style: { marginTop: '10px' } }, offlineNotice());
  } else if (v.error) {
    body = null;
  } else {
    body = h('div', { style: { marginTop: '10px' } }, loadingBlock(2));
  }
  return h(
    'section.card',
    { 'aria-label': '날씨 요약', 'aria-busy': v.loading ? 'true' : 'false' },
    h('div.card-title', icon('sun', 'icon-sm'), h('span.grow', '날씨'), ...chips('weather', v),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', title: '지역 바꾸기', 'aria-label': '지역 바꾸기', style: { minHeight: '30px', padding: '0 8px', marginRight: '-8px' }, dataset: { fkey: 'region-switch' }, onclick: openRegionPicker }, icon('location', 'icon-sm'), '지역')),
    body,
    v.data && v.error?.kind === 'location' ? weatherLocationNotice(v) : null,
    errorNotice(key, v, { compact: true }),
    v.data ? meta(v) : null,
  );
}

function summaryValue(t) {
  const v = view(`t:${t.id}`);
  if (isUnavailable(t, v)) return h('span.tsum-val.bad', '조회 불가');
  if (!usable(t.type, v)) {
    if (!net.online) return h('span.tsum-val.neutral', icon('wifiOff', 'icon-sm'), ' 오프라인');
    if (v.loading || !v.error) return h('span.tsum-val.neutral', h('span.spinner', { style: { display: 'inline-block', verticalAlign: '-2px' } }), ' 불러오는 중');
    return h('span.tsum-val.bad', icon('alert', 'icon-sm'), ' 불러오지 못함');
  }
  const d = v.data;
  if (t.type === 'bus') {
    if (d.state === 'none') return h('span.tsum-val.neutral', '도착 예정 버스 없음');
    const arr = futureArrivals(d.arrivals).slice(0, 2);
    if (!arr.length) return h('span.tsum-val.neutral', '도착 정보 없음');
    return h('span.tsum-val', arr.map((a, i) => [i ? ' · ' : '', `${a.route} `, h('span', { 'data-arrive': a.arriveAt }, etaText(a.arriveAt))]));
  }
  if (t.type === 'subway') {
    if (d.state === 'none') return h('span.tsum-val.neutral', '도착 예정 열차 없음');
    const sv = view(`ts:${t.id}`).data;
    for (const l of d.lines || []) {
      for (const dir of l.directions || []) {
        const tr = futureArrivals(dir.trains)[0];
        if (tr) {
          const st = statusFor(sv, l.line);
          return h('span.tsum-val', st && st.status !== 'normal' ? h('span', { style: { color: 'var(--warn)' } }, icon('alert', 'icon-sm'), ' 지연 · ') : '', `${l.line} `, h('span', { 'data-arrive': tr.arriveAt }, etaText(tr.arriveAt)));
        }
      }
    }
    return h('span.tsum-val.neutral', '도착 정보 없음');
  }
  if (t.type === 'route') {
    if (d.state === 'none') return h('span.tsum-val.neutral', '이용 가능한 경로 없음');
    return h('span.tsum-val', `${d.minutes}분`);
  }
  if (d.state === 'unsupported') return h('span.tsum-val.neutral', '신호 정보 제공 안 됨');
  const p = d.phases[0];
  return h('span.tsum-val', { style: { color: p.color === 'green' ? 'var(--sig-green)' : 'var(--sig-red)' } }, p.color === 'green' ? '보행 초록 ' : '빨간불 ', h('span', { 'data-sig-end': v.updatedAt + p.remainSec * 1000 }, `${p.remainSec}초`));
}

function transitSummary(onPickType, maxRows) {
  const list = state.targets;
  if (!list.length) {
    return h(
      'section.card.transit-sum',
      { 'aria-label': '교통 요약' },
      h('div.card-title', icon('bus', 'icon-sm'), '교통'),
      h('div.empty', { style: { marginTop: '10px' } }, h('p', '정류장·역·경로·신호등을 저장하면 여기에 교통 정보가 보여요.'), btn('교통 대상 설정', { kind: 'primary', iconName: 'plus', small: true, fkey: 'tr-empty', onClick: () => go('/settings/transit-targets/new?from=home') })),
    );
  }
  const shown = list.slice(0, maxRows);
  const anyLoading = list.some((t) => view(`t:${t.id}`).loading);
  return h(
    'section.card.transit-sum',
    { 'aria-label': '교통 요약' },
    h('div.card-title', icon('bus', 'icon-sm'), h('span.grow', '교통'), anyLoading ? h('span.chip.loading', h('span.spinner'), '새로 고치는 중') : null, !net.online ? h('span.chip.offline', icon('wifiOff', 'icon-sm'), '오프라인') : null),
    h(
      'ul.tsum-list',
      shown.map((t) =>
        h(
          'li.tsum-row',
          h(`span.kind-badge.${t.type}`, icon(KIND_ICON[t.type], 'icon-sm')),
          h('button.tsum-name.ellipsis', { type: 'button', style: { background: 'none', border: 0, textAlign: 'left', padding: '6px 0', cursor: 'pointer', fontWeight: 600 }, title: `${TYPE_NAME[t.type]} 탭에서 자세히 보기`, dataset: { fkey: `sum-${t.id}` }, onclick: () => onPickType(t.type) }, targetLabel(t)),
          summaryValue(t),
        ),
      ),
    ),
    list.length > shown.length ? h('div.tsum-more', `외 ${list.length - shown.length}개 · 교통 탭에서 모두 보기`) : null,
  );
}

/* ───────── 상세 탭 ───────── */
function tabsFor() {
  const counts = { bus: 0, subway: 0, route: 0, signal: 0 };
  for (const t of state.targets) counts[t.type]++;
  const tabs = [{ id: 'weather', label: '날씨', icon: 'sun' }, { id: 'all', label: '교통 전체', icon: 'route', count: state.targets.length }];
  for (const type of ['bus', 'subway', 'route', 'signal']) if (counts[type]) tabs.push({ id: type, label: TYPE_NAME[type], icon: KIND_ICON[type], count: counts[type] });
  return tabs;
}

function weatherDetail() {
  const region = homeRegion();
  if (!region) {
    return h('div.card', { style: { height: '100%' } }, h('div.empty.center', icon('sun', 'icon-lg'), h('p', '지역이 없어요. 지역을 저장하면 날씨 상세가 여기에 보여요.'), btn('지역 설정', { kind: 'primary', iconName: 'plus', fkey: 'wxd-empty', onClick: () => go('/settings/weather-regions?from=home') })));
  }
  const key = weatherKey(region);
  const v = view(key);
  if (!v.data) {
    let inner;
    if (v.error?.kind === 'location') inner = weatherLocationNotice(v);
    else if (!net.online) inner = offlineNotice();
    else if (v.error) inner = errorNotice(key, v);
    else inner = loadingBlock(4);
    return h('div.card', { style: { height: '100%' } }, h('div.card-title', icon('sun', 'icon-sm'), regionName(region, v)), h('div', { style: { marginTop: '12px' } }, inner));
  }
  const d = v.data;
  const vd = view(detailKey(region));
  const n = vd.data?.now;
  return keepOuterScroll(h(
    'div.wx-detail',
    h(
      'section.card',
      { 'aria-label': '현재 날씨' },
      h('div.card-title', icon('location', 'icon-sm'), h('span.grow.ellipsis', regionName(region, v)), ...chips('weather', v)),
      h('div.wx-hero', { style: { marginTop: '10px' } }, weatherIcon(d.code), h('div', h('div.wx-temp', `${Math.round(d.temp)}°`), h('div.wx-cond', { style: { fontSize: '18px' } }, d.text))),
      h(
        'div.wx-stats',
        h('div.wx-stat', h('div.k', '강수확률'), h('div.v', d.pop != null ? `${d.pop}%` : '—')),
        h('div.wx-stat', h('div.k', '습도 (공기 속 물기)'), h('div.v', `${d.humidity}%`)),
        h('div.wx-stat', h('div.k', '바람'), h('div.v', `${d.wind}m/s`)),
        h('div.wx-stat', h('div.k', '1시간 강수'), h('div.v', d.rain1h ? `${d.rain1h}mm` : '없음')),
        n ? h('div.wx-stat', h('div.k', '체감온도'), h('div.v', `${Math.round(n.feels)}°`)) : null,
        n ? h('div.wx-stat', h('div.k', '기압'), h('div.v', `${Math.round(n.pres)} hPa`)) : null,
        n ? h('div.wx-stat.wide', h('div.k', '바람 방향'), h('div.v', windText(n.windDir))) : null,
      ),
      d.code === 'rain' || d.code === 'sleet' || d.code === 'snow' || d.hourly?.some((x) => x.code === 'rain' || x.code === 'snow' || x.code === 'sleet')
        ? h('div.notice.warn', { style: { marginTop: '12px' } }, icon('umbrella'), '비나 눈 소식이 있어요. 우산을 챙기세요.')
        : null,
      errorNotice(key, v),
      meta(v),
    ),
    weatherMore(vd, meta(vd)),
  ));
}

function transitDetail(tab, layout, pageIndex) {
  const list = tab === 'all' ? state.targets : state.targets.filter((t) => t.type === tab);
  if (!list.length) {
    const type = tab === 'all' ? '' : tab;
    return {
      el: h('div.card', { style: { height: '100%' } }, h('div.empty.center', icon('bus', 'icon-lg'),
        h('p', tab === 'all' ? '저장한 교통 대상이 없어요. 정류장·역·경로·신호등을 저장해 보세요.' : `저장한 ${TYPE_NAME[tab]} 대상이 없어요.`),
        btn('교통 대상 설정', { kind: 'primary', iconName: 'plus', fkey: 'trd-empty', onClick: () => go(type ? `/settings/transit/${type === 'route' ? 'add-route' : 'add?type=' + type}` : '/settings/transit-targets/new?from=home') }))),
      pages: 1,
    };
  }
  const per = layout.perPage;
  const pages = Math.max(1, Math.ceil(list.length / per));
  const pi = Math.min(pageIndex, pages - 1);
  const slice = layout.mobile ? list : list.slice(pi * per, pi * per + per);
  const grid = h('div.panel-grid', {
    style: layout.mobile
      ? { gridTemplateColumns: '1fr', height: 'auto' }
      : { gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` },
  }, slice.map((t) => targetCard(t, { compact: layout.rows > 1 })));
  return { el: grid, pages, page: pi };
}

/* ───────── 화면 ───────── */
export function homeView() {
  const keys = registerAll();
  let tab = state.lastTab || 'weather';
  if (!tabsFor().some((t) => t.id === tab)) tab = 'weather';
  let pageIndex = 0;
  let tabSwitchAt = null;
  const t0 = performance.now();

  const bannerSlot = h('div');
  const modeSlot = h('div.row');
  const refreshBtn = iconBtn('refresh', '새로고침 (F5)', () => manualRefresh(), { fkey: 'refresh' });
  const topbar = h(
    'header.topbar',
    h('div.brand', h('img', { src: 'icon.svg', alt: '' }), h('span', '프로토타입')),
    modeSlot,
    h('div.spacer'),
    refreshBtn,
    iconBtn('settings', '설정', () => go('/settings'), { fkey: 'settings' }),
  );
  const clockSlot = h('div', { style: { display: 'contents' } });
  const wxSlot = h('div', { style: { display: 'contents' } });
  const trSlot = h('div', { style: { display: 'contents' } });
  const summary = h('div.summary', clockSlot, wxSlot, trSlot);
  const tabsEl = h('div.tabs', { role: 'tablist', 'aria-label': '상세 정보' });
  const pagerSlot = h('div.pager');
  const panel = h('div.panel', { role: 'tabpanel', id: 'home-panel', tabindex: '-1' });
  const home = h('main.home', { 'aria-label': '홈' }, h('h1.sr-only', { 'data-page-title': '' }, '홈'), summary, h('div.tabs-row', tabsEl, pagerSlot), panel);
  const el = h('div', { style: { display: 'contents' } }, topbar, bannerSlot, home);

  function layout() {
    const mobile = window.innerWidth <= 760;
    const w = panel.clientWidth || 900;
    const hh = panel.clientHeight || 400;
    const cols = Math.max(1, Math.min(3, Math.floor((w + 14) / 330)));
    const rows = Math.max(1, Math.floor((hh + 14) / 214));
    return { mobile, cols, rows, perPage: cols * rows };
  }

  function summaryRows() {
    const hgt = window.innerHeight;
    return hgt > 900 ? 5 : hgt > 760 ? 4 : 3;
  }

  function renderBanner() {
    if (!net.online) {
      swap(bannerSlot, h('div.banner.offline', { role: 'status' }, icon('wifiOff'), '오프라인 상태예요. 보이는 정보는 마지막으로 받은 것이라 지금과 다를 수 있어요.'));
    } else if (isRecovering()) {
      swap(bannerSlot, h('div.banner.recovering', { role: 'status' }, h('span.spinner'), '다시 연결됐어요. 최신 정보를 불러오는 중이에요…'));
    } else swap(bannerSlot);
  }

  function renderMode() {
    // 사용자 요청(2026-11-10): 상단의 '데모 데이터' 표시는 없앤다. 데모인 항목은 각 카드의 출처에 그대로 적힌다.
    swap(modeSlot);
  }

  function renderSummary() {
    swap(clockSlot, clockCard());
    swap(wxSlot, weatherSummary());
    swap(trSlot, transitSummary(pickType, summaryRows()));
  }

  function pickType(type) {
    selectTab(type);
  }

  function renderTabs() {
    const tabs = tabsFor();
    swap(
      tabsEl,
      tabs.map((t) =>
        h(
          'button.tab',
          { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-selected': t.id === tab ? 'true' : 'false', 'aria-controls': 'home-panel', tabindex: t.id === tab ? '0' : '-1', dataset: { fkey: `tab-${t.id}` }, onclick: () => selectTab(t.id), onkeydown: (e) => tabKey(e, tabs) },
          icon(t.icon, 'icon-sm'),
          t.label,
          t.count != null ? h('span.count', t.count) : null,
        ),
      ),
    );
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
  }

  function tabKey(e, tabs) {
    const i = tabs.findIndex((t) => t.id === tab);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = tabs.length - 1;
    if (n !== null) {
      e.preventDefault();
      selectTab(tabs[n].id);
      tabsEl.querySelector(`#tab-${tabs[n].id}`)?.focus();
    }
  }

  function selectTab(id) {
    if (id === tab) return;
    tab = id;
    pageIndex = 0;
    tabSwitchAt = performance.now();
    state.lastTab = id;
    saveQuiet();
    renderTabs();
    renderPanel();
  }

  function renderPanel() {
    const lay = layout();
    let content;
    let pages = 1;
    if (tab === 'weather') content = weatherDetail();
    else {
      const r = transitDetail(tab, lay, pageIndex);
      content = r.el;
      pages = r.pages;
      pageIndex = r.page ?? 0;
    }
    swap(panel, content);
    swap(
      pagerSlot,
      pages > 1 && !lay.mobile
        ? [
            iconBtn('back', '이전 페이지', () => { pageIndex = Math.max(0, pageIndex - 1); renderPanel(); }, { disabled: pageIndex === 0, fkey: 'pg-prev' }),
            h('span.tnum', `${pageIndex + 1} / ${pages}`),
            iconBtn('chevron', '다음 페이지', () => { pageIndex = Math.min(pages - 1, pageIndex + 1); renderPanel(); }, { disabled: pageIndex >= pages - 1, fkey: 'pg-next' }),
          ]
        : null,
    );
    if (tabSwitchAt != null) {
      const ms = Math.round(performance.now() - tabSwitchAt);
      const hasData = tab === 'weather' ? !!(homeRegion() && view(weatherKey(homeRegion())).data) : true;
      track('tab_render', { tab, ms, from: hasData ? 'ready' : 'loading' });
      tabSwitchAt = null;
    }
  }

  function renderAll() {
    renderBanner();
    renderMode();
    renderSummary();
    renderTabs();
    renderPanel();
    refreshBtn.classList.toggle('is-spinning', keys.some((k) => view(k).loading));
    launchMetrics();
  }

  // M-01: 실행부터 영역별 표시까지 (앱을 연 뒤 첫 홈 화면에서 한 번만)
  function launchMetrics() {
    const since = Math.round(performance.now());
    if (!launchMetricsDone.clock) { launchMetricsDone.clock = true; track('render_complete', { area: 'clock', ms: since, from: 'device' }); }
    const region = homeRegion();
    if (!launchMetricsDone.weather && region) {
      const v = view(weatherKey(region));
      if (v.data) { launchMetricsDone.weather = true; track('render_complete', { area: 'weather', ms: since, from: v.loading ? 'cache' : 'fresh' }); }
    }
    if (!launchMetricsDone.transit && state.targets.length) {
      const all = state.targets.every((t) => usable(t.type, view(`t:${t.id}`)) || view(`t:${t.id}`).error);
      if (all) { launchMetricsDone.transit = true; track('render_complete', { area: 'transit', ms: since, from: 'mixed' }); }
    }
    void t0;
  }

  // 여러 변경을 한 번에 그린다. (requestAnimationFrame은 창이 최소화되면 멈춰서 타이머를 쓴다)
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = setTimeout(() => { raf = 0; renderAll(); }, 16);
  };

  async function manualRefresh() {
    if (!net.online) { toast('오프라인이에요. 연결되면 자동으로 다시 불러와요.'); return; }
    const before = keys.map((k) => view(k).updatedAt);
    await refreshActive();
    const after = keys.map((k) => view(k).updatedAt);
    if (before.every((b, i) => b === after[i]) && keys.length) toast('방금 받은 정보예요. 잠시 후 다시 불러올 수 있어요.');
  }

  // 1초마다 시각·카운트다운·'n분 전'만 제자리에서 고친다 (버튼 누르는 중에 화면이 바뀌지 않게)
  let lastMinute = nowDate().getMinutes();
  function tickText() {
    const now = clockNow();
    const m = new Date(now).getMinutes();
    if (m !== lastMinute) { lastMinute = m; swap(clockSlot, clockCard()); }
    updateClockText(clockSlot);
    for (const e of el.querySelectorAll('[data-arrive]')) e.textContent = etaText(Number(e.dataset.arrive), now);
    for (const e of el.querySelectorAll('[data-sig-end]')) {
      const s = Math.max(0, Math.round((Number(e.dataset.sigEnd) - now) / 1000));
      e.textContent = t(s > 0 ? `${s}초` : '곧 바뀜');
    }
    for (const e of el.querySelectorAll('[data-ago]')) e.textContent = ago(Number(e.dataset.ago), now);
  }

  const unsubs = [];
  let tickTimer, slowTimer, ro, clockRaf;

  function onKey(e) {
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
      manualRefresh();
    }
  }

  return {
    el,
    keepFocus: true,
    mounted() {
      renderAll();
      // 처음 열 때: 캐시는 이미 보이고, 영역마다 독립적으로 조회 시작
      for (const k of keys) request(k);
      unsubs.push(subscribe(schedule));
      unsubs.push(net.onChange(schedule));
      unsubs.push(onRecovering(schedule));
      unsubs.push(onChange((what) => { if (what === 'unavailable') schedule(); }));
      tickTimer = setInterval(tickText, 1000);
      // 시계의 초·100분의 1초는 화면이 그려질 때마다 갱신 (창이 숨겨지면 자동으로 멈춤)
      const frame = () => { updateClockText(clockSlot); clockRaf = requestAnimationFrame(frame); };
      clockRaf = requestAnimationFrame(frame);
      slowTimer = setInterval(schedule, 30000); // 지난 도착 시간 정리
      ro = new ResizeObserver(() => schedule());
      ro.observe(panel);
      document.addEventListener('keydown', onKey);
      // 화면으로 돌아오면 멈춰 있던 시각을 즉시 맞춘다 (F-02-AC-06)
      const onVis = () => { if (!document.hidden) { lastMinute = -1; tickText(); } };
      document.addEventListener('visibilitychange', onVis);
      unsubs.push(() => document.removeEventListener('visibilitychange', onVis));
      const focusStart = document.querySelector('.tab[aria-selected="true"]');
      if (focusStart && document.activeElement === document.body) focusStart.focus({ preventScroll: true });
    },
    unmount() {
      unsubs.forEach((u) => u());
      clearInterval(tickTimer);
      cancelAnimationFrame(clockRaf);
      clearInterval(slowTimer);
      ro?.disconnect();
      clearTimeout(raf);
      document.removeEventListener('keydown', onKey);
      setActive([]);
    },
  };
}
