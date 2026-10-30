/**
 * 은행 화면 설정
 * URL 파라미터로 덮어쓸 수 있음:
 *   ?mode=mock                          → 백엔드 없이 목업
 *   ?mode=live&api=http://10.0.0.5:8000 → 다른 주소의 게이트웨이에 붙기
 *   mode 생략(auto) → 백엔드 호출, 안 되면 목업으로 대체
 *   ?stepup=1                           → 목업에서도 로그인마다 추가 인증 요구
 */
export type Mode = 'auto' | 'live' | 'mock';

export interface Config {
  apiBase: string;
  mode: Mode;
  mockStepUp: boolean;
}

function load(): Config {
  // 게이트웨이를 거쳐 열리므로 기본은 같은 주소
  let apiBase: string = import.meta.env.VITE_API_BASE || '';
  let mode: Mode = 'auto';

  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  if (m === 'auto' || m === 'live' || m === 'mock') mode = m;
  const api = q.get('api');
  if (api) apiBase = api.replace(/\/$/, '');

  return { apiBase, mode, mockStepUp: q.get('stepup') === '1' };
}

export const config = load();
