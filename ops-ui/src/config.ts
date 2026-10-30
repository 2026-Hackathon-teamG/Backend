/**
 * 실행 설정
 * 우선순위: URL 파라미터 > .env(.local) 의 VITE_* > 기본값
 *   ?mode=mock                       백엔드 없이 목업 재생
 *   ?mode=live&api=http://192.168.0.10:8000
 */
export type DataMode = 'auto' | 'live' | 'mock';

export interface AppConfig {
  mode: DataMode;
  /** 비우면 같은 주소의 /api (dev·preview 에서는 vite 프록시가 백엔드로 넘김) */
  apiBase: string;
  pollMs: number;
  mockStepMs: number;
}

function asMode(v: string | null | undefined): DataMode | null {
  return v === 'auto' || v === 'live' || v === 'mock' ? v : null;
}

function asInt(v: string | null | undefined, fallback: number, min: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export function loadConfig(): AppConfig {
  const q = new URLSearchParams(location.search);
  const env = import.meta.env;
  return {
    mode: asMode(q.get('mode')) ?? asMode(env.VITE_DATA_MODE) ?? 'auto',
    apiBase: (q.get('api') ?? env.VITE_API_BASE ?? '').replace(/\/+$/, ''),
    pollMs: asInt(q.get('poll') ?? env.VITE_POLL_MS, 1000, 250),
    mockStepMs: asInt(q.get('speed') ?? env.VITE_MOCK_STEP_MS, 900, 100)
  };
}
