// S-03 설정 · S-12 데이터 출처 정보
// 설정은 권한을 묻지 않고, 외부 조회도 하지 않아서 오프라인에서도 그대로 열린다.
import { h, btn, toast } from '../ui.js';
import { DIRECT, NATIVE, getKeys, setKeys } from '../direct.js';
import { clockInfo } from '../clock.js';
import { icon } from '../icons.js';
import { state, homeRegion, regionLabel } from '../store.js';
import { go, page, APP_VERSION, config, render } from '../app.js';
import { notificationSupport } from '../alarms.js';
import { postJSON } from '../net.js';
import { prefs, setTheme, setLang } from '../i18n.js';

// 시계가 인터넷 표준 시각과 얼마나 맞는지
function clockText() {
  const c = clockInfo();
  const en = prefs.lang === 'en';
  if (!c.at || c.source === 'device') return en ? "Not checked yet · using this device's clock" : '아직 확인 못 했어요 · 기기 시계를 써요';
  const sec = Math.abs(c.offset / 1000).toFixed(1);
  if (!c.applied) return en ? `This device's clock is accurate (within ${sec}s)` : `기기 시계가 정확해요 (차이 ${sec}초)`;
  const slow = c.offset > 0;
  return en ? `This device's clock is ${sec}s ${slow ? 'slow' : 'fast'} · showing the corrected time` : `기기 시계가 ${sec}초 ${slow ? '느려서' : '빨라서'} 고친 시각을 보여 줘요`;
}

// 작은 선택 버튼 묶음 (화면 모드·언어)
function segment(options, value, onPick, label) {
  return h('div.seg', { role: 'radiogroup', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', role: 'radio', 'aria-checked': v === value ? 'true' : 'false', dataset: { fkey: `seg-${label}-${v}` }, onclick: () => v !== value && onPick(v) }, text)));
}

function entry({ iconName, title, desc, value, badge, onClick, fkey }) {
  return h(
    'button.item',
    { type: 'button', onclick: onClick, dataset: { fkey } },
    h('span.kind-badge', icon(iconName, 'icon-sm')),
    h('div.grow', h('div.title', title), desc ? h('div.desc', desc) : null),
    badge || null,
    value != null ? h('span.value', value) : null,
    h('span.chev', icon('chevron')),
  );
}

const count = (n) => (n ? `${n}개` : '없음');

const KEY_ROWS = [
  { type: 'weather', title: '날씨', key: '날씨 줄 · 기상청_단기예보 조회서비스' },
  { type: 'bus', title: '버스 도착 (서울·경기)', key: '서울 버스 · 경기 버스 · 경기 정류장 줄' },
  { type: 'subway', title: '지하철 도착·운행', key: '지하철 줄 (시간표) · 실시간은 SEOUL_OPENAPI_KEY (선택)' },
  { type: 'route', title: '경로 소요 시간', key: 'ODSAY_KEY (선택 · 없으면 데모)' },
  { type: 'signal', title: '신호등', key: '신호등 줄 · 서울은 TDATA_KEY (선택)' },
  { type: 'regions', title: '지역·장소 검색', key: '카카오 줄 (선택)' },
];
const PROVIDER_TAG = { realtime: ['ok', '실시간'], schedule: ['warn', '시간표 기준'], tdata: ['ok', '실제 데이터'], datagokr: ['ok', '공공데이터포털'], live: ['ok', '실제 데이터'], demo: ['warn', '데모 데이터'] };

// 모바일 웹: 키를 이 브라우저에 저장하는 입력칸
function mobileKeys() {
  const k = getKeys();
  const dataKey = h('input.input', { id: 'k-data', value: k.DATA_GO_KR_KEY || '', autocomplete: 'off', spellcheck: 'false' });
  const kakaoKey = h('input.input', { id: 'k-kakao', value: k.KAKAO_REST_KEY || '', autocomplete: 'off', spellcheck: 'false' });
  return h(
    'div.card.stack',
    h('p.small.muted', NATIVE ? '키를 넣으면 실제 날씨·서울·경기 버스·지하철 시간표·신호등 정보가 보여요. 키는 이 휴대폰 앱에만 저장되고 어디에도 보내지 않아요 (각 기관에 조회할 때만 써요).' : '키를 넣으면 실제 날씨·경기 버스·지하철 시간표·신호등 정보가 보여요. 키는 이 휴대폰 브라우저에만 저장되고 어디에도 보내지 않아요 (각 기관에 조회할 때만 써요).'),
    h('div.field', h('label', { for: 'k-data' }, '공공데이터포털 키 (필수)'), dataKey),
    h('div.field', h('label', { for: 'k-kakao' }, '카카오 REST API 키 (선택)'), kakaoKey),
    h('div.footer-actions', btn('키 저장', { kind: 'primary', iconName: 'key', onClick: () => {
      setKeys({ DATA_GO_KR_KEY: dataKey.value.trim().split(/[\s,;]+/)[0], KAKAO_REST_KEY: kakaoKey.value.trim() });
      toast('키를 저장했어요.');
      location.reload();
    } })),
  );
}

export function settingsView({ query }) {
  const region = homeRegion();
  const unavailableCount = state.targets.filter((t) => state.unavailable[t.id]).length;
  const notif = notificationSupport();
  const keysGroup = h(
    'div.group',
    { id: 'keys' },
    KEY_ROWS.map((r) =>
      h(
        'div.item',
        h('div.grow', h('div.title', r.title), h('div.desc', r.key)),
        config.loaded
          ? (() => { const [cls, text] = PROVIDER_TAG[config.providers?.[r.type] || config.modes[r.type]] || PROVIDER_TAG.demo; return h(`span.tag.${cls}`, text); })()
          : h('span.tag', '확인 불가'),
      ),
    ),
    h(
      'div.item',
      h('div.grow', h('div.desc', 'API_KEYS.bat 파일에 키를 넣고 저장하면 바로 실제 데이터로 바뀌어요. 키가 없는 항목은 데모 데이터를 보여 줘요.')),
      btn('키 파일 열기', { small: true, iconName: 'key', onClick: () => postJSON('/api/open-keys', {}).catch(() => null) }),
    ),
  );
  const el = page(
    '설정',
    { fallback: '/home', onBack: () => go('/home', { replace: false }) },
    h(
      'div.group',
      entry({ iconName: 'sun', title: '지역', desc: region ? `홈 표시: ${regionLabel(region)}` : '지역 없음', value: count(state.regions.length), onClick: () => go('/settings/weather-regions'), fkey: 's-wx' }),
      entry({ iconName: 'bus', title: '교통 확인 대상', desc: '정류장·역·경로·신호등', value: count(state.targets.length), badge: unavailableCount ? h('span.tag.warn', `조회 불가 ${unavailableCount}`) : null, onClick: () => go('/settings/transit-targets'), fkey: 's-tr' }),
      entry({ iconName: 'bell', title: '출발 알림', desc: notif === 'denied' ? '알림이 꺼져 있어 표시되지 않아요' : '정한 시각에 알림', value: count(state.alarms.length), badge: notif === 'denied' ? h('span.tag.warn', '알림 꺼짐') : null, onClick: () => go('/settings/alarms'), fkey: 's-al' }),
    ),
    h(
      'div.group',
      entry({ iconName: 'message', title: '피드백 보내기', desc: '불편한 점이나 바라는 점을 알려 주세요', onClick: () => go('/settings/feedback'), fkey: 's-fb' }),
      entry({ iconName: 'database', title: '데이터 출처 정보', desc: '날씨·버스·지하철·경로·신호 정보를 주는 곳', onClick: () => go('/settings/sources'), fkey: 's-src' }),
    ),
    h('h2.section-title', '화면'),
    h(
      'div.group',
      h('div.item', icon('sun'), h('div.grow', h('div.title', '화면 모드')),
        segment([['system', '시스템'], ['light', '라이트'], ['dark', '다크']], prefs.theme, (v) => { setTheme(v); render(); }, '화면 모드')),
      h('div.item', icon('message'), h('div.grow', h('div.title', '언어')),
        segment([['ko', '한국어'], ['en', 'English']], prefs.lang, (v) => { setLang(v); render(); }, '언어')),
    ),
    DIRECT ? h('h2.section-title', 'API 키 (이 휴대폰에만 저장)') : h('h2.section-title', 'API 키 상태 (Windows 버전)'),
    DIRECT ? mobileKeys() : keysGroup,
    h('div.group', h('div.item', h('div.grow', h('div.title', '시간 맞추기'), h('div.desc', clockText())))),
    h('div.group', h('div.item', h('div.grow', h('div.title', '앱 정보'), h('div.desc', '설정은 이 PC에만 저장돼요. 로그인은 필요 없어요.')), h('span.value', `버전 ${APP_VERSION}`))),
  );
  return {
    el,
    mounted() {
      if (query.keys) keysGroup.scrollIntoView({ block: 'center' });
    },
  };
}

// 출처 표기는 앱 안에 들어 있는 정보라 오프라인에서도 열린다.
export const SOURCES = [
  { kind: '날씨', org: '기상청', api: '단기예보 조회서비스 (초단기실황·초단기예보)', note: '출처: 기상청, 공공데이터포털(data.go.kr)' },
  { kind: '버스 도착', org: '서울특별시', api: '정류소정보조회 서비스 (버스 도착정보)', note: '출처: 서울특별시, 공공데이터포털(data.go.kr)' },
  { kind: '버스 도착 (경기)', org: '경기도', api: '버스도착정보·정류소 조회 서비스', note: '출처: 경기도, 공공데이터포털(data.go.kr)' },
  { kind: '지하철 도착·운행 현황', org: '서울특별시', api: '실시간 지하철 도착정보', note: '출처: 서울 열린데이터광장(data.seoul.go.kr). 운행 현황은 실시간 도착 메시지를 바탕으로 보여 줘요.' },
  { kind: '지하철 시간표', org: '국토교통부', api: 'TAGO 지하철정보', note: '출처: 국토교통부, 공공데이터포털(data.go.kr). 서울 열린데이터광장 키가 없을 때 시간표 기준으로 보여 줘요.' },
  { kind: '경로 소요 시간', org: 'ODsay LAB', api: '대중교통 길찾기 API', note: 'Powered by ODsay' },
  { kind: '신호 정보', org: '행정안전부 한국지역정보개발원', api: '교통안전 신호등 실시간 정보', note: '출처: 공공데이터포털(data.go.kr). 실시간 신호를 제공하지 않는 교차로는 "신호 정보 제공 안 됨"으로 보여요.' },
  { kind: '신호 정보 (서울)', org: '서울특별시', api: '교통빅데이터플랫폼 T-data V2X 신호 정보', note: '출처: 서울 교통빅데이터플랫폼(t-data.seoul.go.kr)' },
  { kind: '지역·장소 검색', org: '카카오', api: '카카오 로컬 API', note: '출처: Kakao' },
];

export function sourcesView() {
  const el = page(
    '데이터 출처 정보',
    {},
    h('div.notice', icon('info'), h('div.grow', '앱에 보이는 날씨·교통 정보는 아래 기관의 데이터예요. 실제 상황과 차이가 있을 수 있으니, 홈의 각 항목에 적힌 갱신 시각을 함께 확인해 주세요.')),
    h(
      'div.group',
      SOURCES.map((s) =>
        h(
          'div.item',
          { style: { alignItems: 'flex-start', paddingTop: '14px', paddingBottom: '14px' } },
          h('div.grow.stack', { style: { gap: '2px' } }, h('div.title', s.kind), h('div.desc', s.org, ' · ', s.api), h('div.small.faint', s.note)),
        ),
      ),
    ),
    h('p.small.faint', 'API 키가 없는 항목은 데모 데이터로 보여 주며, 그때 홈의 출처에는 "데모 데이터"라고 적혀요.'),
  );
  return { el };
}
