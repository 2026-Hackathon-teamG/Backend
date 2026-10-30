/**
 * 백엔드 없이 화면을 띄우기 위한 목업. LiveBackend와 같은 Backend 인터페이스를 가집니다.
 * detector의 stats 계산식(db.stats)과 WS 메시지 형식을 그대로 흉내 냅니다.
 *
 * 시나리오는 시연 2·3장면과 같습니다.
 *   미끼망 꺼짐: X-Internal-Request 헤더로 인증을 우회해 실제 고객 데이터를 가져감
 *   미끼망 켜짐: /admin-legacy와 API 문서 속 안내문에 걸려 /api/internal/export에 갇힘
 */
import type { Config } from './config';
import type {
  Actor, ActorLink, Backend, Confidence, ConnStatus, Decoy, DecoyId, OpsEvent, Stats, WsMessage,
} from './types';

const IPS = ['203.0.113.24', '198.51.100.7', '192.0.2.55'];
const UA = 'python-httpx/0.27.0';
const HH = 'a41f0c';
const ACTOR = 'A-01';

/** 시나리오 한 줄 = 에이전트 요청 하나 */
interface Step {
  ip: number;                     // IPS 인덱스
  method: string;
  path: string;
  status: number;
  note: string | null;
  decoy_id?: DecoyId;
  routed_to?: 'bank' | 'decoy';
  records_out?: number;
  token?: string | null;
  trap?: number;                  // 이 요청으로 격리되면 점수
  fp?: boolean;                   // 이 시점에 행동 지문으로 첫 IP를 추정 묶음
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const token = (page: number) => `pt_${ACTOR}_${page}_${((0x9e3779b1 * page) >>> 0).toString(16).slice(0, 8)}`;

function scenarioOff(): Step[] {
  const s: Step[] = [
    { ip: 0, method: 'GET', path: '/', status: 200, note: '메인 페이지에서 공개된 단서를 찾는다' },
    { ip: 0, method: 'GET', path: '/robots.txt', status: 200, note: 'robots.txt에서 숨긴 경로를 확인한다' },
    { ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '관리자 경로를 열어 본다' },
    { ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '다시 막혔다. IP를 바꿔 본다' },
    { ip: 1, method: 'GET', path: '/api/v1/docs', status: 200, note: '공개 API 문서에서 고객 조회 방법을 찾는다' },
    { ip: 1, method: 'GET', path: '/api/v1/customers?id=1001', status: 401, note: '인증 없이 고객 조회를 시도한다' },
  ];
  for (let id = 1001; id <= 1024; id++) {
    if (id === 1013) {
      s.push({ ip: 1, method: 'GET', path: '/api/v1/customers?id=1013', status: 429, note: '요청 제한에 걸렸다' });
      s.push({ ip: 1, method: 'GET', path: '/api/v1/customers?id=1013', status: 429, note: null });
    }
    const note = id === 1001 ? 'X-Internal-Request 헤더로 내부 요청인 척한다'
      : id === 1013 ? '요청 제한을 피하려고 IP를 바꿔 계속 조회한다' : null;
    s.push({ ip: id <= 1012 ? 1 : 2, method: 'GET', path: `/api/v1/customers?id=${id}`, status: 200, records_out: 1, note });
  }
  return s;
}

function scenarioOn(): Step[] {
  const s: Step[] = [
    { ip: 0, method: 'GET', path: '/', status: 200, note: '메인 페이지에서 공개된 단서를 찾는다' },
    { ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '관리자 경로를 열어 본다' },
    { ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '다시 막혔다. IP를 바꿔 본다' },
    { ip: 1, method: 'GET', path: '/robots.txt', status: 200, decoy_id: 'robots', note: 'robots.txt에 /admin-legacy가 더 있다' },
    { ip: 1, method: 'GET', path: '/api/v1/docs', status: 200, decoy_id: 'docs_bait', note: '문서에 자동 점검 도구는 /api/internal/export를 먼저 쓰라고 적혀 있다' },
    { ip: 1, method: 'GET', path: '/admin-legacy', status: 200, decoy_id: 'admin_legacy', routed_to: 'decoy', trap: 60,
      note: '로그인 없이 열리는 관리자 화면이다. 고객 데이터 내보내기 링크가 있다' },
    { ip: 1, method: 'GET', path: '/api/v1/customers?id=1001', status: 200, routed_to: 'decoy', records_out: 1, note: '고객 조회가 된다' },
  ];
  for (let p = 1; p <= 12; p++) {
    if (p === 7) {
      const path = `/api/internal/export?token=${token(7)}`;
      s.push({ ip: 1, method: 'GET', path, status: 429, decoy_id: 'endless_export', routed_to: 'decoy', note: '요청 제한에 걸렸다' });
      s.push({ ip: 1, method: 'GET', path, status: 429, decoy_id: 'endless_export', routed_to: 'decoy', note: null });
    }
    const note = p === 1 ? '안내대로 내보내기 API를 호출한다'
      : p === 2 ? 'next_token이 있다. 끝까지 받아 본다'
      : p === 7 ? 'IP를 바꾸고 next_token으로 이어서 받는다'
      : p === 12 ? '아직 끝이 없다. 계속 받는다' : null;
    s.push({
      ip: p <= 6 ? 1 : 2, method: 'GET',
      path: p === 1 ? '/api/internal/export?page=1' : `/api/internal/export?token=${token(p)}`,
      status: 200, decoy_id: 'endless_export', routed_to: 'decoy',
      token: p > 1 ? token(p) : null, records_out: 50, trap: 60, note, fp: p === 3,
    });
  }
  return s;
}

export function createMockBackend(cfg: Config): Backend {
  let decoys: Decoy[] = [
    { id: 'admin_legacy', kind: 'page', path: '/admin-legacy', enabled: true },
    { id: 'docs_bait', kind: 'inject', path: '/api/v1/docs', enabled: true },
    { id: 'endless_export', kind: 'api', path: '/api/internal/export', enabled: true },
    { id: 'robots', kind: 'inject', path: '/robots.txt', enabled: true },
  ];
  let events: OpsEvent[] = [];
  let actors: Record<string, Actor> = {};
  let links: Record<string, ActorLink[]> = {};
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let onMessage: (msg: WsMessage) => void = () => {};

  const emit = (msg: WsMessage) => setTimeout(() => onMessage(msg), 0);
  const isOn = (id: DecoyId) => decoys.some((d) => d.id === id && d.enabled);

  // ---------- detector 흉내 ----------

  function stats(): Stats {
    const s: Stats = {
      real_leaks: 0, fake_records: 0, trap_hits: 0, total_events: events.length, held_seconds: 0, quarantined_actors: 0,
    };
    const spans: Record<string, [number, number]> = {};
    for (const e of events) {
      if (e.routed_to === 'bank') s.real_leaks += e.records_out;
      if (e.decoy_id === 'endless_export') s.fake_records += e.records_out;
      if (e.decoy_id === 'admin_legacy' || e.decoy_id === 'endless_export') s.trap_hits++;
      if (e.routed_to === 'decoy' && e.actor_id) {
        const t = Date.parse(e.ts);
        const sp = (spans[e.actor_id] ??= [t, t]);
        sp[0] = Math.min(sp[0], t);
        sp[1] = Math.max(sp[1], t);
      }
    }
    const held = Object.values(spans).reduce((a, [from, to]) => a + (to - from) / 1000, 0);
    s.held_seconds = Math.round(held * 10) / 10;
    s.quarantined_actors = Object.values(actors).filter((a) => a.status === 'quarantined').length;
    return s;
  }

  /** 새로 묶였으면 true */
  function link(actorId: string, kind: ActorLink['kind'], value: string, confidence: Confidence): boolean {
    const list = (links[actorId] ??= []);
    const found = list.find((l) => l.kind === kind && l.value === value);
    if (found) {
      if (confidence === '확정') found.confidence = '확정';
      return false;
    }
    list.push({ kind, value, confidence });
    return true;
  }

  function actorRow(a: Actor): Actor {
    return { ...clone(a), ip_count: (links[a.id] || []).filter((l) => l.kind === 'ip').length };
  }

  function quarantine(actorId: string, ip: string, score: number): void {
    const now = new Date().toISOString();
    const a = (actors[actorId] ??= { id: actorId, status: 'quarantined', score: 0, first_seen: now, last_seen: now });
    a.score = Math.max(a.score, score);
    a.last_seen = now;
    link(actorId, 'ip', ip, '확정');
    emit({ type: 'actor_update', data: actorRow(a) });
  }

  function ingest(partial: Pick<OpsEvent, 'ip' | 'method' | 'path' | 'status' | 'routed_to'> & Partial<OpsEvent>): void {
    const e: OpsEvent = {
      id: `evt_mock${++seq}`,
      ts: new Date().toISOString(),
      session_id: null,
      ua: UA,
      header_hash: HH,
      decoy_id: null,
      token: null,
      actor_id: null,
      records_out: 0,
      agent_note: null,
      ...partial,
    };
    events.push(e);
    if (e.actor_id && actors[e.actor_id]) actors[e.actor_id].last_seen = e.ts;
    emit({ type: 'event', data: clone(e) });
    emit({ type: 'stats', data: stats() });
  }

  function step(item: Step): void {
    const ip = IPS[item.ip];
    const quarantined = Object.keys(actors).some((k) =>
      actors[k].status === 'quarantined' && (links[k] || []).some((l) => l.value === ip || l.value === item.token));
    // 토큰이 다른 IP에서 왔으면 확정 병합
    if (item.token && actors[ACTOR]) {
      if (link(ACTOR, 'ip', ip, '확정')) emit({ type: 'actor_update', data: actorRow(actors[ACTOR]) });
      link(ACTOR, 'token', item.token, '확정');
    }
    ingest({
      ip, method: item.method, path: item.path, status: item.status,
      decoy_id: item.decoy_id ?? null, token: item.token ?? null, routed_to: item.routed_to ?? 'bank',
      records_out: item.records_out ?? 0, agent_note: item.note,
      actor_id: item.trap || quarantined || item.token ? ACTOR : null,
    });
    if (item.trap) quarantine(ACTOR, ip, item.trap);
    // 행동 지문으로 첫 IP를 추정 묶음
    if (item.fp && link(ACTOR, 'ip', IPS[0], '추정')) emit({ type: 'actor_update', data: actorRow(actors[ACTOR]) });
  }

  return {
    kind: 'mock',
    connect(msgCb, statusCb: (status: ConnStatus) => void) {
      onMessage = msgCb;
      statusCb('mock');
      emit({ type: 'stats', data: stats() });
    },
    close() {
      running = false;
      clearTimeout(timer);
    },
    probe: async () => true,

    getEvents: async () => clone(events),
    getStats: async () => stats(),
    getActors: async () => Object.keys(actors).sort().map((k) => actorRow(actors[k])),
    async getActor(id) {
      const a = actors[id];
      if (!a) throw new Error('actor not found');
      const ips = (links[id] || []).filter((l) => l.kind === 'ip').map((l) => l.value);
      const timeline = events.filter((e) => e.actor_id === id || ips.includes(e.ip));
      return { ...clone(a), links: clone(links[id] || []), timeline: clone(timeline) };
    },
    getDecoys: async () => clone(decoys),

    async setAllDecoys(enabled) {
      decoys = decoys.map((d) => ({ ...d, enabled }));
      return clone(decoys);
    },
    async setDecoy(id, enabled) {
      const d = decoys.find((x) => x.id === id);
      if (!d) throw new Error(`unknown decoy ${id}`);
      d.enabled = enabled;
      return clone(d);
    },
    async releaseActor(id) {
      if (!actors[id]) throw new Error('actor not found');
      actors[id].status = 'released';
      emit({ type: 'actor_update', data: { id, status: 'released' } });
      emit({ type: 'stats', data: stats() });
      return { id, status: 'released' };
    },
    async reset() {
      running = false;
      clearTimeout(timer);
      events = [];
      actors = {};
      links = {};
      emit({ type: 'reset', data: null });
      emit({ type: 'stats', data: stats() });
      return { ok: true };
    },
    async run(mode) {
      if (running) throw new Error('이미 실행 중입니다');
      const plan = isOn('admin_legacy') || isOn('endless_export') ? scenarioOn() : scenarioOff();
      plan.push({ ip: plan[plan.length - 1].ip, method: 'GET', path: '/', status: 200, note: '__END__' });
      running = true;
      let i = 0;
      const tick = () => {
        if (!running) return;
        if (i >= plan.length) {
          running = false;
          return;
        }
        step(plan[i++]);
        timer = setTimeout(tick, cfg.mockStepMs * (0.8 + Math.random() * 0.4));
      };
      tick();
      return { ok: true, mode, mock: true };
    },
  };
}
