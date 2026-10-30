/**
 * 시나리오 이벤트를 step번째까지 적용해 /api/state 와 같은 모양의 상태를 계산한다.
 * DOM을 쓰지 않으므로 Node(scripts/export-sample.ts)에서도 그대로 돈다.
 */
import type {
  Actor, BreachKind, DashboardState, EventType, Phase, RiskLevel, Round, RoundStatus, Rule, Technique
} from '../types';
import { EVENTS, ROUNDS, RULES, SCENARIO, TACTICS, TECHNIQUES, type ActorPatch } from './scenario';

export const TOTAL_STEPS = EVENTS.length;

const PHASE_BY_TYPE: Record<EventType, Phase> = {
  recon: 'attack', attack: 'attack', decoy_hit: 'attack', cluster: 'rule_generated', breach: 'breach',
  analysis: 'rule_generated', rule_applied: 'rule_applied', verify: 'verified', end: 'done'
};

export function riskLevel(r: number): RiskLevel {
  if (r >= 80) return 'CRITICAL';
  if (r >= 40) return 'MEDIUM';
  if (r > 0) return 'LOW';
  return 'SECURE';
}

function applyActor(actors: Map<string, Actor>, p: ActorPatch): void {
  let a = actors.get(p.id);
  if (!a) {
    a = { id: p.id, role: 'attack', ips: [], ip_count: 0, fingerprints: 0, similarity: null, signals: [], status: 'observing', linked_to: null };
    actors.set(p.id, a);
  }
  if (p.role) a.role = p.role;
  for (const ip of p.add_ips ?? []) {
    if (!a.ips.includes(ip)) { a.ips.push(ip); a.ip_count = (a.ip_count ?? 0) + 1; }
  }
  if (p.ip_extra) a.ip_count = (a.ip_count ?? 0) + p.ip_extra;
  if (p.fingerprints != null) a.fingerprints = p.fingerprints;
  if (p.similarity != null) a.similarity = p.similarity;
  if (p.status) a.status = p.status;
  if (p.linked_to) a.linked_to = p.linked_to;
  for (const s of p.signals ?? []) if (!a.signals!.includes(s)) a.signals!.push(s);
}

interface RoundAcc { status: RoundStatus; accounts: string[]; kinds: BreachKind[]; reTotal: number; fps: number[] }

export function buildState(step: number): DashboardState {
  const shown = EVENTS.slice(0, Math.max(0, Math.min(step, EVENTS.length)));

  const tech = new Map<string, Technique>();
  for (const d of TECHNIQUES) {
    tech.set(d.id, {
      id: d.id, tactic: d.tactic, name: d.name, name_ko: d.ko, state: 'untested', fitness: null, fitness_peak: 0,
      attempts: 0, blocked: 0, partial: 0, breached: 0, rule_id: null,
      detail: { how: d.how, why: d.why, rule: null }
    });
  }
  const T = (id: string): Technique => {
    const t = tech.get(id);
    if (!t) throw new Error(`시나리오에 없는 기법: ${id}`);
    return t;
  };
  const setFit = (id: string, v: number) => { const t = T(id); t.fitness = v; t.fitness_peak = Math.max(t.fitness_peak ?? 0, v); };

  const rules = new Map<string, Rule>();
  const rounds = new Map<number, RoundAcc>();
  const actors = new Map<string, Actor>();
  const accounts = new Set<string>();
  const kinds: Record<BreachKind, number> = { session: 0, enumeration: 0, mfa: 0, data: 0 };
  let attackAttempts = 0, reTotal = 0, breaches = 0, applied = 0, curRound = 0;

  for (const e of shown) {
    curRound = e.round;
    let R = rounds.get(e.round);
    if (!R) { R = { status: 'running', accounts: [], kinds: [], reTotal: 0, fps: [] }; rounds.set(e.round, R); }
    if (e._actor) applyActor(actors, e._actor);

    const t = e.technique ? T(e.technique) : null;
    if (t && e._att) { attackAttempts += e._att; t.attempts += e._att; }
    if (t && e._br) t.breached += e._br;
    if (t && e._partial) t.partial += e._partial;
    if (e.technique && e._fit != null) setFit(e.technique, e._fit);
    for (const x of e._extra ?? []) {
      const xt = T(x.id);
      xt.attempts += x.att ?? 0;
      xt.breached += x.br ?? 0;
      if (x.fit != null) setFit(x.id, x.fit);
    }

    if (e.type === 'breach') {
      const n = e._count ?? 1;
      breaches += n;
      if (e.breach_kind) {
        kinds[e.breach_kind] += n;
        if (!R.kinds.includes(e.breach_kind)) R.kinds.push(e.breach_kind);
      }
      for (const a of e._accounts ?? []) { R.accounts.push(a); accounts.add(a); }
    }

    if (e._rule) {
      const D = RULES[e._rule];
      rules.set(D.id, { id: D.id, round: D.round, technique: D.technique, title: D.title, reason: D.reason, rule: D.rule,
        status: 'generated', reattack_total: null, reattack_success: null, false_positive: null });
    }
    if (e._apply) { rules.get(e._apply)!.status = 'applied'; applied += 1; }

    if (t && e._re && e._rid) {
      reTotal += e._re;
      t.blocked += e._re; t.attempts += e._re; t.fitness = 0; t.rule_id = e._rid;
      const r = rules.get(e._rid)!;
      r.status = 'verified'; r.reattack_total = e._re; r.reattack_success = 0; r.false_positive = e._fp ?? 0;
      R.reTotal += e._re; R.fps.push(e._fp ?? 0);
      for (const id of e._also ?? []) { const at = T(id); at.fitness = 0; at.rule_id = e._rid; }
      if (e._done) R.status = 'verified';
    }
  }

  // 위험도 = 100 × (0.7 × 현재 최고 fitness + 0.3 × 테스트한 기법의 가중 평균 fitness)
  let sw = 0, sf = 0, maxFit = 0;
  for (const d of TECHNIQUES) {
    const t = T(d.id);
    t.state = t.fitness === null ? 'untested' : t.fitness === 0 ? 'defended' : t.fitness >= 0.8 ? 'breach' : 'near';
    if (t.rule_id && t.detail) t.detail.rule = `${t.rule_id} · ${RULES[t.rule_id].title}`;
    if (t.fitness !== null) { sw += d.weight; sf += d.weight * t.fitness; maxFit = Math.max(maxFit, t.fitness); }
  }
  const risk = Math.round(100 * (0.7 * maxFit + 0.3 * (sw ? sf / sw : 0)));
  const last = shown[shown.length - 1];
  const actorList = [...actors.values()];

  const roundList: Round[] = ROUNDS.map((D) => {
    const s = rounds.get(D.round);
    return {
      round: D.round, techniques: D.techniques, label: D.label,
      accounts: s?.accounts ?? [], breach_kinds: s?.kinds ?? [],
      rule_ids: D.rule_ids.filter((id) => rules.has(id)),
      status: s?.status ?? 'pending',
      reattack_total: s?.reTotal ? s.reTotal : null,
      reattack_success: s?.reTotal ? 0 : null,
      false_positive: s?.fps.length ? Math.max(...s.fps) : null
    };
  });

  return {
    scenario: { ...SCENARIO },
    source: 'mock',
    step: shown.length, total_steps: EVENTS.length,
    round: curRound, total_rounds: ROUNDS.length,
    phase: last ? PHASE_BY_TYPE[last.type] : 'idle',
    risk, risk_level: riskLevel(risk),
    kpi: {
      total_attempts: attackAttempts + reTotal,
      attack_attempts: attackAttempts,
      breaches,
      breach_by_kind: kinds,
      accounts_compromised: accounts.size,
      breach_rate: attackAttempts ? +(100 * breaches / attackAttempts).toFixed(1) : 0,
      rules_applied: applied,
      reattack_total: reTotal,
      reattack_blocked: reTotal,
      actors: actorList.length,
      actors_isolated: actorList.filter((a) => a.status === 'isolated').length
    },
    tactics: TACTICS,
    techniques: TECHNIQUES.map((d) => T(d.id)),
    actors: actorList,
    rules: [...rules.values()],
    events: shown.map((e, i) => ({
      seq: i + 1, time: e.time, round: e.round, side: e.side, type: e.type,
      actor_id: e.actor_id ?? null, technique: e.technique ?? null, breach_kind: e.breach_kind ?? null,
      src_ip: e.src_ip ?? null, request: e.request ?? null, status: e.status ?? null,
      thought: e.thought ?? null, message: e.message ?? null
    })),
    rounds: roundList
  };
}

/** 다음 라운드의 첫 이벤트 위치 (다음 라운드 버튼용) */
export function nextRoundStep(step: number): number {
  if (step >= EVENTS.length) return EVENTS.length;
  const cur = EVENTS[step].round;
  let s = step;
  while (s < EVENTS.length && EVENTS[s].round === cur) s += 1;
  return s;
}
