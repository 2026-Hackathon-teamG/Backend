/** 공격 주체 카드 + 타임라인 주체 필터 칩 */
import type { Actor, DashboardState } from '../types';
import { $, ACTOR_STATUS, changed, esc, label, ROLE, view } from './shared';
import { applyFilter, setFilter } from './timeline';

function actorHTML(a: Actor): string {
  const sim = a.similarity == null ? null : Math.round(a.similarity * 100);
  const shown = (a.ips ?? []).slice(0, 5);
  const more = Math.max(0, (a.ip_count ?? shown.length) - shown.length);
  return `<button type="button" class="actor ${esc(a.status)}" data-actor="${esc(a.id)}" aria-label="${esc(a.id)} 타임라인만 보기">` +
    `<span class="ah"><span class="aid">${esc(a.id)}</span>` +
      `<span class="role ${esc(a.role)}">${esc(label(ROLE, a.role))}</span>` +
      `<span class="ast ${esc(a.status)}">${esc(label(ACTOR_STATUS, a.status))}</span></span>` +
    (a.linked_to ? `<span class="link">↳ ${esc(a.linked_to)}와 같은 작전 (분업)</span>` : '') +
    `<span class="nums"><span><b>${esc(a.ip_count ?? 0)}</b>IP</span><span><b>${esc(a.fingerprints ?? 0)}</b>지문</span></span>` +
    '<span class="sim"><span>유사도</span>' +
      `<span class="track"><i class="${sim != null && sim < 85 ? 'low' : ''}" style="width:${sim ?? 0}%"></i><b></b></span>` +
      `<span class="sv">${a.similarity == null ? '—' : a.similarity.toFixed(2)}</span></span>` +
    `<span class="ips">${shown.map((ip) => `<span>${esc(ip)}</span>`).join('')}${more ? `<span class="more">+${more}</span>` : ''}</span>` +
    (a.signals?.length ? `<ul>${a.signals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '') +
  '</button>';
}

export function renderActors(s: DashboardState): void {
  const actors = s.actors ?? [];
  const iso = actors.filter((a) => a.status === 'isolated').length;
  const ops = actors.filter((a) => !a.linked_to).length;
  $('acMeta').textContent = `${actors.length}개 주체 · 작전 ${ops}개 · 격리 ${iso}`;

  if (!changed('actors', actors)) return;

  if (!actors.length) {
    $('actors').innerHTML = '<p class="empty">아직 식별된 공격 주체가 없습니다.</p>';
    $('actorChips').innerHTML = '';
    if (view.filter.startsWith('actor:')) setFilter('all');
    return;
  }
  $('actors').innerHTML = actors.map(actorHTML).join('');
  $('actorChips').innerHTML = actors
    .map((a) => `<button class="chip actor-chip" type="button" data-filter="actor:${esc(a.id)}">${esc(a.id)}</button>`)
    .join('');
  applyFilter();
}
