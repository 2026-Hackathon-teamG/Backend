/**
 * 데이터 소스
 * - LiveSource: GET {apiBase}/api/state 폴링, POST {apiBase}/api/control 로 재생 제어
 * - MockSource: 브라우저 안에서 5라운드 시나리오 재생
 * 화면 코드는 어느 쪽인지 몰라도 같은 DashboardState 를 받는다.
 */
import type { AppConfig } from './config';
import type { ControlAction, DashboardState } from './types';
import { buildState, nextRoundStep, TOTAL_STEPS } from './mock/buildState';

export interface DataSource {
  readonly kind: 'live' | 'mock';
  /** 화면에 표시할 연결 대상 */
  readonly label: string;
  /** 폴링 간격(ms) */
  readonly pollMs: number;
  getState(): Promise<DashboardState>;
  control(action: ControlAction): Promise<void>;
}

const TIMEOUT_MS = 3000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('응답 시간 초과');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class LiveSource implements DataSource {
  readonly kind = 'live' as const;
  readonly label: string;

  constructor(private readonly apiBase: string, readonly pollMs: number) {
    this.label = apiBase ? apiBase.replace(/^https?:\/\//, '') : location.host;
  }

  getState(): Promise<DashboardState> {
    return fetchJson<DashboardState>(`${this.apiBase}/api/state`);
  }

  async control(action: ControlAction): Promise<void> {
    await fetchJson<unknown>(`${this.apiBase}/api/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  }
}

export class MockSource implements DataSource {
  readonly kind = 'mock' as const;
  readonly label = '샘플 데이터';
  readonly pollMs = 250;
  private step = TOTAL_STEPS; // 처음엔 결과 화면
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly stepMs: number) {}

  getState(): Promise<DashboardState> {
    return Promise.resolve(buildState(this.step));
  }

  control(action: ControlAction): Promise<void> {
    this.stop();
    switch (action) {
      case 'play':
        this.step = 0;
        this.timer = setInterval(() => {
          this.step += 1;
          if (this.step >= TOTAL_STEPS) { this.step = TOTAL_STEPS; this.stop(); }
        }, this.stepMs);
        break;
      case 'next': this.step = Math.min(TOTAL_STEPS, this.step + 1); break;
      case 'next_round': this.step = nextRoundStep(this.step); break;
      case 'end': this.step = TOTAL_STEPS; break;
      case 'reset': this.step = 0; break;
    }
    return Promise.resolve();
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

/** auto 모드: 백엔드가 응답하면 live, 아니면 목업 */
export async function createSource(cfg: AppConfig): Promise<DataSource> {
  const mock = new MockSource(cfg.mockStepMs);
  if (cfg.mode === 'mock') return mock;
  const live = new LiveSource(cfg.apiBase, cfg.pollMs);
  if (cfg.mode === 'live') return live; // 끊겨 있어도 계속 재시도하며 오류 표시
  try {
    await live.getState();
    return live;
  } catch (e) {
    console.warn('[redi] 백엔드 연결 실패, 목업으로 전환:', (e as Error).message);
    return mock;
  }
}
