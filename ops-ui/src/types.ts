/**
 * 백엔드 shared/models.py와 detector 관제 API 응답의 타입.
 * 백엔드 모델이 바뀌면 여기도 같이 바꿉니다.
 */

export type DecoyId = 'robots' | 'admin_legacy' | 'docs_bait' | 'endless_export';
export type ActorStatus = 'watching' | 'quarantined' | 'released';
export type Confidence = '확정' | '추정';
export type RunMode = 'live' | 'replay';
export type ConnStatus = 'connecting' | 'live' | 'mock' | 'down';

/** shared.models.Event */
export interface OpsEvent {
  id: string;
  ts: string;                     // ISO 8601
  ip: string;
  method: string;
  path: string;                   // 쿼리 포함
  status: number;
  session_id: string | null;
  ua: string | null;
  header_hash: string;
  decoy_id: DecoyId | null;
  token: string | null;
  actor_id: string | null;
  routed_to: 'bank' | 'decoy';
  records_out: number;
  agent_note: string | null;      // "__END__"이면 실행 종료
}

/** GET /ops/actors 행 */
export interface Actor {
  id: string;
  status: ActorStatus;
  score: number;
  first_seen: string;
  last_seen: string;
  ip_count?: number;
}

export interface ActorLink {
  kind: 'ip' | 'session' | 'token' | 'fingerprint';
  value: string;
  confidence: Confidence;
}

/** GET /ops/actors/{id} */
export interface ActorDetail extends Actor {
  links: ActorLink[];
  timeline: OpsEvent[];
}

export interface Decoy {
  id: DecoyId;
  kind: string;
  path: string;
  enabled: boolean;
}

/** GET /ops/stats */
export interface Stats {
  real_leaks: number;
  fake_records: number;
  trap_hits: number;
  total_events: number;
  held_seconds: number;
  quarantined_actors: number;
}

export type ActorUpdate = Partial<Actor> & { id: string };

/** WS /ops/stream 메시지 */
export type WsMessage =
  | { type: 'event'; data: OpsEvent }
  | { type: 'stats'; data: Stats }
  | { type: 'actor_update'; data: ActorUpdate }
  | { type: 'reset'; data: null };

/** live와 mock이 똑같이 지키는 데이터 출처 인터페이스 */
export interface Backend {
  readonly kind: 'live' | 'mock';
  connect(onMessage: (msg: WsMessage) => void, onStatus: (status: ConnStatus) => void): void;
  close(): void;
  probe(): Promise<boolean>;

  getEvents(since?: string): Promise<OpsEvent[]>;
  getStats(): Promise<Stats>;
  getActors(): Promise<Actor[]>;
  getActor(id: string): Promise<ActorDetail>;
  getDecoys(): Promise<Decoy[]>;

  setAllDecoys(enabled: boolean): Promise<Decoy[]>;
  setDecoy(id: DecoyId, enabled: boolean): Promise<Decoy>;
  releaseActor(id: string): Promise<unknown>;
  reset(): Promise<unknown>;
  run(mode: RunMode): Promise<unknown>;
}
