// 오늘은 무슨 날? — 공휴일·대체공휴일·국경일·법정기념일·24절기·명절(음력)·삼복·세계의 날·○○데이
// 모두 이 기기 안에서 계산한다 (인터넷·API 키 필요 없음, 어느 해든 됨).
//  - 음력: 브라우저에 들어 있는 한국 음력(단기, Intl 'dangi') 달력으로 바꾼다
//  - 24절기: 태양의 위치(황경)를 천문 공식으로 계산 (분 단위 정확도 → 한국 시각 날짜)
//  - 삼복: 경(庚)일 계산, 대체공휴일: 2023년부터의 규칙
// 날짜 키는 'YYYY-MM-DD' (한국 날짜)

export const KIND = {
  holiday: { ko: '공휴일', en: 'Public holiday', red: true },
  sub: { ko: '대체공휴일', en: 'Substitute holiday', red: true },
  national: { ko: '국경일', en: 'National day' },
  legal: { ko: '기념일', en: 'Memorial day' },
  term: { ko: '절기', en: 'Solar term' },
  folk: { ko: '명절·세시', en: 'Traditional' },
  intl: { ko: '세계의 날', en: 'World day' },
  fun: { ko: '○○데이', en: 'Fun day' },
  mine: { ko: '내 일정', en: 'My event' },
};

/* ───────── 날짜 도우미 ───────── */
const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일
function nthWeekday(y, m, wd, n) { // n번째 wd요일 (n=-1: 마지막)
  if (n > 0) {
    const first = weekday(y, m, 1);
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((weekday(y, m, last) - wd + 7) % 7);
}
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), Y = y + 4800 - a, M = m + 12 * a - 3;
  return d + Math.floor((153 * M + 2) / 5) + 365 * Y + Math.floor(Y / 4) - Math.floor(Y / 100) + Math.floor(Y / 400) - 32045;
}
const isGyeong = (y, m, d) => (jdn(y, m, d) + 9) % 10 === 6; // 경(庚)일

/* ───────── 음력 (한국 음력 = 단기 달력) ───────── */
let lunarFmt = null;
function lunarFormatter() {
  if (lunarFmt) return lunarFmt;
  for (const cal of ['dangi', 'chinese']) {
    try {
      const f = new Intl.DateTimeFormat(`ko-KR-u-ca-${cal}`, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
      if (f.resolvedOptions().calendar === cal) { lunarFmt = f; return f; }
    } catch { /* 다음 */ }
  }
  lunarFmt = false;
  return false;
}
/** 양력 → 음력 {month, day, leap} (지원하지 않는 브라우저면 null) */
export function toLunar(y, m, d) {
  const f = lunarFormatter();
  if (!f) return null;
  const parts = f.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
  const mo = parts.find((p) => p.type === 'month')?.value || '';
  const da = parts.find((p) => p.type === 'day')?.value || '';
  return { month: parseInt(mo.replace(/\D/g, ''), 10), day: parseInt(da, 10), leap: /윤|bis|leap/i.test(mo) };
}

/* ───────── 24절기 (태양 황경) ───────── */
// Meeus, Astronomical Algorithms ch.25 (저정밀): 오차 약 0.01° ≈ 15분
function sunLongitude(jd) {
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI / 180;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * Math.PI / 180;
  const lon = L0 + C - 0.00569 - 0.00478 * Math.sin(omega);
  return ((lon % 360) + 360) % 360;
}
const TERMS = [ // 황경 0°부터 15°씩
  ['춘분', '낮과 밤의 길이가 같아져요. 이제부터 낮이 더 길어져요.'], ['청명', '하늘이 맑고 밝아져요. 봄 농사 준비를 해요.'], ['곡우', '봄비가 내려 곡식을 기름지게 해요.'],
  ['입하', '여름이 시작돼요.'], ['소만', '햇볕이 풍부해서 만물이 자라 가득 차기 시작해요.'], ['망종', '보리를 거두고 모를 심기 좋은 때예요.'],
  ['하지', '1년 중 낮이 가장 길어요.'], ['소서', '작은 더위. 본격적인 더위가 시작돼요.'], ['대서', '큰 더위. 1년 중 가장 더운 때예요.'],
  ['입추', '가을이 시작돼요.'], ['처서', '더위가 한풀 꺾여요. 모기 입이 비뚤어진다는 날이에요.'], ['백로', '흰 이슬이 맺히기 시작해요.'],
  ['추분', '낮과 밤의 길이가 같아져요. 이제부터 밤이 더 길어져요.'], ['한로', '찬 이슬이 맺혀요.'], ['상강', '서리가 내리기 시작해요.'],
  ['입동', '겨울이 시작돼요. 김장을 하는 때예요.'], ['소설', '첫눈이 내리기 시작해요.'], ['대설', '눈이 많이 내리는 때예요.'],
  ['동지', '1년 중 밤이 가장 길어요. 팥죽을 먹어요.'], ['소한', '작은 추위. 실제로는 1년 중 가장 추울 때가 많아요.'], ['대한', '큰 추위. 겨울의 마지막 절기예요.'],
  ['입춘', '봄이 시작돼요. "입춘대길"을 써 붙여요.'], ['우수', '눈이 녹아 비가 되고 얼음이 풀려요.'], ['경칩', '겨울잠 자던 개구리가 깨어나요.'],
];
const termCache = new Map();
/** 그해 24절기: [{key, name, desc, at(ms)}] */
export function solarTerms(year) {
  if (termCache.has(year)) return termCache.get(year);
  const out = [];
  // 1월 1일(UTC)부터 하루씩 황경이 15° 경계를 넘는 날을 찾고, 그 안에서 이분법으로 시각을 구한다
  const jd0 = Date.UTC(year, 0, 1) / 86400000 + 2440587.5;
  let prev = sunLongitude(jd0);
  for (let i = 1; i <= 366; i++) {
    const jd = jd0 + i;
    const cur = sunLongitude(jd);
    const a = Math.floor(prev / 15), b = Math.floor(cur / 15);
    if (a !== b) {
      const target = (b * 15) % 360;
      let lo = jd - 1, hi = jd;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const l = sunLongitude(mid);
        const diff = ((l - target + 540) % 360) - 180;
        if (diff < 0) lo = mid; else hi = mid;
      }
      const ms = (hi - 2440587.5) * 86400000;
      const k = new Date(ms + 9 * 3600e3); // 한국 시각
      if (k.getUTCFullYear() === year) {
        const [name, desc] = TERMS[(b % 24 + 24) % 24];
        out.push({ key: keyOf(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate()), name, desc, at: ms });
      }
    }
    prev = cur;
  }
  termCache.set(year, out);
  return out;
}

/* ───────── 양력으로 정해진 날 ───────── */
// [월, 일, 이름, 종류, 설명]
const FIXED = [
  [1, 1, '신정', 'holiday', '새해 첫날이에요.'],
  [1, 14, '다이어리데이', 'fun', '새해 다이어리를 주고받는 날이에요.'],
  [1, 27, '국제 홀로코스트 희생자 추모의 날', 'intl', '아우슈비츠 수용소가 해방된 날이에요.'],
  [2, 14, '밸런타인데이', 'fun', '좋아하는 사람에게 초콜릿을 주는 날이에요.'],
  [2, 28, '2·28 민주운동 기념일', 'legal', '1960년 대구 학생들이 독재에 맞선 날이에요.'],
  [3, 1, '3·1절', 'holiday', '1919년 3·1 만세운동을 기념하는 국경일이에요.'],
  [3, 3, '삼겹살데이', 'fun', '3이 두 번 겹쳐서 삼겹살을 먹는 날이에요.'],
  [3, 3, '납세자의 날', 'legal', '세금을 성실히 낸 사람들을 격려하는 날이에요.'],
  [3, 8, '세계 여성의 날', 'intl', '여성의 권리와 평등을 생각하는 날이에요.'],
  [3, 8, '3·8 민주의거 기념일', 'legal', '1960년 대전 학생들의 민주화 운동을 기념해요.'],
  [3, 14, '화이트데이', 'fun', '밸런타인데이에 받은 마음에 사탕으로 답하는 날이에요.'],
  [3, 14, '파이데이 (π)', 'fun', '원주율 3.14를 기념하는 수학의 날이에요.'],
  [3, 15, '3·15 의거 기념일', 'legal', '1960년 마산에서 부정선거에 맞선 날이에요.'],
  [3, 21, '세계 인종차별 철폐의 날', 'intl', '인종 차별을 없애자고 다짐하는 날이에요.'],
  [3, 22, '세계 물의 날', 'intl', '물을 아끼고 깨끗하게 지키자는 날이에요. (우리나라 법정 \'물의 날\')'],
  [3, 23, '세계 기상의 날', 'intl', '날씨와 기후를 관측하는 세계기상기구가 생긴 날이에요.'],
  [4, 1, '만우절', 'fun', '가벼운 거짓말과 장난을 해도 웃어넘기는 날이에요.'],
  [4, 3, '제주 4·3 희생자 추념일', 'legal', '제주 4·3 사건의 희생자를 기리는 날이에요.'],
  [4, 5, '식목일', 'legal', '나무를 심고 숲을 가꾸는 날이에요.'],
  [4, 7, '보건의 날', 'legal', '국민 건강을 생각하는 날이에요. (세계 보건의 날)'],
  [4, 11, '대한민국 임시정부 수립 기념일', 'legal', '1919년 상하이에서 임시정부가 세워진 날이에요.'],
  [4, 14, '블랙데이', 'fun', '애인이 없는 사람들이 짜장면을 먹는 날이에요.'],
  [4, 16, '국민안전의 날', 'legal', '세월호 참사를 기억하고 안전을 다짐하는 날이에요.'],
  [4, 19, '4·19 혁명 기념일', 'legal', '1960년 독재에 맞선 4·19 혁명을 기념해요.'],
  [4, 20, '장애인의 날', 'legal', '장애인에 대한 이해를 넓히는 날이에요.'],
  [4, 21, '과학의 날', 'legal', '과학을 생각하고 즐기는 날이에요.'],
  [4, 22, '지구의 날', 'intl', '지구 환경을 지키자는 날이에요. 저녁에 불 끄기 행사를 해요.'],
  [4, 22, '정보통신의 날', 'legal', '정보통신의 중요성을 생각하는 날이에요.'],
  [4, 23, '세계 책의 날', 'intl', '책 읽기와 저작권을 생각하는 날이에요.'],
  [4, 25, '법의 날', 'legal', '법을 지키는 마음을 다지는 날이에요.'],
  [4, 28, '충무공 이순신 탄신일', 'legal', '이순신 장군이 태어난 날이에요.'],
  [5, 1, '근로자의 날 (노동절)', 'legal', '일하는 사람들의 노고를 기리는 날이에요. 많은 회사가 쉬어요.'],
  [5, 2, '오이데이', 'fun', '5와 2(오이)가 만나서 오이를 먹는 날이에요.'],
  [5, 5, '어린이날', 'holiday', '어린이를 사랑하고 아끼는 날이에요. 방정환 선생님이 만들었어요.'],
  [5, 8, '어버이날', 'legal', '부모님께 감사드리고 카네이션을 달아 드리는 날이에요.'],
  [5, 10, '유권자의 날', 'legal', '투표의 소중함을 생각하는 날이에요.'],
  [5, 11, '입양의 날', 'legal', '가정의 달에 1(가정)이 1(아이)을 입양해 행복하자는 뜻이에요.'],
  [5, 14, '로즈데이', 'fun', '장미꽃을 주고받는 날이에요.'],
  [5, 15, '스승의 날', 'legal', '선생님께 감사드리는 날이에요. 세종대왕 탄신일이기도 해요.'],
  [5, 18, '5·18 민주화운동 기념일', 'legal', '1980년 광주 민주화운동을 기념해요.'],
  [5, 19, '발명의 날', 'legal', '측우기를 만든 날을 기념해 발명을 장려하는 날이에요.'],
  [5, 20, '세계인의 날', 'legal', '다양한 나라 사람들이 함께 어울려 사는 것을 생각하는 날이에요.'],
  [5, 21, '부부의 날', 'legal', '둘(2)이 하나(1)가 된다는 뜻의 날이에요.'],
  [5, 25, '실종아동의 날', 'legal', '실종된 아이들을 기억하고 찾는 날이에요.'],
  [5, 31, '바다의 날', 'legal', '바다의 소중함을 생각하는 날이에요. 장보고가 청해진을 세운 달이에요.'],
  [5, 31, '세계 금연의 날', 'intl', '담배의 해로움을 알리는 날이에요.'],
  [6, 5, '환경의 날', 'legal', '환경을 지키자고 다짐하는 날이에요. (세계 환경의 날)'],
  [6, 6, '현충일', 'holiday', '나라를 위해 목숨을 바친 분들을 기리는 날이에요. 오전 10시에 사이렌이 울려요.'],
  [6, 10, '6·10 민주항쟁 기념일', 'legal', '1987년 민주화를 이끈 6월 항쟁을 기념해요.'],
  [6, 14, '키스데이', 'fun', '연인끼리 마음을 표현하는 날이에요.'],
  [6, 15, '노인학대 예방의 날', 'legal', '어르신을 존중하고 학대를 막자는 날이에요.'],
  [6, 25, '6·25 전쟁일', 'legal', '1950년 한국전쟁이 시작된 날이에요.'],
  [6, 28, '철도의 날', 'legal', '우리나라 철도의 시작을 기념하는 날이에요.'],
  [7, 11, '인구의 날', 'legal', '인구 문제를 생각하는 날이에요. (세계 인구의 날)'],
  [7, 14, '실버데이', 'fun', '은반지를 주고받는 날이에요.'],
  [7, 17, '제헌절', 'national', '1948년 헌법을 만들어 알린 날이에요. 국경일이지만 쉬는 날은 아니에요.'],
  [7, 27, '유엔군 참전의 날', 'legal', '6·25 전쟁 정전 협정일이에요. 함께 싸운 유엔군을 기려요.'],
  [8, 14, '일본군 위안부 피해자 기림의 날', 'legal', '김학순 할머니가 처음 피해를 증언한 날이에요.'],
  [8, 14, '그린데이', 'fun', '숲속을 걸으며 마음을 나누는 날이에요.'],
  [8, 15, '광복절', 'holiday', '1945년 일본으로부터 나라를 되찾은 날이에요.'],
  [9, 1, '통계의 날', 'legal', '통계의 중요성을 알리는 날이에요.'],
  [9, 7, '사회복지의 날', 'legal', '사회복지를 생각하는 날이에요.'],
  [9, 9, '구구데이', 'fun', '9와 9(구구)가 만나 닭고기를 먹는 날이에요.'],
  [9, 10, '해양경찰의 날', 'legal', '바다를 지키는 해양경찰을 기리는 날이에요.'],
  [9, 14, '포토데이', 'fun', '함께 사진을 찍는 날이에요.'],
  [9, 21, '치매극복의 날', 'legal', '치매를 이해하고 극복하자는 날이에요.'],
  [9, 21, '세계 평화의 날', 'intl', '전쟁 없는 세상을 생각하는 날이에요.'],
  [10, 1, '국군의 날', 'legal', '나라를 지키는 국군을 기리는 날이에요.'],
  [10, 2, '노인의 날', 'legal', '어르신을 공경하는 날이에요.'],
  [10, 3, '개천절', 'holiday', '단군이 고조선을 세운 것을 기념하는 국경일이에요.'],
  [10, 5, '세계 한인의 날', 'legal', '세계 곳곳에 사는 한국인을 생각하는 날이에요.'],
  [10, 8, '재향군인의 날', 'legal', '나라를 지켰던 군인들을 기리는 날이에요.'],
  [10, 9, '한글날', 'holiday', '세종대왕이 만든 한글을 기념하는 국경일이에요.'],
  [10, 10, '임산부의 날', 'legal', '풍요로운 10월에 10달 동안 아기를 품은 엄마를 생각하는 날이에요.'],
  [10, 14, '와인데이', 'fun', '함께 와인을 마시는 날이에요. (어린이는 포도주스!)'],
  [10, 15, '체육의 날', 'legal', '운동과 건강을 생각하는 날이에요.'],
  [10, 16, '부마 민주항쟁 기념일', 'legal', '1979년 부산·마산의 민주화 운동을 기념해요.'],
  [10, 16, '세계 식량의 날', 'intl', '굶주림 없는 세상을 생각하는 날이에요.'],
  [10, 21, '경찰의 날', 'legal', '우리를 지키는 경찰을 기리는 날이에요.'],
  [10, 24, '국제연합일 (유엔의 날)', 'intl', '1945년 유엔이 생긴 날이에요.'],
  [10, 25, '독도의 날', 'legal', '독도가 우리 땅임을 알리는 날이에요. (민간·지자체 기념일)'],
  [10, 28, '교정의 날', 'legal', '교도관 등 교정 공무원을 기리는 날이에요.'],
  [10, 31, '핼러윈', 'fun', '분장을 하고 사탕을 나누는 서양 축제예요.'],
  [11, 3, '학생독립운동 기념일', 'legal', '1929년 광주 학생들의 독립운동을 기념해요.'],
  [11, 9, '소방의 날', 'legal', '119를 기념해 소방관을 기리는 날이에요.'],
  [11, 11, '빼빼로데이', 'fun', '1이 네 개라 빼빼로를 주고받는 날이에요.'],
  [11, 11, '가래떡데이', 'fun', '빼빼로 대신 우리 쌀로 만든 가래떡을 먹자는 날이에요.'],
  [11, 11, '농업인의 날', 'legal', '十一(십일)을 합치면 土(흙 토)가 돼요. 흙과 함께 사는 농업인을 기려요.'],
  [11, 11, '보행자의 날', 'legal', '11이 두 다리로 걷는 모습 같아서, 걷기와 보행 안전을 생각하는 날이에요.'],
  [11, 11, '유엔참전용사 국제추모의 날', 'legal', '6·25 전쟁에서 싸운 유엔군 참전용사를 기려요. 오전 11시에 부산을 향해 1분간 묵념해요 (Turn Toward Busan).'],
  [11, 14, '무비데이', 'fun', '함께 영화를 보는 날이에요.'],
  [11, 17, '순국선열의 날', 'legal', '나라의 독립을 위해 목숨을 바친 분들을 기리는 날이에요.'],
  [12, 1, '세계 에이즈의 날', 'intl', '에이즈에 대해 바르게 알고 편견을 없애자는 날이에요.'],
  [12, 3, '소비자의 날', 'legal', '소비자의 권리를 생각하는 날이에요.'],
  [12, 5, '무역의 날', 'legal', '수출 1천억 달러 달성을 기념한 무역의 날이에요.'],
  [12, 10, '세계 인권의 날', 'intl', '1948년 세계인권선언을 기념하는 날이에요.'],
  [12, 14, '허그데이', 'fun', '서로 안아 주며 마음을 나누는 날이에요.'],
  [12, 24, '크리스마스이브', 'fun', '성탄절 전날 밤이에요.'],
  [12, 25, '성탄절 (크리스마스)', 'holiday', '예수가 태어난 것을 기념하는 날이에요.'],
  [12, 27, '원자력 안전 및 진흥의 날', 'legal', '원자력의 안전과 발전을 생각하는 날이에요.'],
  [12, 31, '한 해의 마지막 날', 'fun', '올해를 돌아보고 새해를 맞이하는 날이에요. 밤 12시에 보신각 종이 울려요.'],
];
// [월, n번째(-1=마지막), 요일, 이름, 종류, 설명]
const NTH = [
  [3, 3, 3, '상공의 날', 'legal', '상공업 발전을 생각하는 날이에요. (3월 셋째 수요일)'],
  [3, 4, 5, '서해수호의 날', 'legal', '서해를 지키다 희생된 장병들을 기리는 날이에요. (3월 넷째 금요일)'],
  [5, 3, 1, '성년의 날', 'legal', '만 19세가 된 사람들이 어른이 된 것을 축하하는 날이에요. (5월 셋째 월요일)'],
  [5, 2, 0, '어머니의 날 (서양)', 'intl', '미국 등 여러 나라의 어머니의 날이에요. (5월 둘째 일요일)'],
  [6, 3, 0, '아버지의 날 (서양)', 'intl', '미국 등 여러 나라의 아버지의 날이에요. (6월 셋째 일요일)'],
  [7, 2, 3, '정보보호의 날', 'legal', '개인정보와 사이버 보안을 생각하는 날이에요. (7월 둘째 수요일)'],
  [10, 3, 6, '문화의 날', 'legal', '문화의 소중함을 생각하는 날이에요. (10월 셋째 토요일)'],
  [10, -1, 2, '금융의 날', 'legal', '금융을 생각하는 날이에요. (10월 마지막 화요일)'],
  [11, 4, 4, '추수감사절 (미국)', 'intl', '미국의 추수감사절이에요. (11월 넷째 목요일)'],
];
// 음력 [월, 일, 이름, 종류, 설명]
const LUNAR = [
  [1, 1, '설날', 'holiday', '음력 새해 첫날이에요. 차례를 지내고 세배하고 떡국을 먹어요.'],
  [1, 2, '설날 연휴', 'holiday', '설날 다음 날이에요.'],
  [1, 15, '정월대보름', 'folk', '새해 첫 보름달. 부럼을 깨고 오곡밥과 나물을 먹어요.'],
  [3, 3, '삼짇날', 'folk', '강남 갔던 제비가 돌아온다는 날이에요. 진달래 화전을 먹어요.'],
  [4, 8, '부처님 오신 날', 'holiday', '석가모니가 태어난 날이에요. 연등을 달아요.'],
  [5, 5, '단오', 'folk', '창포물에 머리 감고 그네 타고 씨름하는 날이에요.'],
  [6, 15, '유두', 'folk', '맑은 물에 머리를 감고 더위를 이기는 날이에요.'],
  [7, 7, '칠석', 'folk', '견우와 직녀가 오작교에서 1년에 한 번 만나는 날이에요.'],
  [7, 15, '백중', 'folk', '농사일을 쉬고 조상을 기리는 날이에요.'],
  [8, 14, '추석 연휴', 'holiday', '추석 전날이에요.'],
  [8, 15, '추석', 'holiday', '한가위. 햇곡식으로 차례를 지내고 송편을 먹고 보름달을 봐요.'],
  [8, 16, '추석 연휴', 'holiday', '추석 다음 날이에요.'],
  [9, 9, '중양절', 'folk', '9가 겹치는 날. 국화전을 먹고 높은 곳에 올라요.'],
];

/* ───────── 한 해 전체 만들기 ───────── */
const yearCache = new Map();
/** 그해의 모든 특별한 날: Map(key → [{name, kind, desc}]) */
export function specialDays(year) {
  if (yearCache.has(year)) return yearCache.get(year);
  const map = new Map();
  const add = (k, name, kind, desc) => {
    if (!map.has(k)) map.set(k, []);
    const list = map.get(k);
    if (!list.some((x) => x.name === name)) list.push({ name, kind, desc });
  };
  for (const [m, d, name, kind, desc] of FIXED) add(keyOf(year, m, d), name, kind, desc);
  for (const [m, n, wd, name, kind, desc] of NTH) add(keyOf(year, m, nthWeekday(year, m, wd, n)), name, kind, desc);

  // 음력 날짜 (그해 양력 1/1 ~ 12/31 중 해당하는 날), 섣달그믐은 설날 전날
  const lunarHolidayKeys = { seol: [], chuseok: [] };
  if (lunarFormatter()) {
    for (let i = 0; i < 366; i++) {
      const [y, m, d] = addDays(year, 1, 1, i);
      if (y !== year) break;
      const l = toLunar(y, m, d);
      if (!l || l.leap) continue;
      for (const [lm, ld, name, kind, desc] of LUNAR) {
        if (l.month === lm && l.day === ld) {
          add(keyOf(y, m, d), name, kind, desc);
          if (lm === 1 && ld <= 2) lunarHolidayKeys.seol.push([y, m, d]);
          if (lm === 8) lunarHolidayKeys.chuseok.push([y, m, d]);
          if (lm === 1 && ld === 1) {
            const [py, pm, pd] = addDays(y, m, d, -1);
            if (py === year) { add(keyOf(py, pm, pd), '설날 연휴 (섣달그믐)', 'holiday', '음력 한 해의 마지막 날이에요. 잠들면 눈썹이 하얗게 센다는 말이 있어요.'); lunarHolidayKeys.seol.unshift([py, pm, pd]); }
          }
        }
      }
    }
    // 다음 해 설날이 1월 1~2일이면 섣달그믐이 올해 12/31일 수 있다
    const [ny, nm, nd] = [year + 1, 1, 1];
    const nl = toLunar(ny, nm, nd);
    if (nl && nl.month === 1 && nl.day === 1) add(keyOf(year, 12, 31), '설날 연휴 (섣달그믐)', 'holiday', '음력 한 해의 마지막 날이에요.');
  }

  // 24절기 + 한식 + 삼복
  const terms = solarTerms(year);
  for (const t of terms) add(t.key, t.name, 'term', t.desc);
  const prevDongji = solarTerms(year - 1).find((t) => t.name === '동지');
  if (prevDongji) {
    const [y, m, d] = prevDongji.key.split('-').map(Number);
    const [hy, hm, hd] = addDays(y, m, d, 105);
    if (hy === year) add(keyOf(hy, hm, hd), '한식', 'folk', '동지에서 105일째 되는 날. 불을 쓰지 않고 찬 음식을 먹으며 성묘해요.');
  }
  const term = (name) => { const t = terms.find((x) => x.name === name); return t ? t.key.split('-').map(Number) : null; };
  const haji = term('하지'), ipchu = term('입추');
  if (haji) {
    let count = 0;
    for (let i = 0; i < 60; i++) {
      const [y, m, d] = addDays(haji[0], haji[1], haji[2], i);
      if (!isGyeong(y, m, d)) continue;
      count++;
      if (count === 3) add(keyOf(y, m, d), '초복', 'folk', '삼복더위의 시작. 삼계탕을 먹어요.');
      if (count === 4) { add(keyOf(y, m, d), '중복', 'folk', '삼복의 가운데 날이에요.'); break; }
    }
  }
  if (ipchu) {
    for (let i = 0; i < 10; i++) {
      const [y, m, d] = addDays(ipchu[0], ipchu[1], ipchu[2], i);
      if (isGyeong(y, m, d)) { add(keyOf(y, m, d), '말복', 'folk', '삼복더위의 마지막 날이에요.'); break; }
    }
  }

  // 대체공휴일 (2023년 5월부터의 규칙)
  const isOff = (y, m, d) => (map.get(keyOf(y, m, d)) || []).some((x) => x.kind === 'holiday' || x.kind === 'sub');
  const nextFreeWeekday = (y, m, d, avoidSat) => {
    let [a, b, c] = addDays(y, m, d, 1);
    for (let i = 0; i < 10; i++) {
      const wd = weekday(a, b, c);
      if (wd !== 0 && !(avoidSat && wd === 6) && !isOff(a, b, c)) return [a, b, c];
      [a, b, c] = addDays(a, b, c, 1);
    }
    return null;
  };
  const addSub = (dates, label, satToo, overlapToo = true) => {
    if (!dates.length) return;
    const holidaysOthers = (y, m, d) => (map.get(keyOf(y, m, d)) || []).filter((x) => x.kind === 'holiday' && !x.name.startsWith(label)).length > 0;
    const needs = dates.some(([y, m, d]) => weekday(y, m, d) === 0 || (satToo && weekday(y, m, d) === 6) || (overlapToo && holidaysOthers(y, m, d)));
    if (!needs) return;
    const last = dates[dates.length - 1];
    const r = nextFreeWeekday(last[0], last[1], last[2], satToo);
    if (r && r[0] === year) add(keyOf(...r), `대체공휴일 (${label})`, 'sub', `${label}이 주말이나 다른 공휴일과 겹쳐서 대신 쉬는 날이에요.`);
  };
  if (year >= 2014) { addSub(lunarHolidayKeys.seol, '설날', false); addSub(lunarHolidayKeys.chuseok, '추석', false); }
  const fixedSubs = [[5, 5, '어린이날', 2014], [3, 1, '3·1절', 2021], [8, 15, '광복절', 2021], [10, 3, '개천절', 2021], [10, 9, '한글날', 2021], [12, 25, '성탄절', 2023]];
  // 다른 공휴일과 겹칠 때 대체공휴일이 생기는 건 설날·추석·어린이날뿐이다
  for (const [m, d, label, since] of fixedSubs) if (year >= since) addSub([[year, m, d]], label, true, label === '어린이날');
  if (year >= 2023 && lunarFormatter()) {
    const bud = [...map.entries()].find(([, l]) => l.some((x) => x.name === '부처님 오신 날'));
    if (bud) addSub([bud[0].split('-').map(Number)], '부처님 오신 날', true, false);
  }

  // 같은 날 안에서 중요한 것부터
  const order = ['holiday', 'sub', 'national', 'legal', 'term', 'folk', 'intl', 'fun'];
  for (const list of map.values()) list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  yearCache.set(year, map);
  return map;
}

/** 하루치 특별한 날 */
export function daysOn(y, m, d) {
  return specialDays(y).get(keyOf(y, m, d)) || [];
}
/** 쉬는 날(빨간 날)인지 */
export function isRedDay(y, m, d) {
  return weekday(y, m, d) === 0 || daysOn(y, m, d).some((x) => KIND[x.kind]?.red);
}
