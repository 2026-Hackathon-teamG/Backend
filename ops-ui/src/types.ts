/**
 * 백엔드와의 계약: GET /api/state 응답 타입
 * 백엔드 팀원은 이 파일과 stub/sample-state.json 을 기준으로 응답을 만들면 된다.
 * `?` 가 붙은 필드는 선택이며, 없어도 화면이 깨지지 않는다.
 */

export type Phase = 'idle' | 'attack' | 'breach' | 'rule_generated' | 'rule_applied' | 'verified' | 'done';
export type RiskLevel = 'CRITICAL' | 'MEDIUM' | 'LOW' | 'SECURE';
export type TechState = 'breach' | 'near' | 'defended' | 'untested';
export type TacticId = 'recon' | 'credential' | 'evasion' | 'post';
/** session: 세션 획득 / enumeration: 계정 존재 식별 / mfa: MFA 승인 받음 / data: 실제 데이터 수집 */
export type BreachKind = 'session' | 'enumeration' | 'mfa' | 'data';
export type Side = 'red' | 'blue' | 'system';
export type EventType =
  | 'recon' | 'attack' | 'decoy_hit' | 'cluster' | 'breach'
  | 'analysis' | 'rule_applied' | 'verify' | 'end';
export type RuleStatus = 'generated' | 'applied' | 'verified';
export type RoundStatus = 'pending' | 'running' | 'verified';
export type ActorRole = 'attack' | 'recon';
export type ActorStatus = 'observing' | 'isolated';
export type ControlAction = 'play' | 'next' | 'next_round' | 'end' | 'reset';

/** 위치 (지구본용). IP 위치 조회 결과를 그대로 넣으면 된다 */
export interface Geo {
  lat: number;
  lon: number;
  city?: string;
  /** ISO 3166-1 alpha-2 (예: KR, NL) */
  country?: string;
}

export interface Scenario {
  id: string;
  title?: string;
  target?: string;
  /** 공격 대상 서버 위치. 없으면 서울로 그린다 */
  target_geo?: Geo;
}

export interface Kpi {
  /** 공격 + 재공격 검증 */
  total_attempts: number;
  attack_attempts: number;
  /** 침투 판정 건수 (종류 무관) */
  breaches: number;
  breach_by_kind?: Partial<Record<BreachKind, number>>;
  /** 탈취된 서로 다른 계정 수 */
  accounts_compromised?: number;
  /** breaches / attack_attempts × 100 */
  breach_rate: number;
  rules_applied: number;
  reattack_total: number;
  reattack_blocked: number;
  actors?: number;
  actors_isolated?: number;
}

export interface Tactic {
  id: TacticId | string;
  name: string;
}

export interface Technique {
  id: string;
  tactic?: TacticId | string;
  name: string;
  name_ko?: string;
  state: TechState;
  /** 1.0 침투 성공, 0.8~0.99 부분 성공, 0.5 시도 중 실패, 0 재공격 모두 차단, null 미테스트 */
  fitness: number | null;
  fitness_peak?: number;
  attempts: number;
  blocked: number;
  partial: number;
  breached: number;
  rule_id?: string | null;
  note?: string;
  detail?: { how?: string; why?: string; rule?: string | null };
}

export interface Actor {
  id: string;
  role: ActorRole;
  /** 화면에는 앞 5개 + "+N" */
  ips: string[];
  ip_count?: number;
  fingerprints?: number;
  /** 같은 주체로 묶은 행동 유사도 (0.85 기준) */
  similarity?: number | null;
  /** 묶은 근거 */
  signals?: string[];
  status: ActorStatus;
  /** 분업 관계면 상위 주체 ID */
  linked_to?: string | null;
}

export interface Rule {
  id: string;
  round: number;
  technique: string;
  title: string;
  reason: string;
  rule: Record<string, unknown>;
  status: RuleStatus;
  reattack_total: number | null;
  reattack_success: number | null;
  false_positive: number | null;
}

export interface RediEvent {
  /** 단조 증가. 프론트는 새 seq만 추가로 그린다 (줄어들면 초기화로 판단) */
  seq: number;
  time: string;
  round: number;
  side: Side;
  type: EventType;
  actor_id?: string | null;
  technique?: string | null;
  breach_kind?: BreachKind | null;
  src_ip?: string | null;
  /** 출발지 위치. 한 이벤트가 IP 여러 개로 나갔으면 여러 개 (없으면 지구본에 안 그림) */
  src_geo?: Geo[] | null;
  request?: string | null;
  status?: string | null;
  /** 공격 AI의 판단 한 줄 */
  thought?: string | null;
  /** 시스템·방어 AI 메시지 */
  message?: string | null;
}

export interface Round {
  round: number;
  techniques?: string[];
  /** 구버전 호환 (단수) */
  technique?: string;
  label?: string;
  accounts: string[];
  breach_kinds?: BreachKind[];
  rule_ids?: string[];
  /** 구버전 호환 (단수) */
  rule_id?: string | null;
  status: RoundStatus;
  reattack_total: number | null;
  reattack_success: number | null;
  /** 라운드 내 룰 오탐률 중 최댓값(%) */
  false_positive: number | null;
}

export interface DashboardState {
  scenario: Scenario;
  source?: 'mock' | 'stub' | 'live' | string;
  /** 목업 전용: 현재 이벤트 번호 / 전체 */
  step?: number;
  total_steps?: number;
  round: number;
  total_rounds?: number;
  phase: Phase;
  risk: number;
  risk_level: RiskLevel;
  kpi: Kpi;
  tactics?: Tactic[];
  techniques: Technique[];
  actors?: Actor[];
  rules: Rule[];
  events: RediEvent[];
  rounds: Round[];
}
