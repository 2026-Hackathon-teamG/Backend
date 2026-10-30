/** 화면 모듈 공용: DOM 헬퍼, 이스케이프, 라벨, 화면 상태 */
import type {
  ActorRole, ActorStatus, BreachKind, DashboardState, EventType, Phase, RoundStatus, RuleStatus, Tactic, TechState
} from '../types';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다`);
  return el as T;
}

/** 서버·LLM이 만든 문자열은 innerHTML 에 넣기 전 반드시 거친다 */
export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export const num = (v: number | null | undefined, d = '—'): string => (v === null || v === undefined ? d : String(v));
export const fmtFit = (f: number | null | undefined): string => (f === null || f === undefined ? '—' : f.toFixed(2));
export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

export const LABEL: Record<EventType, string> = {
  recon: '정찰 AI', attack: '공격 AI', decoy_hit: '미끼 접촉', cluster: '주체 묶음', breach: '침투 감지',
  analysis: '방어 AI', rule_applied: '룰 적용', verify: '재공격 검증', end: '종료'
};
export const KIND: Record<BreachKind, string> = { session: '세션 탈취', enumeration: '계정 열거', mfa: 'MFA 승인', data: '데이터 수집' };
export const PHASE: Record<Phase, string> = {
  idle: '대기', attack: '공격 진행 중', breach: '침투 발생', rule_generated: '방어 룰 생성 중',
  rule_applied: '룰 적용됨', verified: '재공격 차단 확인', done: '훈련 종료'
};
export const RULE_STATUS: Record<RuleStatus, string> = { generated: '생성됨', applied: '적용됨', verified: '차단 검증됨' };
export const ROUND_STATUS: Record<RoundStatus, string> = { pending: '대기', running: '진행 중', verified: '차단 검증' };
export const CELL_LABEL: Record<TechState, string> = { breach: '침투 · 침투 성공', near: '위험 근접 · 아직 실패', defended: '방어', untested: '미테스트' };
export const ROLE: Record<ActorRole, string> = { attack: '공격', recon: '정찰' };
export const ACTOR_STATUS: Record<ActorStatus, string> = { observing: '관찰 중', isolated: '격리' };
export const TACTIC_FALLBACK: Tactic[] = [
  { id: 'recon', name: '정찰' }, { id: 'credential', name: '인증 공격' },
  { id: 'evasion', name: '탐지 회피' }, { id: 'post', name: '탈취 이후' }
];

export const label = <K extends string>(map: Record<K, string>, key: string | null | undefined): string =>
  key ? (map as Record<string, string>)[key] ?? key : '';

/** 타임라인 필터: all | red | blue | system | actor:<id> */
export type Filter = 'all' | 'red' | 'blue' | 'system' | `actor:${string}`;

export const view = {
  state: null as DashboardState | null,
  filter: 'all' as Filter,
  /** 상세창에 띄운 기법 */
  selected: null as string | null,
  /** 타임라인에 그린 마지막 이벤트 번호 */
  lastSeq: 0,
  prevTech: new Map<string, TechState>(),
  prevRuleIds: null as string[] | null,
  keys: new Map<string, string>()
};

/** 같은 값이면 false → 다시 그리지 않음 (폴링마다 포커스·스크롤이 날아가는 것 방지) */
export function changed(name: string, value: unknown): boolean {
  const k = JSON.stringify(value);
  if (view.keys.get(name) === k) return false;
  view.keys.set(name, k);
  return true;
}
