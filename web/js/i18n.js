// 언어(한국어·English)와 화면 모드(시스템·라이트·다크) 설정.
// 앱의 모든 문구는 한국어로 쓰여 있고, English를 고르면 화면에 붙기 직전에 t()가 번역한다.
// (ui.js의 h()가 글자와 title·aria-label·placeholder를 자동으로 t()에 통과시킨다)

const KEY = 'proto.prefs.v1';
export const prefs = { theme: 'system', lang: 'ko' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 기본값 */ }

function savePrefs() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 무시 */ }
}

export function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') root.dataset.theme = prefs.theme;
  else delete root.dataset.theme;
  root.lang = prefs.lang === 'en' ? 'en' : 'ko';
  document.title = prefs.lang === 'en' ? 'Prototype' : '프로토타입';
}
export function setTheme(v) { prefs.theme = v; savePrefs(); applyTheme(); }
export function setLang(v) { prefs.lang = v; savePrefs(); applyTheme(); }
export const isEn = () => prefs.lang === 'en';
export const locale = () => (prefs.lang === 'en' ? 'en-US' : 'ko-KR');

/* ───────── 그대로 바뀌는 문구 ───────── */
const D = {
  // 공통
  '프로토타입': 'Prototype', '홈': 'Home', '설정': 'Settings', '뒤로': 'Back', '닫기': 'Close', '취소': 'Cancel', '확인': 'OK', '저장': 'Save', '저장됨': 'Saved', '삭제': 'Delete',
  '검색': 'Search', '계속': 'Continue', '나중에': 'Later', '다시 시도': 'Try again', '다시 저장': 'Save again', '바꾸기': 'Change', '버리기': 'Discard', '계속 작성': 'Keep writing', '계속 편집': 'Keep editing',
  '없음': 'None', '꺼짐': 'Off', '오늘': 'today', '내일': 'tomorrow', '방금': 'just now', '알 수 없음': 'Unknown', '이름 변경': 'Rename', '표시 이름': 'Display name', '유형': 'Type', '내용': 'Message',
  '불러오는 중': 'Loading', ' 불러오는 중': ' Loading', '불러오지 못함': 'Failed to load', ' 불러오지 못함': ' Failed to load', '새로 고치는 중': 'Refreshing', '오래된 정보': 'Old data',
  '오프라인': 'Offline', ' 오프라인': ' Offline', '오프라인 · 마지막 정보': 'Offline · last data', '갱신 ': 'Updated ', '기상청 ': 'KMA ', ' 관측': ' observation', '데모 데이터': 'Demo data', '일부 데모 데이터': 'Some demo data',
  '실제 데이터': 'Live data', '실시간': 'Real-time', '시간표 기준': 'Timetable', '공공데이터포털': 'data.go.kr', '확인 불가': 'Unknown',
  '새로고침 (F5)': 'Refresh (F5)', '상세 정보': 'Details', '이전 페이지': 'Previous page', '다음 페이지': 'Next page', '현재 시각': 'Current time', '날씨': 'Weather', '날씨 요약': 'Weather summary', '교통': 'Transit', '교통 요약': 'Transit summary',
  '교통 전체': 'All transit', '버스': 'Bus', '지하철': 'Subway', '경로': 'Route', '신호등': 'Traffic light', '지역': 'Region', '지역 바꾸기': 'Change region', '지역 관리': 'Manage regions', '지역 추가': 'Add region',
  '지역 설정': 'Set region', '지역 저장': 'Save a region', '지역 편집': 'Edit region', '지역 삭제': 'Delete region', '지역 없음': 'No region', '저장한 지역': 'Saved region', '저장한 지역이 없어요.': 'No saved regions.',
  'GitHub에서 업데이트를 받는 중… 잠시 후 앱이 다시 열려요.': 'Downloading the update from GitHub… the app will reopen shortly.',
  'GitHub에서 업데이트를 받지 못했어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.': 'Could not download the update from GitHub. Check your internet connection and try again.',
  '업데이트': 'Update','업데이트가 끝나지 않았어요. 앱을 닫고 다시 열어 주세요.': 'The update did not finish. Please close and reopen the app.',
  'GitHub에서 자동 업데이트': 'Auto-update from GitHub', '모바일 웹 버전': 'Mobile web version', '다운로드 페이지': 'Download page',
  '알림 시각 직접 입력·휠':'Type or scroll alarm time', '데모 데이터 표시 없앰': 'Removed demo label', '업데이트 알림 개선': 'Better update notice', '새 업데이트가 있어요': 'An update is ready', '업데이트하는 중… 잠시 후 앱이 다시 열려요.': 'Updating… the app will reopen in a moment.', '앱을 닫고 Prototype.exe를 다시 열면 업데이트돼요.': 'Close the app and open Prototype.exe again to update.',
  // 홈
  '지역을 저장하면 여기에 날씨가 보여요.': 'Save a region to see the weather here.', '지역이 없어요. 지역을 저장하면 날씨 상세가 여기에 보여요.': 'No region yet. Save one to see weather details here.',
  '정류장·역·경로·신호등을 저장하면 여기에 교통 정보가 보여요.': 'Save stops, stations, routes or traffic lights to see transit info here.', '교통 대상 설정': 'Set up transit',
  '저장한 교통 대상이 없어요. 정류장·역·경로·신호등을 저장해 보세요.': 'No saved transit items. Try saving a stop, station, route or traffic light.',
  '오프라인 상태예요. 보이는 정보는 마지막으로 받은 것이라 지금과 다를 수 있어요.': 'You are offline. What you see is the last data received and may be out of date.',
  '다시 연결됐어요. 최신 정보를 불러오는 중이에요…': 'Back online. Loading the latest data…', '오프라인이에요. 연결되면 자동으로 다시 불러와요.': 'You are offline. It will reload automatically when connected.',
  '방금 받은 정보예요. 잠시 후 다시 불러올 수 있어요.': 'This data is fresh. You can reload again in a moment.', 'API 키가 없는 정보는 데모 데이터로 보여 줘요': 'Info without an API key is shown as demo data',
  '오프라인이라 정보를 불러올 수 없어요. 연결되면 자동으로 다시 불러와요.': 'Offline, so the data cannot load. It will reload automatically when connected.',
  '신호 정보는 실시간이라 오프라인에서는 보여 주지 않아요. 연결되면 자동으로 다시 불러와요.': 'Signal info is real-time, so it is hidden while offline. It will reload when connected.',
  '아래는 마지막으로 받은 정보예요.': 'Below is the last data received.', '조회 불가': 'Unavailable', '교통 대상 관리로 이동': 'Go to transit list',
  '외부 데이터에서 더 이상 조회되지 않아요. 교통 대상 관리에서 수정하거나 삭제해 주세요.': 'This item is no longer found in the data source. Edit or delete it in the transit list.',
  '도착 예정 버스 없음': 'No buses coming', '도착 예정 열차 없음': 'No trains coming', '도착 정보 없음': 'No arrival info', '현재 이용 가능한 경로 없음': 'No route available now', '이용 가능한 경로 없음': 'No route available',
  '신호 정보 제공 안 됨': 'No signal data here', '표시할 도착 정보가 없어요.': 'No arrivals to show.', '표시할 도착 정보가 없어요. (받은 정보의 도착 시간이 모두 지났어요)': 'No arrivals to show. (All received arrival times have passed.)',
  '시간표 기준 · 실시간 도착 정보가 아니에요': 'Timetable · not real-time arrivals', ' 시간표 기준 · 실시간 도착 정보가 아니에요': ' Timetable · not real-time arrivals', '운행 현황을 확인할 수 없어요.': 'Service status unavailable.',
  '지연': 'Delayed', '지연 · ': 'Delayed · ', '운행 중단': 'Suspended', '정상 운행': 'Normal service', '곧 도착': 'Arriving', '곧 바뀜': 'Changing', '곧 바뀜 (주의)': 'Changing soon (caution)', '다음 ': 'next ',
  '보행 신호 (초록)': 'Walk (green)', '정지 신호 (빨강)': "Don't walk (red)", '신호 상태 확인 중': 'Checking signal', '보행 초록 ': 'Walk ', '빨간불 ': 'Red ',
  '대중교통 예상 소요 시간': 'Estimated transit time', ' · 환승 없음': ' · no transfers', '분': 'min', '현재 날씨': 'Current weather', '앞으로 6시간': 'Next 6 hours', '시간별 예보': 'Hourly forecast', '시간별 예보가 없어요.': 'No hourly forecast.',
  '강수확률': 'Chance of rain', '습도 (공기 속 물기)': 'Humidity', '바람': 'Wind', '1시간 강수': 'Rain (1h)', '비나 눈 소식이 있어요. 우산을 챙기세요.': 'Rain or snow expected. Take an umbrella.',
  '기온은 정시 기준 예보예요. 갱신 시각과 출처는 왼쪽 카드에 있어요.': 'Temperatures are hourly forecasts. Update time and source are on the left card.',
  '맑음': 'Clear', '구름 조금': 'Partly cloudy', '구름 많음': 'Mostly cloudy', '흐림': 'Overcast', '비': 'Rain', '눈': 'Snow', '비/눈': 'Rain/snow', '빗방울': 'Drizzle', '빗방울/눈날림': 'Drizzle/flurries', '눈날림': 'Flurries',
  '현재 위치': 'Current location', '현재 위치 (이 PC의 위치)': 'Current location (this PC)', '위치를 쓸 수 없어 현재 위치 날씨를 볼 수 없어요.': 'Location is blocked, so current-location weather is unavailable.',
  '현재 위치 날씨를 보려면 위치 사용을 허용해야 해요.': 'Allow location to see weather for where you are.', '현재 위치를 확인하지 못했어요.': 'Could not get your location.',
  // 오류 문구
  '인터넷에 연결되어 있지 않아요.': 'You are not connected to the internet.', '응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.': 'The response is too slow. Please try again shortly.',
  '요청이 많아 잠시 쉬고 있어요. 조금 뒤 자동으로 다시 불러와요.': 'Too many requests. Pausing briefly; it will reload automatically.', '더 이상 조회되지 않는 대상이에요.': 'This item is no longer available.',
  '정보를 주는 곳에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.': 'The data provider has a problem. Please try again shortly.',
  '이 정보는 아직 쓸 수 없어요. data.go.kr에서 이 서비스 활용신청이 승인됐는지, API_KEYS.bat의 키가 맞는지 확인해 주세요.': 'This info is not available yet. Check that the service is approved on data.go.kr and that the key in API_KEYS.bat is correct.',
  '새 앱을 받는 중이에요. 설치 화면이 열리면 "업데이트"(또는 "설치")를 눌러 주세요.': 'Downloading the new app. When the install screen opens, tap "Update" (or "Install").',
  '시간 맞추기': 'Time sync',
  '달력': 'Calendar',
  '설정을 이 브라우저에 저장할까요?': 'Save your settings in this browser?',
  '이 웹 버전은 내가 고른 지역·교통 대상·일정·화면 설정을 이 브라우저에만(쿠키·브라우저 저장소) 저장해요. 허용하면 다음에 열 때 다시 고르지 않아도 돼요.': 'This web version saves the region, transit targets, events and display settings you choose only in this browser (cookie and browser storage). If you allow it, you will not need to choose them again next time.',
  '서버에는 아무것도 보내지 않아요. 한 번만 물어보고 다시 묻지 않아요. 나중에 설정에서 바꿀 수 있어요.': 'Nothing is sent to a server. We ask only once and will not ask again. You can change this later in Settings.',
  '저장 안 함': "Don't save",
  '저장 허용': 'Allow saving',
  '이 브라우저에 저장': 'Save in this browser',
  '한국 표준시(KST) 기준 · 선택한 지역의 시각이에요': 'Korea Standard Time (KST) · the time of your selected region',
  '서울 버스 정보는 Windows 버전과 Android 앱에서만 볼 수 있어요. (서울시 버스 API가 휴대폰 브라우저의 보안 연결을 지원하지 않아요)': 'Seoul bus info is only available in the Windows version and the Android app. (The Seoul bus API does not support secure connections for phone browsers.)',
  '이 기능은 모바일 웹 버전에서는 아직 쓸 수 없어요. Windows 버전에서 써 주세요.': 'This feature is not available in the mobile web version yet. Please use the Windows version.',
  'API 키 (이 휴대폰에만 저장)': 'API keys (saved on this phone only)', '공공데이터포털 키 (필수)': 'data.go.kr key (required)', '카카오 REST API 키 (선택)': 'Kakao REST API key (optional)',
  '키를 넣으면 실제 날씨·경기 버스·지하철 시간표·신호등 정보가 보여요. 키는 이 휴대폰 브라우저에만 저장되고 어디에도 보내지 않아요 (각 기관에 조회할 때만 써요).': 'With a key you get live weather, Gyeonggi buses, subway timetables and traffic lights. Keys stay in this phone’s browser and are only sent to each data provider when looking things up.',
  '키를 넣으면 실제 날씨·서울·경기 버스·지하철 시간표·신호등 정보가 보여요. 키는 이 휴대폰 앱에만 저장되고 어디에도 보내지 않아요 (각 기관에 조회할 때만 써요).': 'With a key you get live weather, Seoul/Gyeonggi buses, subway timetables and traffic lights. Keys stay in this phone app and are only sent to each data provider when looking things up.',
  '키 저장': 'Save keys', '키를 저장했어요.': 'Keys saved.',
  // 설정
  '정류장·역·경로·신호등': 'Stops, stations, routes, lights', '교통 확인 대상': 'Transit items', '출발 알림': 'Departure alarms', '정한 시각에 알림': 'Alerts at set times', '알림이 꺼져 있어 표시되지 않아요': 'Notifications are off, so alarms will not show',
  '알림 꺼짐': 'Notifications off', '피드백 보내기': 'Send feedback', '불편한 점이나 바라는 점을 알려 주세요': 'Tell us what bothers you or what you want', '데이터 출처 정보': 'Data sources', '날씨·버스·지하철·경로·신호 정보를 주는 곳': 'Who provides weather, bus, subway, route and signal data',
  'API 키 상태 (Windows 버전)': 'API key status (Windows)', '앱 정보': 'About', '설정은 이 PC에만 저장돼요. 로그인은 필요 없어요.': 'Settings are saved on this PC only. No login needed.', '키 파일 열기': 'Open key file',
  'API_KEYS.bat 파일에 키를 넣고 저장하면 바로 실제 데이터로 바뀌어요. 키가 없는 항목은 데모 데이터를 보여 줘요.': 'Put keys in API_KEYS.bat and save to switch to live data right away. Items without a key show demo data.',
  '버스 도착 (서울·경기)': 'Bus arrivals (Seoul/Gyeonggi)', '지하철 도착·운행': 'Subway arrivals & status', '경로 소요 시간': 'Route time', '지역·장소 검색': 'Region & place search', '화면': 'Display', '화면 모드': 'Theme', '언어': 'Language',
  '시스템': 'System', '라이트': 'Light', '다크': 'Dark', '한국어': '한국어', 'English': 'English',
  'DATA_GO_KR_KEY (시간표) · 실시간은 SEOUL_OPENAPI_KEY (선택)': 'DATA_GO_KR_KEY (timetable) · real-time needs SEOUL_OPENAPI_KEY (optional)', 'ODSAY_KEY (선택 · 없으면 데모)': 'ODSAY_KEY (optional · demo without it)', 'DATA_GO_KR_KEY · 서울은 TDATA_KEY (선택)': 'DATA_GO_KR_KEY · Seoul uses TDATA_KEY (optional)',
  // 출처
  '앱에 보이는 날씨·교통 정보는 아래 기관의 데이터예요. 실제 상황과 차이가 있을 수 있으니, 홈의 각 항목에 적힌 갱신 시각을 함께 확인해 주세요.': 'Weather and transit data come from the organizations below. It may differ from reality, so check the update time on each home item.',
  'API 키가 없는 항목은 데모 데이터로 보여 주며, 그때 홈의 출처에는 "데모 데이터"라고 적혀요.': 'Items without an API key show demo data, and their source on Home says "Demo data".',
  '버스 도착': 'Bus arrivals', '버스 도착 (경기)': 'Bus arrivals (Gyeonggi)', '지하철 도착·운행 현황': 'Subway arrivals & status', '지하철 시간표': 'Subway timetable', '신호 정보': 'Signal info', '신호 정보 (서울)': 'Signal info (Seoul)',
  '기상청': 'Korea Meteorological Administration', '서울특별시': 'Seoul Metropolitan Government', '경기도': 'Gyeonggi Province', '국토교통부': 'Ministry of Land, Infrastructure and Transport', '카카오': 'Kakao', '행정안전부 한국지역정보개발원': 'Korea Local Information Research & Development Institute',
  '단기예보 조회서비스 (초단기실황·초단기예보)': 'Short-term forecast service', '정류소정보조회 서비스 (버스 도착정보)': 'Bus stop & arrival service', '버스도착정보·정류소 조회 서비스': 'Bus arrival & stop service', '실시간 지하철 도착정보': 'Real-time subway arrivals',
  'TAGO 지하철정보': 'TAGO subway info', '대중교통 길찾기 API': 'Transit routing API', '교통안전 신호등 실시간 정보': 'Real-time traffic light info', '교통빅데이터플랫폼 T-data V2X 신호 정보': 'T-data V2X signal info', '카카오 로컬 API': 'Kakao Local API',
  '출처: 기상청, 공공데이터포털(data.go.kr)': 'Source: KMA, data.go.kr', '출처: 서울특별시, 공공데이터포털(data.go.kr)': 'Source: Seoul, data.go.kr', '출처: 경기도, 공공데이터포털(data.go.kr)': 'Source: Gyeonggi, data.go.kr', '출처: Kakao': 'Source: Kakao',
  '출처: 서울 열린데이터광장(data.seoul.go.kr). 운행 현황은 실시간 도착 메시지를 바탕으로 보여 줘요.': 'Source: Seoul Open Data Plaza. Service status is based on real-time arrival messages.',
  '출처: 국토교통부, 공공데이터포털(data.go.kr). 서울 열린데이터광장 키가 없을 때 시간표 기준으로 보여 줘요.': 'Source: MOLIT, data.go.kr. Used as a timetable when there is no Seoul Open Data key.',
  '출처: 공공데이터포털(data.go.kr). 실시간 신호를 제공하지 않는 교차로는 "신호 정보 제공 안 됨"으로 보여요.': 'Source: data.go.kr. Intersections without real-time signals show "No signal data here".',
  '출처: 서울 교통빅데이터플랫폼(t-data.seoul.go.kr)': 'Source: Seoul T-data',
  '기상청 단기예보 조회서비스 (공공데이터포털)': 'KMA short-term forecast (data.go.kr)', '서울특별시·경기도 버스도착정보 (공공데이터포털)': 'Seoul/Gyeonggi bus arrivals (data.go.kr)', '서울시 실시간 지하철 도착정보 (서울 열린데이터광장)': 'Seoul real-time subway (Seoul Open Data)',
  '국토교통부 TAGO 지하철 시간표 (공공데이터포털)': 'MOLIT TAGO subway timetable (data.go.kr)', 'ODsay LAB 대중교통 길찾기': 'ODsay LAB transit routing', '행정안전부 한국지역정보개발원 교통안전 신호등 실시간 정보 (공공데이터포털)': 'KLID real-time traffic lights (data.go.kr)',
  '서울 교통빅데이터플랫폼 T-data (V2X 신호)': 'Seoul T-data (V2X signals)', '카카오 로컬': 'Kakao Local', '데모 데이터 (API 키 없음)': 'Demo data (no API key)',
  // 첫 실행
  '시각·날씨·교통을 한 화면에서': 'Time, weather and transit on one screen',
  '출발 전에 여러 앱을 오갈 필요 없이, 지금 시각과 날씨, 자주 타는 버스·지하철·경로·신호등을 한눈에 확인해요. 먼저 두 가지만 저장해 두면 홈이 채워져요.': 'No more jumping between apps before you leave: see the time, weather, and your buses, subways, routes and traffic lights at a glance. Save two things first to fill the home screen.',
  '날씨를 볼 지역을 고르세요.': 'Pick a region for the weather.', '교통 대상 저장': 'Save transit items', '정류장·역·경로·신호등을 고르세요.': 'Pick stops, stations, routes or lights.',
  '위치나 알림 권한은 지금 묻지 않아요. 그 기능을 쓸 때만 물어봐요.': 'We will not ask for location or notification permission now — only when you use those features.', '건너뛰기': 'Skip', '시작하기': 'Get started',
  // 지역 화면
  '홈에 보일 지역을 하나 고르세요.': 'Choose one region to show on Home.', '홈 표시 지역': 'Home region', '홈 표시': 'On Home', '이 PC의 위치를 기준으로 조회해요': 'Uses this PC’s location',
  '지역은 이 PC에만 저장돼요. 인터넷이 없어도 이름 변경·삭제·홈 표시 지역 선택은 할 수 있어요.': 'Regions are saved on this PC only. Renaming, deleting and choosing the home region work offline.',
  '저장한 지역이 없어요. 날씨를 볼 지역을 추가해 주세요.': 'No saved regions. Add a region to see the weather.', '현재 위치 사용': 'Use current location', '누르면 위치를 쓰는 이유를 먼저 알려 드려요': 'We explain why before using your location',
  '지역 이름으로 검색': 'Search by region name', '지역 이름 검색': 'Region name search', '예: 역삼동, 분당구 정자동': 'e.g. 역삼동, 분당구 정자동', '서울특별시·경기도 지역을 지원해요.': 'Seoul and Gyeonggi are supported.',
  '동 이름이나 구 이름처럼 다른 검색어로 찾아보세요.': 'Try another search, like a dong or gu name.', '지원하지 않는 지역': 'Not supported', '‘현재 위치’는 이미 저장되어 있어요.': '“Current location” is already saved.',
  '지금 위치는 지원하는 지역(서울·경기)이 아니에요.': 'Your location is outside the supported area (Seoul/Gyeonggi).', '아래에서 지역을 직접 검색해 주세요.': 'Please search for a region below.',
  '위치를 확인하는 데 시간이 너무 걸려요.': 'Getting your location is taking too long.', '위치를 가져오지 못했어요. Windows 위치 서비스가 꺼져 있을 수 있어요.': 'Could not get your location. Windows location services may be off.',
  '위치 다시 시도': 'Retry location', '직접 검색하기': 'Search instead', '직접 검색': 'Search instead', '오프라인이라 지역을 찾을 수 없어요. 인터넷에 연결된 뒤 다시 시도해 주세요.': 'Offline, so regions cannot be searched. Try again when connected.',
  '원래 지역명': 'Original name', '홈과 목록에 보일 이름이에요. 비우면 원래 지역명을 써요.': 'Name shown on Home and in lists. Leave empty to use the original name.', '홈에 표시': 'Show on Home', '켜면 다른 지역의 홈 표시가 해제돼요.': 'Turning this on removes Home from the other region.',
  '이 지역 삭제': 'Delete this region', '이 지역은 이미 삭제됐어요.': 'This region was already deleted.', '남은 지역이 없어서 홈 날씨 영역이 빈 상태로 바뀌어요.': 'No regions remain, so the home weather area will be empty.',
  '홈 표시 지역으로 지정': 'Set as home region', '변경 내용 버리기': 'Discard changes', '저장하지 않은 변경 내용이 있어요. 버리고 나갈까요?': 'You have unsaved changes. Discard and leave?',
  '이 PC에 저장하지 못했어요. 기존 내용은 그대로예요.': 'Could not save on this PC. Nothing was changed.', '이 PC에 저장하지 못했어요. 다시 시도해 주세요.': 'Could not save on this PC. Please try again.', '이름을 바꿨어요.': 'Renamed.', '삭제했어요.': 'Deleted.', '저장했어요.': 'Saved.',
  // 위치 권한
  '위치 사용': 'Use location', '현재 지역의 날씨를 보여 주기 위해 위치를 한 번 확인해요.': 'We check your location once to show the local weather.', '주변 정류장·역·신호등을 찾기 위해 위치를 한 번 확인해요.': 'We check your location once to find nearby stops, stations and lights.',
  '정확한 위치는 이 PC 안에서만 쓰고, 서버·지표·피드백 어디에도 남기지 않아요.': 'Your exact location stays on this PC and is never stored in servers, metrics or feedback.', '위치 확인 중': 'Locating', '현재 위치를 가져오고 있어요…': 'Getting your location…',
  '위치를 쓸 수 없어요.': 'Location is unavailable.', 'Windows 위치 설정 열기': 'Open Windows location settings',
  '아래 검색창에서 직접 찾을 수 있어요. 위치를 다시 쓰려면 Windows 위치 설정을 켜거나, 앱 창 오른쪽 위 ⋯ 메뉴 → 사이트 권한에서 위치를 허용해 주세요.': 'You can search below instead. To use location again, turn on Windows location or allow it in the app window’s ⋯ menu → Site permissions.',
  // 교통 대상
  '교통 대상 삭제': 'Delete transit item', '교통 대상 편집': 'Edit transit item', '마지막으로 받은 정보도 함께 지워져요.': 'Its last saved data will be deleted too.', '대상 추가': 'Add item', '끌어서 순서 변경': 'Drag to reorder',
  '홈 교통 영역에 이 순서대로 보여요. 손잡이를 끌거나 위·아래 버튼으로 순서를 바꿀 수 있어요.': 'Items appear on Home in this order. Drag the handle or use the up/down buttons to reorder.',
  '모두 이 PC에만 저장돼요. 인터넷이 없어도 이름·순서 변경과 삭제는 할 수 있어요.': 'Everything is saved on this PC only. Renaming, reordering and deleting work offline.',
  '저장한 교통 대상이 없어요. 자주 타는 정류장·역, 출퇴근 경로, 지나는 신호등을 추가해 보세요.': 'No saved transit items. Add the stops, stations, commute routes or traffic lights you use.',
  '위로 옮겼어요': 'Moved up', '아래로 옮겼어요': 'Moved down', '순서를 바꿨어요': 'Reordered', '출발지·목적지 수정': 'Edit origin & destination',
  '어떤 대상을 추가할까요?': 'What do you want to add?', '버스 정류장': 'Bus stop', '지하철역': 'Subway station', '정류장의 노선별 버스 도착 정보를 봐요.': 'See bus arrivals by route at a stop.', '호선·방향별 다음 열차와 운행 지연을 봐요.': 'See next trains by line and direction, and delays.',
  '교차로 이름과 보행 신호 상태를 봐요.': 'See the intersection and pedestrian signal.', '출발지→목적지 대중교통 예상 소요 시간만 보여 줘요. 길 안내는 하지 않아요.': 'Shows only estimated transit time from origin to destination. No turn-by-turn directions.',
  '오프라인이라 새 대상을 찾을 수 없어요. 연결되면 다시 시도해 주세요.': 'Offline, so new items cannot be searched. Try again when connected.', '저장한 대상의 이름·순서 변경과 삭제는 목록에서 할 수 있어요.': 'You can still rename, reorder and delete saved items in the list.',
  '정류장·역·신호등 찾기': 'Find stops, stations & lights', '대상 종류': 'Item type', '주변에서 찾기': 'Find nearby', '이름·번호로 검색': 'Search by name or number', '주변에서 찾는 중…': 'Searching nearby…',
  '정류장 이름 또는 번호 (예: 강남역, 22009)': 'Stop name or number (e.g. 강남역, 22009)', '역 이름 (예: 강남, 서울역)': 'Station name (e.g. 강남, 서울역)', '교차로 이름 (예: 강남역 사거리)': 'Intersection name (e.g. 강남역 사거리)',
  '다른 검색어로 찾아보세요. 서울·경기 지역만 지원해요.': 'Try another search. Only Seoul and Gyeonggi are supported.', '이름이나 번호로 직접 검색해 보세요.': 'Try searching by name or number.', '이름이나 번호로 직접 검색해 주세요.': 'Please search by name or number.',
  '대략적인 위치라 주변 결과가 정확하지 않을 수 있어요. 직접 검색도 해 보세요.': 'Your location is approximate, so nearby results may be off. Try searching too.',
  '경로 추가': 'Add route', '저장한 경로는 홈에서 대중교통 예상 소요 시간만 보여 줘요. 지도나 길 안내는 제공하지 않아요.': 'Saved routes show only estimated transit time on Home. No map or directions.', '출발지': 'Origin', '목적지': 'Destination',
  '경로 이름 (선택)': 'Route name (optional)', '예: 출근길, 학원 가는 길': 'e.g. Commute, To the academy', '비워 두면 ‘출발지 → 목적지’로 보여요': 'Leave empty to show “Origin → Destination”', '장소·역·주소 이름': 'Place, station or address',
  '출발지와 목적지가 같아요. 목적지를 다른 곳으로 골라 주세요.': 'Origin and destination are the same. Pick a different destination.', '출발지와 목적지가 같아요.': 'Origin and destination are the same.',
  '같은 출발지·목적지 경로가 이미 있어요. 새로 만들지 않고 기존 경로를 그대로 둘게요.': 'A route with the same origin and destination already exists. Keeping the existing one.', '같은 출발지·목적지 경로가 이미 있어요. 저장하지 않았어요.': 'A route with the same origin and destination already exists. Not saved.',
  '경로를 저장했어요. 홈 교통 영역 맨 아래에 추가됐어요.': 'Route saved. Added to the bottom of Home transit.', '오프라인이라 경로를 검색·추가할 수 없어요. 연결되면 다시 시도해 주세요.': 'Offline, so routes cannot be searched or added. Try again when connected.',
  '오프라인이라 장소를 검색할 수 없어요.': 'Offline, so places cannot be searched.', '출발지·목적지 다시 지정': 'Set origin & destination again', '오프라인이라 출발지·목적지는 지금 바꿀 수 없어요. 이름 변경은 할 수 있어요.': 'Offline, so origin and destination cannot change now. You can still rename.',
  '홈에 보일 이름이에요. 비우면 원래 이름으로 돌아가요.': 'Name shown on Home. Leave empty to use the original name.', '이 대상 삭제': 'Delete this item', '이 대상은 이미 삭제됐어요.': 'This item was already deleted.',
  '이 경로는 외부 데이터에서 조회되지 않아요. 출발지·목적지를 다시 지정하거나 삭제해 주세요.': 'This route is not found in the data source. Set origin/destination again or delete it.', '이 대상은 외부 데이터에서 더 이상 조회되지 않아요. 삭제를 권해요.': 'This item is no longer in the data source. We suggest deleting it.',
  '이 PC에 저장하지 못했어요. 기존 목록과 순서는 그대로예요.': 'Could not save on this PC. The list and order are unchanged.',
  // 알림
  '알림 추가': 'Add alarm', '출발 알림 추가': 'Add departure alarm', '출발 알림 수정': 'Edit departure alarm', '알림 시각': 'Alarm time', '알림 이름': 'Alarm name', '예: 출근, 학원 가기': 'e.g. Work, Academy', '알림에 이 이름이 함께 표시돼요.': 'This name appears in the notification.',
  '오전': 'AM', '오후': 'PM', '시': 'Hour', '시 +1': 'Hour +1', '시 -1': 'Hour -1', '분 +1': 'Minute +1', '분 -1': 'Minute -1',
  '숫자를 눌러 직접 입력하거나, 숫자 위에서 마우스 휠을 돌려 1씩 바꿀 수 있어요.': 'Click a number to type it, or scroll the mouse wheel over it to change it by 1.',
  '반복 방식': 'Repeat', '한 번만': 'Once', '요일 반복': 'Weekly', '울릴 요일': 'Days', '요일 선택': 'Choose days', '요일을 하나 이상 골라 주세요.': 'Choose at least one day.', '알림 저장': 'Save alarm', '다음 알림: ': 'Next alarm: ',
  '평일 반복': 'Weekdays', '주말 반복': 'Weekends', '매일 반복': 'Every day', '월': 'Mon', '화': 'Tue', '수': 'Wed', '목': 'Thu', '금': 'Fri', '토': 'Sat', '일': 'Sun',
  '알림 삭제': 'Delete alarm', '알림을 삭제했어요.': 'Alarm deleted.', '삭제하지 못했어요. 다시 시도해 주세요.': 'Could not delete. Please try again.', '알림 허용': 'Allow notifications',
  '정한 출발 시각에 알려 드리려면 알림 권한이 필요해요. 다음 창에서 허용을 눌러 주세요.': 'To alert you at your departure time, notifications must be allowed. Click Allow in the next window.',
  '알림을 쓸 수 없어요': 'Notifications unavailable', '이 환경에서는 알림을 지원하지 않아요. 알림은 저장하지 않았어요.': 'Notifications are not supported here. The alarm was not saved.', '알림 권한이 없어 알림을 저장하지 않았어요.': 'No notification permission, so the alarm was not saved.',
  'Windows 알림 설정 열기': 'Open Windows notification settings', '알림이 꺼져 있어 출발 알림이 표시되지 않아요.': 'Notifications are off, so departure alarms will not show.',
  'Windows 알림 설정에서 Microsoft Edge 알림을 켜고, 앱 창 오른쪽 위 ⋯ 메뉴 → 사이트 권한에서 알림을 허용해 주세요.': 'Turn on Microsoft Edge in Windows notification settings, then allow notifications in the app window’s ⋯ menu → Site permissions.',
  '출발 시각을 정해 두면 그 시각에 알림을 보내 드려요. 알림을 누르면 바로 시각·날씨·교통을 확인할 수 있어요.': 'Set a departure time and you will get an alert then. Click it to see the time, weather and transit right away.',
  'Windows 버전에서는 앱이 열려 있을 때(최소화 포함) 알림이 표시돼요. 앱을 닫아 두면 알림이 오지 않아요.': 'On Windows, alarms show while the app is open (minimized is fine). They will not fire if the app is closed.',
  '알림을 저장·예약하지 못했어요. 입력한 내용은 그대로예요.': 'Could not save or schedule the alarm. Your input is kept.', '입력 내용 버리기': 'Discard input', '입력한 알림을 저장하지 않고 나갈까요?': 'Leave without saving this alarm?',
  '저장하지 않으면 기존 알림과 예약이 그대로 유지돼요. 버리고 나갈까요?': 'If you do not save, the existing alarm stays as it was. Discard and leave?', '출발할 시간이에요. 눌러서 시각·날씨·교통을 확인하세요.': 'Time to leave! Click to check the time, weather and transit.',
  // 피드백
  '피드백 유형': 'Feedback type', '오류': 'Bug', '요청': 'Request', '기타': 'Other', '보내기': 'Send', '오류 신고에는 아래 정보가 함께 전송돼요. 위치 정보는 보내지 않아요.': 'Bug reports include the info below. Location is never sent.',
  '어떤 점이 불편했는지, 무엇이 있었으면 좋겠는지 자유롭게 적어 주세요.': 'Tell us freely what bothered you or what you wish it had.', '오프라인이라 보내지 못했어요. 입력한 내용은 그대로 있어요.': 'Offline, so it was not sent. Your text is kept.',
  '입력한 내용은 그대로 있어요.': 'Your text is kept.', '피드백을 보냈어요. 고마워요!': 'Feedback sent. Thank you!', '작성 중인 내용 버리기': 'Discard draft', '입력한 피드백을 보내지 않고 나갈까요?': 'Leave without sending your feedback?',
};

/* ───────── 바뀌는 부분이 있는 문구 (정규식) ───────── */
const LINE = { 신분당선: 'Shinbundang Line', 수인분당선: 'Suin-Bundang Line', 경의중앙선: 'Gyeongui-Jungang Line', 공항철도: 'AREX', 경춘선: 'Gyeongchun Line', 경강선: 'Gyeonggang Line', 서해선: 'Seohae Line', 우이신설선: 'Ui-Sinseol Line' };
const tr = (s) => D[s] ?? LINE[s] ?? s;
const days = (s) => s.split('·').map((d) => D[d] || d).join('·');
const P = [
  [/^(\d+)호선$/, (m) => `Line ${m[1]}`],
  [/^정류소 (.+)$/, (m) => `Stop #${m[1]}`],
  [/^경기 ?(.*) · 정류소 (.+)$/, (m) => `Gyeonggi${m[1] ? ' ' + m[1] : ''} · Stop #${m[2]}`],
  [/^교차로 (.+)$/, (m) => `Intersection ${m[1]}`],
  [/^(.+) · 정류소 (.+)$/, (m) => `${m[1]} · Stop #${m[2]}`],
  [/^(.+) 방면$/, (m) => `toward ${m[1]}`],
  [/^(\d+)개$/, (m) => m[1]],
  [/^(\d+)분$/, (m) => `${m[1]} min`],
  [/^(\d+)초$/, (m) => `${m[1]}s`],
  [/^(\d+)시$/, (m) => `${m[1]}:00`],
  [/^(\d+)정류장 전$/, (m) => `${m[1]} stops away`],
  [/^(?:검색 )?결과 (\d+)개$/, (m) => `${m[1]} results`],
  [/^주변 결과 (\d+)개$/, (m) => `${m[1]} nearby`],
  [/^습도 (\d+)%$/, (m) => `Humidity ${m[1]}%`],
  [/^ · 강수확률 (\d+)%$/, (m) => ` · Rain ${m[1]}%`],
  [/^ · 걷기 약 (\d+)분$/, (m) => ` · ~${m[1]} min walk`],
  [/^ · 환승 (\d+)회$/, (m) => ` · ${m[1]} transfer${m[1] === '1' ? '' : 's'}`],
  [/^ \((.+) 지연\)$/, (m) => ` (${m[1]} delayed)`],
  [/^‘(.+)’을\(를\) 저장했어요\. 홈 교통 영역 맨 아래에 추가됐어요\.$/, (m) => `Saved “${m[1]}”. Added to the bottom of Home transit.`],
  [/^‘(.+)’을\(를\) 저장했어요\.$/, (m) => `Saved “${m[1]}”.`],
  [/^‘(.+)’ 검색 중…$/, (m) => `Searching “${m[1]}”…`],
  [/^‘(.+)’에 맞는 장소가 없어요\. 다른 검색어로 찾아보세요\.$/, (m) => `No places match “${m[1]}”. Try another search.`],
  [/^‘(.+)’에 맞는 지역이 없어요\.$/, (m) => `No regions match “${m[1]}”.`],
  [/^‘(.+)’에 맞는 (.+)이\(가\) 없어요\.$/, (m) => `No ${tr(m[2]).toLowerCase()} matches “${m[1]}”.`],
  [/^‘(.+)’은\(는\) 이미 저장되어 있어요\. 새로 만들지 않았어요\.$/, (m) => `“${m[1]}” is already saved. Nothing new was added.`],
  [/^‘(.+)’은\(는\) 이미 저장한 지역이에요\. 새로 만들지 않았어요\.$/, (m) => `“${m[1]}” is already a saved region. Nothing new was added.`],
  [/^‘(.+)’ 지역을 삭제할까요\?$/, (m) => `Delete the region “${m[1]}”?`],
  [/^‘(.+)’을\(를\) 삭제할까요\?$/, (m) => `Delete “${m[1]}”?`],
  [/^‘(.+)’ 알림을 삭제할까요\? 예약도 함께 지워져요\.$/, (m) => `Delete the alarm “${m[1]}”? Its schedule is removed too.`],
  [/^주변에서 (.+)을\(를\) 찾지 못했어요\.$/, (m) => `No ${tr(m[1]).toLowerCase()} found nearby.`],
  [/^홈 표시 지역은 ‘(.+)’\(으\)로 바뀌어요\.$/, (m) => `The home region will change to “${m[1]}”.`],
  [/^다음 알림 (.+)$/, (m) => `Next ${m[1]}`],
  [/^버전 (.+)$/, (m) => `Version ${m[1]}`],
  [/^앱 버전 (.+) · (.+)$/, (m) => `App version ${m[1]} · ${m[2]}`],
  [/^외 (\d+)개 · 교통 탭에서 모두 보기$/, (m) => `${m[1]} more · see all in the Transit tab`],
  [/^외 (.+)$/, (m) => `+ ${m[1].split('·').map(tr).join(', ')}`],
  [/^원래 이름: (.+)$/, (m) => `Original name: ${m[1]}`],
  [/^저장됨 · (\d+)개$/, (m) => `Saved · ${m[1]}`],
  [/^저장됨 · (.+)$/, (m) => `Saved · ${m[1] === '지역' ? 'Region' : m[1]}`],
  [/^저장한 (.+) 대상이 없어요\.$/, (m) => `No saved ${tr(m[1]).toLowerCase()} items.`],
  [/^조회 불가 (\d+)$/, (m) => `${m[1]} unavailable`],
  [/^현재 위치 · (.+)$/, (m) => `Current location · ${m[1]}`],
  [/^홈 표시: (.+)$/, (m) => `On Home: ${m[1]}`],
  [/^(.+) 반복$/, (m) => `Every ${days(m[1])}`],
  [/^(오늘은 이미 지난 시각이라 |오늘 시각은 이미 지나서 )?(오늘|내일|이번 (.)요일|다음 주 (.)요일) (.+)에 예약했어요\.$/, (m) => {
    const when = m[3] ? `this ${D[m[3]]}` : m[4] ? `next ${D[m[4]]}` : D[m[2]];
    return `${m[1] ? 'That time already passed today, so it is ' : ''}${m[1] ? 's' : 'S'}cheduled for ${when} at ${m[5]}.`;
  }],
  [/^(.+) 탭에서 자세히 보기$/, (m) => `See details in the ${tr(m[1])} tab`],
  [/^(.+) 이름 변경$/, (m) => `Rename ${m[1]}`],
  [/^(.+) 편집 화면$/, (m) => `Edit ${m[1]}`],
  [/^(.+) 삭제$/, (m) => `Delete ${m[1]}`],
  [/^(.+) 수정$/, (m) => `Edit ${m[1]}`],
  [/^(.+) 위로$/, (m) => `Move ${m[1]} up`],
  [/^(.+) 아래로$/, (m) => `Move ${m[1]} down`],
  [/^(.+) 켜기$/, (m) => `Turn on ${m[1]}`],
];

const HANGUL = /[가-힣]/;
export function t(s) {
  if (prefs.lang !== 'en' || typeof s !== 'string' || !HANGUL.test(s)) return s;
  if (D[s] !== undefined) return D[s];
  if (LINE[s]) return LINE[s];
  for (const [re, fn] of P) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  return s;
}
