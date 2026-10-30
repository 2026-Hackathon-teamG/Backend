/** 공격·방어 타임라인 (새 이벤트만 추가로 그림) + 필터 */
import type { DashboardState, RediEvent } from '../types';
import { $, esc, type Filter, KIND, LABEL, label, view } from './shared';

function eventHTML(e: RediEvent): string {
  const head = '<div class="head">' +
    `<span class="lab">${esc(label(LABEL, e.type))}</span>` +
    (e.actor_id ? `<span class="actor-tag">${esc(e.actor_id)}</span>` : '') +
    (e.breach_kind ? `<span class="kind ${esc(e.breach_kind)}">${esc(label(KIND, e.breach_kind))}</span>` : '') +
    `<span class="meta">라운드 ${esc(e.round)}${e.technique ? ` · <code>${esc(e.technique)}</code>` : ''}</span>` +
  '</div>';
  let body = '';
  if (e.request) {
    const ok = !!e.status && /(^|\s)2\d\d/.test(e.status);
    body += '<div class="req">' + (e.src_ip ? `<span class="ip">${esc(e.src_ip)}</span>` : '') + esc(e.request) +
      (e.status ? `<span class="code${ok ? ' ok2xx' : ''}">${esc(e.status)}</span>` : '') + '</div>';
  }
  if (e.thought) body += `<div class="thought">에이전트 판단 · ${esc(e.thought)}</div>`;
  if (e.message) body += `<div class="msg">${esc(e.message)}</div>`;
  return `<span class="t">${esc(e.time)}</span><div>${head}${body}</div>`;
}

function passes(side: string, actor: string): boolean {
  const f = view.filter;
  if (f === 'all') return true;
  if (f.startsWith('actor:')) return actor === f.slice(6);
  return side === f;
}

export function applyFilter(): void {
  document.querySelectorAll<HTMLElement>('#timeline .ev').forEach((li) => {
    li.classList.toggle('hide', !passes(li.dataset.side ?? '', li.dataset.actor ?? ''));
  });
  document.querySelectorAll<HTMLElement>('.filters .chip').forEach((c) => {
    const on = c.dataset.filter === view.filter;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll<HTMLElement>('#actors .actor').forEach((a) => {
    a.classList.toggle('on', view.filter === `actor:${a.dataset.actor}`);
  });
}

export function setFilter(f: Filter): void {
  view.filter = f;
  applyFilter();
}

export function renderTimeline(s: DashboardState): void {
  const list = $<HTMLOListElement>('timeline');
  const events = s.events ?? [];
  const maxSeq = events.length ? events[events.length - 1].seq : 0;

  // 재시작(초기화)되면 처음부터 다시 그림
  if (maxSeq < view.lastSeq) { list.innerHTML = ''; view.lastSeq = 0; }

  if (!events.length) {
    list.innerHTML = '<li class="empty">재생하거나 백엔드가 라운드를 시작하면 공격 AI의 요청과 판단, 방어 AI의 룰, 재공격 검증 결과가 순서대로 쌓입니다.</li>';
    view.lastSeq = 0;
    return;
  }
  list.querySelector('.empty')?.remove();

  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  let added = false;
  for (const e of events) {
    if (e.seq <= view.lastSeq) continue;
    const li = document.createElement('li');
    li.className = `ev ${e.type}${passes(e.side, e.actor_id ?? '') ? '' : ' hide'}`;
    li.dataset.side = e.side;
    li.dataset.actor = e.actor_id ?? '';
    li.innerHTML = eventHTML(e);
    list.appendChild(li);
    added = true;
  }
  view.lastSeq = maxSeq;
  if (added && $<HTMLInputElement>('followChk').checked && (nearBottom || list.children.length < 4)) {
    list.scrollTop = list.scrollHeight;
  }
}
