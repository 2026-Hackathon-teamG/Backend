/** 화면 전체 갱신과 이벤트 바인딩 */
import type { DataSource } from '../api';
import type { ControlAction, DashboardState } from '../types';
import { renderActors } from './actors';
import { renderGlobe } from './globe';
import { renderConsole, renderKpis, setConn } from './header';
import { renderRounds, renderRules } from './rulesRounds';
import { $, type Filter, view } from './shared';
import { openDetail, renderTechniques } from './techniques';
import { renderTimeline, setFilter } from './timeline';

export { setConn };

export function render(s: DashboardState): void {
  view.state = s;
  renderConsole(s);
  renderKpis(s);
  renderGlobe(s);
  renderTechniques(s);
  renderActors(s);
  renderTimeline(s);
  renderRules(s);
  renderRounds(s);
}

const ACTIONS: readonly ControlAction[] = ['play', 'next', 'next_round', 'end', 'reset'];
const isAction = (v: string | undefined): v is ControlAction => !!v && (ACTIONS as readonly string[]).includes(v);

export function bind(source: DataSource): void {
  // 재생 컨트롤
  $('controls').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const action = b?.dataset.action;
    if (!isAction(action)) return;
    if (action === 'play' || action === 'reset') $<HTMLInputElement>('followChk').checked = true;
    source.control(action).catch((e: Error) => setConn('err', `제어 실패 · ${e.message}`));
  });

  // 히트맵 셀·표 행 → 상세
  document.addEventListener('click', (ev) => {
    const cell = (ev.target as HTMLElement).closest<HTMLElement>('[data-tech]');
    if (cell?.dataset.tech) openDetail(cell.dataset.tech);
  });
  $<HTMLDialogElement>('techDialog').addEventListener('close', () => {
    view.selected = null;
    if (view.state) renderTechniques(view.state);
  });

  // 타임라인 필터 (측·주체)
  document.querySelector('.filters')!.addEventListener('click', (ev) => {
    const chip = (ev.target as HTMLElement).closest<HTMLElement>('[data-filter]');
    if (chip?.dataset.filter) setFilter(chip.dataset.filter as Filter);
  });

  // 공격 주체 카드 → 그 주체 타임라인만 (다시 누르면 해제)
  $('actors').addEventListener('click', (ev) => {
    const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-actor]');
    if (!card) return;
    const f: Filter = `actor:${card.dataset.actor}`;
    setFilter(view.filter === f ? 'all' : f);
    if (view.filter !== 'all') $('timeline').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('pdfBtn').addEventListener('click', () => window.print());
}
