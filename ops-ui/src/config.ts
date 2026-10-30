/**
 * 관제 화면 설정
 * URL 파라미터로 덮어쓸 수 있음:
 *   ?mode=mock                          → 백엔드 없이 목업 시뮬레이션
 *   ?mode=live&api=http://10.0.0.5:8002 → 다른 주소의 detector에 붙기
 *   mode 생략(auto) → detector 연결 시도, 실패하면 목업으로 대체
 */
export type Mode = 'auto' | 'live' | 'mock';

export interface Config {
  apiBase: string;
  wsUrl: string;
  mode: Mode;
  probeTimeoutMs: number;   // auto 모드에서 detector 확인 대기
  mockStepMs: number;       // 목업 요청 간격
  maxLogRows: number;       // 로그에 남길 최대 줄 수
}

function load(): Config {
  // detector 관제 API. 빌드 시 VITE_API_BASE로 고정할 수 있고, 아니면 화면을 연 호스트의 8002 포트
  let apiBase: string = import.meta.env.VITE_API_BASE || `${location.protocol}//${location.hostname}:8002`;
  let mode: Mode = 'auto';
  let mockStepMs = 650;

  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  if (m === 'auto' || m === 'live' || m === 'mock') mode = m;
  const api = q.get('api');
  if (api) apiBase = api.replace(/\/$/, '');
  const step = q.get('step');
  if (step) mockStepMs = Math.max(50, parseInt(step, 10) || mockStepMs);

  return {
    apiBase,
    wsUrl: apiBase.replace(/^http/, 'ws') + '/ops/stream',
    mode,
    probeTimeoutMs: 1500,
    mockStepMs,
    maxLogRows: 800,
  };
}

export const config = load();
