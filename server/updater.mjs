// GitHub에서 새 버전 받기 (https://github.com/Archenied/prototype)
// 1) raw version.json으로 새 버전이 있는지 본다 (1분에 한 번)
// 2) 업데이트를 누르면: 최신 커밋의 파일 목록을 받아, 바뀐 파일만 내려받고 (git 지문으로 확인),
//    임시 폴더에 다 받은 뒤 한꺼번에 바꿔 넣는다. version.json은 맨 마지막에 바꾼다.
// API_KEYS.bat, data/, 기획 문서 등 이 PC에만 있는 파일은 절대 건드리지 않는다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

export const REPO = 'Archenied/prototype';
export const BRANCH = 'main';
const UA = { 'User-Agent': 'prototype-twt-updater', Accept: 'application/vnd.github+json' };

// 업데이트로 바꿔도 되는 파일만 (이 밖의 파일은 받지도 지우지도 않음)
const MANAGED_DIRS = ['web/', 'server/', 'launcher/'];
const MANAGED_FILES = ['version.json', 'README.md', 'BUILD.bat', 'API_KEYS.example.bat', 'Prototype.exe', '.gitignore'];
const isManaged = (p) => MANAGED_DIRS.some((d) => p.startsWith(d)) || MANAGED_FILES.includes(p);

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

let remoteCache = { at: 0, value: null };
// GitHub에 올라간 version.json (실패하면 null — 인터넷이 없거나 GitHub가 응답 없음)
export async function remoteRelease() {
  if (Date.now() - remoteCache.at < 60e3) return remoteCache.value;
  let value = null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/version.json?t=${Date.now()}`, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      value = { version: String(j.version || '0'), notes: Array.isArray(j.notes) ? j.notes.map(String).slice(0, 8) : [] };
    }
  } catch { /* 오프라인 */ }
  remoteCache = { at: Date.now(), value };
  return value;
}

// git이 파일마다 쓰는 지문: sha1("blob <크기>\0" + 내용)
function gitBlobSha(buf) {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function listLocal(root, dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) listLocal(root, rel, out);
    else out.push(rel);
  }
  return out;
}

async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

// 반환: { version, changed: [...], removed: [...] }
export async function downloadUpdate(root, log = () => {}) {
  const commit = await getJSON(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`);
  const sha = commit.sha;
  const tree = await getJSON(`https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`);
  if (tree.truncated) throw new Error('file list too long');
  const remote = tree.tree.filter((e) => e.type === 'blob' && isManaged(e.path));
  if (!remote.some((e) => e.path === 'version.json')) throw new Error('no version.json in repo');

  const staging = join(root, 'data', 'update-staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  // 바뀐 파일만 내려받기
  const changed = [];
  for (const e of remote) {
    const local = join(root, e.path);
    if (existsSync(local) && gitBlobSha(readFileSync(local)) === e.sha) continue;
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${e.path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`download ${e.path}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (gitBlobSha(buf) !== e.sha) throw new Error(`checksum mismatch: ${e.path}`);
    const dest = join(staging, e.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    changed.push(e.path);
  }

  // 다 받았으면 바꿔 넣기 (version.json은 마지막)
  const order = [...changed.filter((p) => p !== 'version.json'), ...changed.filter((p) => p === 'version.json')];
  for (const p of order) {
    const dest = join(root, p);
    mkdirSync(dirname(dest), { recursive: true });
    if (p === 'Prototype.exe' && existsSync(dest)) {
      // 실행 중인 exe는 덮어쓸 수 없지만 이름은 바꿀 수 있다. 옛 파일은 다음 실행 때 지워진다.
      const old = join(root, 'Prototype.old.exe');
      rmSync(old, { force: true });
      renameSync(dest, old);
    }
    copyFileSync(join(staging, p), dest);
  }

  // GitHub에서 지운 파일은 여기서도 지우기 (web/·server/·launcher/ 안에서만)
  const remoteSet = new Set(remote.map((e) => e.path));
  const removed = [];
  for (const d of MANAGED_DIRS) {
    for (const rel of listLocal(root, d.slice(0, -1))) {
      if (!remoteSet.has(rel)) { rmSync(join(root, rel), { force: true }); removed.push(rel); }
    }
  }
  rmSync(staging, { recursive: true, force: true });
  const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8').replace(/^﻿/, '')).version;
  log(`update downloaded: ${version} (${changed.length} changed, ${removed.length} removed, commit ${sha.slice(0, 7)})`);
  void relative; void sep;
  return { version, changed, removed };
}
