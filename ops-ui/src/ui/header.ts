/** 콘솔 바, 연결 배지, KPI */
import type { DashboardState } from '../types';
import { $, esc, KIND, label, num, PHASE } from './shared';

const RING_C = 2 * Math.PI * 34;

export function setConn(kind: 'live' | 'mock' | 'err' | 'wait', text: string): void {
  const c = $('conn');
  c.className = `conn ${kind}`;
  c.textContent = text;
}

export function renderConsole(s: DashboardState): void {
  document.querySelectorAll<HTMLElement>('[data-bind="scenarioId"]').forEach((el) => {
    el.textContent = s.scenario?.id || 'scenario';
  });

  const ph = $('phase');
  ph.className = `phase ${s.phase || 'idle'}`;
  let text = label(PHASE, s.phase) || '대기';
  if (s.round) text = `라운드 ${s.round}${s.total_rounds ? `/${s.total_rounds}` : ''} · ${text}`;
  ph.textContent = text;

  const rb = $('riskBadge');
  rb.className = `risk-badge ${s.risk_level || ''}`;
  rb.textContent = `RISK ${num(s.risk)}/100 · ${s.risk_level || '—'}`;

  $('progress').textContent = s.total_steps
    ? `${s.step ?? 0} / ${s.total_steps} 이벤트`
    : `이벤트 ${s.events?.length ?? 0}건`;
}

export function renderKpis(s: DashboardState): void {
  const k = s.kpi;
  const risk = s.risk || 0;

  $('kRisk').textContent = num(s.risk);
  $('kRisk').parentElement!.className = `kpi-v ${risk >= 80 ? 'red' : risk >= 40 ? 'amber' : 'green'}`;
  const ring = $('ringFg');
  ring.setAttribute('class', `ring-fg ${s.risk_level || ''}`);
  ring.style.strokeDasharray = `${(RING_C * risk / 100).toFixed(1)} ${RING_C.toFixed(1)}`;

  $('kAttempts').textContent = num(k.total_attempts);
  $('kAttemptsSub').textContent = `총 공격 시도${k.reattack_total ? ` · 재공격 검증 ${k.reattack_total}회 포함` : ''}`;

  $('kBreaches').textContent = num(k.breaches);
  $('kBreachSub').textContent = `침투 성공 · ${k.breach_rate != null ? `${k.breach_rate.toFixed(1)}%` : '—'}` +
    (k.accounts_compromised != null ? ` · 계정 ${k.accounts_compromised}개` : '');
  const kinds = k.breach_by_kind ?? {};
  $('kKinds').innerHTML = (Object.keys(kinds) as (keyof typeof kinds)[])
    .filter((x) => kinds[x])
    .map((x) => `<span class="kind ${esc(x)}">${esc(label(KIND, x))} ${esc(kinds[x])}</span>`)
    .join('');

  $('kRules').textContent = num(k.rules_applied);
  const rate = k.reattack_total ? `${Math.round(100 * k.reattack_blocked / k.reattack_total)}%` : '—';
  $('kRulesSub').innerHTML = `적용된 방어 룰 · 재공격 차단 <b>${esc(rate)}</b>`;
}
