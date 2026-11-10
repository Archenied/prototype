// 외부 API 실패를 화면이 구분할 수 있는 원인 유형으로 바꾼다 (R-19).
// kind: offline(네트워크 없음) · timeout(시간 초과) · service(서비스 오류) · quota(호출 한도 초과) · notfound(조회 불가)
export class ApiError extends Error {
  constructor(kind, detail = '') {
    super(kind + (detail ? ': ' + detail : ''));
    this.kind = kind;
    this.detail = detail; // 'key' = API 키 문제 (사용자에게 키 확인 안내)
  }
}

export const STATUS_BY_KIND = { offline: 503, timeout: 504, service: 502, quota: 429, notfound: 404, badrequest: 400 };

const OFFLINE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

// fetch()가 던진 예외를 원인 유형으로 분류한다.
export function fromFetchError(err) {
  if (err instanceof ApiError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new ApiError('timeout');
  const code = err?.cause?.code || err?.code;
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return new ApiError('timeout');
  if (OFFLINE_CODES.has(code)) return new ApiError('offline');
  return new ApiError('service');
}
