// 인터넷 표준 시각(NTP) 재기. 기기 시계와 얼마나 다른지(offset, ms)를 구한다.
// 여러 서버에 물어서 왕복 시간이 가장 짧은(가장 정확한) 답을 쓴다.
import dgram from 'node:dgram';

const SERVERS = ['time.google.com', 'time.windows.com', 'pool.ntp.org', 'time.cloudflare.com'];
const NTP_EPOCH = 2208988800; // 1900 → 1970 (초)

function readTs(buf, at) {
  const sec = buf.readUInt32BE(at);
  const frac = buf.readUInt32BE(at + 4);
  return (sec - NTP_EPOCH) * 1000 + (frac / 2 ** 32) * 1000;
}

export function queryNtp(host, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const pkt = Buffer.alloc(48);
    pkt[0] = 0x23; // LI 0, 버전 4, 클라이언트 모드
    let t0 = 0;
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, timeoutMs);
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.on('message', (msg) => {
      const t3 = Date.now();
      clearTimeout(timer);
      sock.close();
      if (msg.length < 48 || (msg[0] & 0x07) !== 4 || msg[1] === 0) return reject(new Error('bad reply'));
      const t1 = readTs(msg, 32); // 서버가 받은 시각
      const t2 = readTs(msg, 40); // 서버가 보낸 시각
      resolve({ host, offset: ((t1 - t0) + (t2 - t3)) / 2, rtt: (t3 - t0) - (t2 - t1) });
    });
    t0 = Date.now();
    sock.send(pkt, 123, host, (e) => { if (e) { clearTimeout(timer); sock.close(); reject(e); } });
  });
}

let last = null; // { offset, rtt, host, at }
let running = null;

/** 기기 시계 보정값. 2분 안에 잰 값이 있으면 재사용한다. 실패하면 마지막 값(없으면 null). */
export async function ntpOffset() {
  if (last && Date.now() - last.at < 120e3) return last;
  if (!running) {
    running = Promise.allSettled(SERVERS.map((s) => queryNtp(s))).then((rs) => {
      const ok = rs.filter((r) => r.status === 'fulfilled').map((r) => r.value).sort((a, b) => a.rtt - b.rtt);
      if (ok.length) last = { ...ok[0], at: Date.now() };
      return last;
    }).finally(() => { running = null; });
  }
  return running;
}
