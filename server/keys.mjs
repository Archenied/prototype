// API_KEYS.bat 안의 `set 이름=값` 줄에서 키를 읽는다.
// 파일이 바뀌면 다음 요청부터 바로 반영된다 (앱을 다시 켤 필요 없음).
import { readFileSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

// GitHub에서 새로 받은 경우 API_KEYS.bat이 없으니, 빈 예시 파일을 복사해 둔다.
export function ensureKeysFile(root) {
  const file = join(root, 'API_KEYS.bat');
  const example = join(root, 'API_KEYS.example.bat');
  try { if (!existsSync(file) && existsSync(example)) copyFileSync(example, file); } catch { /* 무시 */ }
}

export const KEY_NAMES = ['DATA_GO_KR_KEY', 'SEOUL_OPENAPI_KEY', 'KAKAO_REST_KEY', 'ODSAY_KEY', 'TDATA_KEY'];

let cached = { file: '', mtime: -1, keys: {} };

export function readKeys(root) {
  const file = join(root, 'API_KEYS.bat');
  let keys = {};
  try {
    const st = statSync(file);
    if (cached.file === file && cached.mtime === st.mtimeMs) {
      keys = cached.keys;
    } else {
      // 키는 영문·숫자·기호만 쓰므로 latin1로 읽어도 안전하다 (주석의 한글은 무시).
      const text = readFileSync(file, 'latin1');
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*set\s+"?([A-Za-z0-9_]+)=([^"\r\n]*)"?\s*$/i);
        // 키를 두 개(예: Encoding, Decoding) 붙여 넣은 경우에도 첫 번째 키만 쓴다.
        if (m && KEY_NAMES.includes(m[1].toUpperCase())) keys[m[1].toUpperCase()] = m[2].trim().split(/[\s,;]+/)[0];
      }
      cached = { file, mtime: st.mtimeMs, keys };
    }
  } catch {
    keys = {};
  }
  const out = { ...keys };
  for (const name of KEY_NAMES) if (process.env[name]) out[name] = process.env[name];
  return out;
}
