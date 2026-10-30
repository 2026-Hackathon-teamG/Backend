/** 방어 룰 패널, 라운드 요약 표 */
import type { DashboardState } from '../types';
import { $, changed, esc, KIND, label, ROUND_STATUS, RULE_STATUS, view } from './shared';

export function renderRules(s: DashboardState): void {
  const rules = s.rules ?? [];
  const verified = rules.filter((r) => r.status === 'verified').length;
  $('rlMeta').textContent = `${rules.length}개 생성 · ${verified}개 차단 검증`;

  if (!changed('rules', rules.map((r) => [r.id, r.status, r.reattack_total]))) return;
  const prev = view.prevRuleIds;
  view.prevRuleIds = rules.map((r) => r.id);

  if (!rules.length) { $('rules').innerHTML = '<p class="empty">아직 침투가 없어 생성된 룰이 없습니다.</p>'; return; }

  $('rules').innerHTML = [...rules].reverse().map((r) => {
    const isNew = prev && !prev.includes(r.id) ? ' new' : ''; // 첫 화면에서는 깜빡이지 않음
    const verify = r.reattack_total != null
      ? `<div class="rv"><span class="good">재공격 ${esc(r.reattack_success)}/${esc(r.reattack_total)} 성공</span>` +
        `<span class="${r.false_positive ? 'warn' : 'good'}">오탐 ${esc((r.false_positive ?? 0).toFixed(1))}%</span></div>`
      : '<div class="rv"><span>재공격 검증 대기</span></div>';
    return `<article class="rule${isNew}">` +
      `<div class="top"><span class="rid">${esc(r.id)}</span><span class="rtitle">${esc(r.title)}</span>` +
      `<span class="rstatus ${esc(r.status)}">${esc(label(RULE_STATUS, r.status))}</span></div>` +
      `<div class="reason">라운드 ${esc(r.round)} · ${esc(r.technique)} · ${esc(r.reason)}</div>` +
      `<pre>${esc(JSON.stringify(r.rule, null, 2))}</pre>${verify}` +
    '</article>';
  }).join('');
}

export function renderRounds(s: DashboardState): void {
  const rounds = s.rounds ?? [];
  if (!changed('rounds', rounds)) return;

  $('roundTable').innerHTML = rounds.map((r) => {
    // 구버전 응답(technique, rule_id 단수)도 받는다
    const techs = r.techniques ?? (r.technique ? [r.technique] : []);
    const ruleIds = r.rule_ids ?? (r.rule_id ? [r.rule_id] : []);
    const kinds = r.breach_kinds ?? [];
    const hit = r.accounts.length > 0 || kinds.length > 0;
    const result = hit
      ? kinds.map((k) => `<span class="kind ${esc(k)}">${esc(label(KIND, k))}</span>`).join(' ') +
        (r.accounts.length ? ` ${esc(r.accounts.join(', '))}` : '')
      : (r.status === 'pending' ? '—' : '공격 중');
    const done = r.reattack_total != null;
    const res = done ? `성공 ${r.reattack_success} / ${r.reattack_total}회` : '—';
    const fp = r.false_positive != null ? `${r.false_positive.toFixed(1)}%` : '—';
    return '<tr>' +
      `<td class="mono">R${esc(r.round)}</td>` +
      `<td>${esc(r.label ?? '')}<span class="ti">${esc(techs.join(' · '))}</span></td>` +
      `<td class="${hit ? 'red' : 'muted'}">${result}</td>` +
      `<td class="mono">${esc(ruleIds.length ? ruleIds.join(', ') : '—')}</td>` +
      `<td class="${done ? (r.reattack_success ? 'red' : 'green') : 'muted'}">${esc(res)}</td>` +
      `<td class="mono ${r.false_positive ? 'amber' : r.false_positive === 0 ? 'green' : 'muted'}">${esc(fp)}</td>` +
      `<td><span class="st-pill ${esc(r.status)}">${esc(label(ROUND_STATUS, r.status))}</span></td>` +
    '</tr>';
  }).join('');
}
