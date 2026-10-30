/** 전술별 히트맵, 기법별 표, 기법 상세 창 */
import type { DashboardState, Technique } from '../types';
import { $, CELL_LABEL, changed, esc, fmtFit, label, num, TACTIC_FALLBACK, view } from './shared';

function cellHTML(t: Technique): string {
  const st = t.state || 'untested';
  const prev = view.prevTech.get(t.id);
  const flash = prev && prev !== st && st === 'breach' ? ' flash' : '';
  const sel = view.selected === t.id ? ' selected' : '';
  let val: string, bar: number, text: string;
  if (st === 'defended') {
    val = (t.fitness_peak ? `<span class="was">${fmtFit(t.fitness_peak)}</span>` : '') + fmtFit(0);
    bar = 100;
    text = `방어 · ${fmtFit(t.fitness_peak)} → 0.00${t.rule_id ? ` · ${esc(t.rule_id)}` : ''}`;
  } else {
    val = fmtFit(t.fitness);
    bar = Math.round((t.fitness ?? 0) * 100);
    text = st === 'breach' && (t.fitness ?? 1) < 1 ? `부분 성공 · fitness ${fmtFit(t.fitness)}` : label(CELL_LABEL, st);
  }
  return `<button type="button" class="cell ${st}${sel}${flash}" data-tech="${esc(t.id)}" aria-label="${esc(t.name)} 상세 보기">` +
    `<span class="cid">${esc(t.id)}</span>` +
    `<span class="cname">${esc(t.name)}</span>` +
    `<span class="cval">${val}</span>` +
    `<span class="cbar"><i style="width:${bar}%"></i></span>` +
    `<span class="clabel">${text}</span>` +
  '</button>';
}

export function renderTechniques(s: DashboardState): void {
  const techs = s.techniques ?? [];
  const breachN = techs.filter((t) => t.state === 'breach').length;
  const defN = techs.filter((t) => t.state === 'defended').length;
  $('hmMeta').textContent = `${techs.length} techniques · ${breachN} breach · ${defN} defended`;

  if (!changed('tech', [view.selected, techs])) return;

  // 전술별로 묶음. tactic 이 없는 응답이면 한 덩어리로.
  const tactics = s.tactics?.length ? s.tactics : TACTIC_FALLBACK;
  const groups = tactics.map((tc) => ({ name: tc.name, items: techs.filter((t) => t.tactic === tc.id) }));
  const rest = techs.filter((t) => !tactics.some((tc) => tc.id === t.tactic));
  if (rest.length) groups.push({ name: groups.some((g) => g.items.length) ? '기타' : '', items: rest });

  $('heatmap').innerHTML = groups.filter((g) => g.items.length).map((g) => {
    const bad = g.items.filter((t) => t.state === 'breach').length;
    return '<div class="tgroup">' +
      (g.name ? `<div class="tgroup-h"><b>${esc(g.name)}</b>${g.items.length}개${bad ? ` · 침투 ${bad}` : ''}</div>` : '') +
      `<div class="tgrid">${g.items.map(cellHTML).join('')}</div></div>`;
  }).join('');

  const c = (v: number, cls: string) => `<td class="n ${v ? cls : 'zero'}">${v ? v : '—'}</td>`;
  $('techTable').innerHTML = techs.map((t) =>
    `<tr data-tech="${esc(t.id)}">` +
      `<td><span class="tn">${esc(t.name)}</span><span class="ti">${esc(t.id)}</span></td>` +
      `<td class="n">${num(t.attempts, '0')}</td>` +
      c(t.blocked, 'green') + c(t.partial, 'amber') + c(t.breached, 'red') +
    '</tr>').join('');

  for (const t of techs) view.prevTech.set(t.id, t.state);
}

export function openDetail(id: string): void {
  const s = view.state;
  if (!s) return;
  const t = s.techniques.find((x) => x.id === id);
  if (!t) return;
  view.selected = id;
  const d = t.detail ?? {};
  const rule = s.rules.find((r) => r.id === t.rule_id);
  $('dlgTitle').textContent = `technique.detail — ${t.id}`;
  $('dlgBody').innerHTML =
    '<dl class="dl">' +
      `<dt>기법</dt><dd><b>${esc(t.name)}</b>${t.name_ko ? ` · ${esc(t.name_ko)}` : ''}</dd>` +
      `<dt>fitness</dt><dd class="big">${fmtFit(t.fitness_peak || t.fitness)} → ${fmtFit(t.fitness)}</dd>` +
      `<dt>상태</dt><dd>${esc(t.note || label(CELL_LABEL, t.state))}</dd>` +
      `<dt>시도 / 뚫림</dt><dd class="mono">${num(t.attempts, '0')} / ${num(t.breached, '0')}${t.partial ? ` (부분 ${t.partial})` : ''}</dd>` +
      `<dt>공격 방식</dt><dd>${esc(d.how || '—')}</dd>` +
      `<dt>뚫린 이유</dt><dd>${esc(d.why || '—')}</dd>` +
      `<dt>방어 룰</dt><dd>${esc(d.rule || '아직 없음')}</dd>` +
    '</dl>' +
    (rule ? `<div class="rule"><pre>${esc(JSON.stringify(rule.rule, null, 2))}</pre></div>` : '');

  const dlg = $<HTMLDialogElement>('techDialog');
  if (!dlg.open) dlg.showModal();
  renderTechniques(s);
}
