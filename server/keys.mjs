// API_KEYS.bat 에서 키를 읽는다. 두 가지 줄 모양을 모두 알아본다:
//   ① 서비스 이름 : 키      예) 지하철 : abcd1234…    또는    국토교통부_(TAGO)_지하철정보 : abcd1234…
//   ② set 이름=키           (예전 방식. 그대로 동작)
// 파일이 바뀌면 다음 요청부터 바로 반영된다 (앱을 다시 켤 필요 없음).
// 서비스 줄을 비워 두면 다른 줄에 넣은 data.go.kr 키를 대신 쓴다 (data.go.kr 일반 인증키는 서비스마다 같음).
import { readFileSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

// GitHub에서 새로 받은 경우 API_KEYS.bat이 없으니, 빈 예시 파일을 복사해 둔다.
export function ensureKeysFile(root) {
  const file = join(root, 'API_KEYS.bat');
  const example = join(root, 'API_KEYS.example.bat');
  try { if (!existsSync(file) && existsSync(example)) copyFileSync(example, file); } catch { /* 무시 */ }
}

// 키를 받는 곳마다 한 줄. label = 파일에 적어 두는 이름(그 사이트에서 신청하는 서비스 이름), match = 줄 이름에서 알아보는 낱말.
// (낱말은 공백·밑줄·괄호를 뺀 소문자로 비교한다. 위에 있는 서비스부터 맞춰 본다.)
export const SERVICES = [
  { id: 'WEATHER_KEY', short: '날씨', label: '기상청_단기예보 ((구)_동네예보) 조회서비스', site: 'data.go.kr', match: ['날씨', '기상청', '단기예보', '동네예보'] },
  { id: 'STOP_GG_KEY', short: '경기 정류장', label: '경기도_정류소 조회', site: 'data.go.kr', match: ['경기정류', '경기도정류'] },
  { id: 'BUS_GG_KEY', short: '경기 버스', label: '경기도_버스도착정보 조회', site: 'data.go.kr', match: ['경기버스', '경기도버스'] },
  { id: 'BUS_SEOUL_KEY', short: '서울 버스', label: '서울특별시_정류소정보조회 서비스', site: 'data.go.kr', match: ['서울버스', '서울시버스', '서울특별시정류', '서울특별시버스', '서울정류'] },
  { id: 'BUS_TAGO_KEY', short: '버스', label: '국토교통부_(TAGO)_버스도착정보 · 버스정류소정보', site: 'data.go.kr', match: ['버스'] },
  { id: 'SUBWAY_TAGO_KEY', short: '지하철', label: '국토교통부_(TAGO)_지하철정보', site: 'data.go.kr', match: ['지하철'] },
  { id: 'SIGNAL_KLID_KEY', short: '신호등', label: '행정안전부 한국지역정보개발원_(전국 통합데이터) 교통안전 신호등 실시간 정보', site: 'data.go.kr', match: ['신호등', '교통안전', '한국지역정보개발원'] },
  { id: 'KAKAO_REST_KEY', short: '카카오', label: '카카오 REST API 키', site: 'developers.kakao.com', match: ['카카오', 'kakao'] },
];
// data.go.kr 에서 받는 키 (일반 인증키 하나를 서비스마다 신청해서 쓰는 것들)
export const PORTAL_IDS = SERVICES.filter((s) => s.site === 'data.go.kr').map((s) => s.id);

export const KEY_NAMES = ['DATA_GO_KR_KEY', 'SEOUL_OPENAPI_KEY', 'ODSAY_KEY', 'TDATA_KEY', ...SERVICES.map((s) => s.id)];

const norm = (s) => s.toLowerCase().replace(/[\s_()\[\]\-·.,]/g, '');
export function serviceFor(label) {
  const n = norm(label);
  for (const s of SERVICES) if (s.match.some((m) => n.includes(norm(m)))) return s.id;
  return null;
}

// 키 칸에 [대괄호]나 "따옴표"를 붙여 넣어도 알아서 벗기고, 두 개 이상 붙여 넣으면 첫 번째만 쓴다.
// 한글이 들어 있으면(예: "여기에 키 붙여넣기") 아직 안 넣은 칸으로 본다.
export function cleanKey(v = '') {
  const t = v.replace(/^[\s\[\("'「]+|[\s\]\)"'」]+$/g, '').split(/[\s,;]+/)[0] || '';
  if (/[가-힣]/.test(t) || /^(api)?-?key$/i.test(t)) return '';
  return t.replace(/^[\[\("']+|[\]\)"']+$/g, '');
}

// 메모장은 한글을 UTF-8이나 CP949(ANSI)로 저장한다. 둘 다 읽는다.
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch { return new TextDecoder('euc-kr').decode(buf); }
}

const SKIP = /^\s*(rem\b|::|@|echo\b|if\b|start\b|exit\b|goto\b|powershell\b|chcp\b)/i;
let cached = { file: '', mtime: -1, keys: {} };

export function parseKeys(text) {
  const keys = {};
  for (const line of text.split(/\r?\n/)) {
    const ms = line.match(/^\s*set\s+"?([A-Za-z0-9_]+)=([^"\r\n]*)"?\s*$/i);
    if (ms) {
      const name = ms[1].toUpperCase();
      const v = cleanKey(ms[2]);
      if (KEY_NAMES.includes(name) && v) keys[name] = v;
      continue;
    }
    if (SKIP.test(line)) continue;
    const m = line.match(/^\s*(.+?)\s*[:：]\s*(.*?)\s*$/);
    if (!m) continue;
    const id = serviceFor(m[1]);
    const v = cleanKey(m[2]);
    if (id && v) keys[id] = v;
  }
  // '버스' 한 줄이 서울·경기 버스 서비스의 키도 된다 (그 줄이 따로 있으면 그 줄이 우선).
  for (const id of ['BUS_SEOUL_KEY', 'BUS_GG_KEY', 'STOP_GG_KEY']) if (!keys[id] && keys.BUS_TAGO_KEY) keys[id] = keys.BUS_TAGO_KEY;
  // 빈 서비스 줄은 채워진 다른 data.go.kr 키로 메운다. DATA_GO_KR_KEY = "키가 하나라도 있다"는 표시이기도 하다.
  const general = keys.DATA_GO_KR_KEY || PORTAL_IDS.map((id) => keys[id]).find(Boolean);
  if (general) {
    keys.DATA_GO_KR_KEY = general;
    for (const id of PORTAL_IDS) keys[id] = keys[id] || general;
  }
  return keys;
}

export function readKeys(root) {
  const file = join(root, 'API_KEYS.bat');
  let keys = {};
  try {
    const st = statSync(file);
    if (cached.file === file && cached.mtime === st.mtimeMs) {
      keys = cached.keys;
    } else {
      keys = parseKeys(decode(readFileSync(file)));
      cached = { file, mtime: st.mtimeMs, keys };
    }
  } catch {
    keys = {};
  }
  const out = { ...keys };
  for (const name of KEY_NAMES) if (process.env[name]) out[name] = process.env[name];
  return out;
}
