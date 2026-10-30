/**
 * 미끼망 관제실 화면.
 * 데이터 출처는 Backend 하나뿐이고, live/mock 어느 쪽이든 같은 메서드와 같은 WS 메시지를 씁니다.
 * 기법 히트맵은 받은 이벤트로 화면에서 계산합니다 (techniques.ts).
 */
import './style.css';
import { config as cfg } from './config';
import { createLiveBackend } from './live';
import { createMockBackend } from './mock';
import { computeTechniques, type TechResult, type TechState } from './techniques';
import type {
  Actor, ActorDetail, ActorLink, ActorStatus, ActorUpdate, Backend, ConnStatus, Decoy, DecoyId, OpsEvent, RunMode,
  Stats, WsMessage,
} from './types';
import { $, debounce, dur, errMsg, esc, num, store, time } from './util';

const DECOY_LABEL: Record<DecoyId, string> = {
  robots: 'robots.txt 숨은 경로',
  admin_legacy: '가짜 관리자 화면',
  docs_bait: 'API 문서 속 안내문',
  endless_export: '끝없는 내보내기 API',
};
const STATUS_LABEL: Record<ActorStatus, string> = { watching: '감시 중', quarantined: '격리됨', released: '해제됨' };
const RING_LEN = 2 * Math.PI * 34;
const RUNS_KEY = 'mikki.runs';
const EMPTY_LOG = '<div class="empty" id="logEmpty">아직 들어온 요청이 없습니다. "공격 시뮬레이션 실행"을 눌러 보세요.</div>';

/** 실행 결과 비교 표 한 줄 */
interface RunRow {
  ended_at: string;
  decoy_on: boolean;
  mode: RunMode | '-';
  real_leaks: number;
  fake_records: number;
  trap_hits: number;
  held_seconds: number;
  quarantined_actors: number;
}

interface RunCtx {
  decoyOn: boolean;
  mode: RunMode;
  startedAt: number;
}

let backend!: Backend;
const state = {
  decoys: [] as Decoy[],
  events: [] as OpsEvent[],                         // 히트맵 계산용. 로그와 같은 개수만 유지
  actors: {} as Record<string, Actor>,              // id → /ops/actors 행
  details: {} as Record<string, ActorDetail>,       // id → /ops/actors/{id} 응답
  toasted: {} as Record<string, boolean>,           // 격리 알림을 이미 띄운 공격 주체
  stats: {} as Partial<Stats>,
  techniques: [] as TechResult[],
  prevTech: {} as Record<string, TechState>,        // 직전 상태 (뚫림 전환 시 깜빡임)
  run: null as RunCtx | null,
  ended: false,
  runs: store.get<RunRow[]>(RUNS_KEY, []),
};

// ---------- 시작 ----------

async function pickBackend(): Promise<Backend> {
  if (cfg.mode === 'mock') return createMockBackend(cfg);
  const live = createLiveBackend(cfg);
  if (cfg.mode === 'live') return live;
  try {
    await live.probe();
    return live;
  } catch {
    console.info('[미끼망] detector에 연결할 수 없어 목업으로 띄웁니다:', cfg.apiBase);
    return createMockBackend(cfg);
  }
}

async function boot(): Promise<void> {
  bindControls();
  renderRuns();
  renderTechniques();
  renderConsole();
  setInterval(renderProgress, 1000);
  backend = await pickBackend();
  backend.connect(onMessage, setConn);
  await loadAll();
}

async function loadAll(): Promise<void> {
  try {
    await Promise.all([
      backend.getDecoys().then((d) => { state.decoys = d; renderDecoys(); }),
      backend.getStats().then(renderStats),
      backend.getEvents().then((list) => { clearLog(); list.forEach(appendEvent); }),
      refreshActors(),
    ]);
  } catch (err) {
    toast('불러오기 실패', errMsg(err), true);
  }
}

// ---------- WS 메시지 ----------

function onMessage(msg: WsMessage): void {
  switch (msg.type) {
    case 'event':
      appendEvent(msg.data);
      if (msg.data.actor_id) refreshActorsSoon();
      if (msg.data.agent_note === '__END__') void finishRun();
      break;
    case 'stats':
      renderStats(msg.data);
      break;
    case 'actor_update':
      onActorUpdate(msg.data);
      break;
    case 'reset':
      clearLog();
      state.actors = {};
      state.details = {};
      state.toasted = {};
      state.prevTech = {};
      state.ended = false;
      renderActors();
      renderTechniquesSoon();
      break;
  }
}

function onActorUpdate(a: ActorUpdate): void {
  if (!a?.id) return;
  state.actors[a.id] = { ...state.actors[a.id], ...a } as Actor;
  if (a.status === 'quarantined' && !state.toasted[a.id]) {
    state.toasted[a.id] = true;
    // detector가 Discord로 보내는 문구와 같은 형식
    toast('Discord · 미끼망 알림', `[미끼망] ${a.id} 격리 · IP ${a.ip_count || 1}개`);
  }
  refreshActorsSoon();
}

function setConn(status: ConnStatus): void {
  const b = $('connBadge');
  const cls: Partial<Record<ConnStatus, string>> = { live: 'live', mock: 'mock', down: 'down' };
  const text: Record<ConnStatus, string> = { live: '● LIVE', mock: 'MOCK', down: '연결 끊김 · 재시도 중', connecting: '연결 중' };
  b.className = 'badge ' + (cls[status] || '');
  b.textContent = text[status];
  b.title = status === 'mock' ? '백엔드 없이 목업 데이터를 보고 있습니다' : cfg.apiBase;
  // 재연결되면 놓친 상태를 다시 받음
  if (status === 'live' && backend && state.events.length) void loadAll();
}

// ---------- 조작 ----------

function bindControls(): void {
  $<HTMLInputElement>('decoyToggle').addEventListener('change', (e) => {
    void setAllDecoys((e.target as HTMLInputElement).checked);
  });
  $('runBtn').addEventListener('click', () => void startRun());
  $('resetBtn').addEventListener('click', () => {
    backend.reset().then(endRunUi).catch((err) => toast('초기화 실패', errMsg(err), true));
  });
  $('pdfBtn').addEventListener('click', () => window.print());
  $('clearRunsBtn').addEventListener('click', () => {
    state.runs = [];
    store.set(RUNS_KEY, state.runs);
    renderRuns();
  });
  $('decoys').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const id = input.dataset.decoy as DecoyId | undefined;
    if (!id) return;
    backend.setDecoy(id, input.checked)
      .then(() => backend.getDecoys())
      .then((d) => { state.decoys = d; renderDecoys(); })
      .catch((err) => { toast('미끼 변경 실패', errMsg(err), true); renderDecoys(); });
  });
  $('actors').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const rel = target.closest<HTMLElement>('[data-release]');
    if (rel) {
      e.stopPropagation();
      backend.releaseActor(rel.dataset.release!).then(refreshActors)
        .catch((err) => toast('해제 실패', errMsg(err), true));
      return;
    }
    const card = target.closest<HTMLElement>('[data-actor]');
    if (card) void openActor(card.dataset.actor!);
  });
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tech]');
    if (t) openTechnique(t.dataset.tech!);
  });
  $('detailClose').addEventListener('click', () => $<HTMLDialogElement>('detailModal').close());
}

/** 토글 → 전체 켜기/끄기 후 초기화 (명세: PUT /ops/decoys 후 POST /ops/demo/reset) */
async function setAllDecoys(enabled: boolean): Promise<void> {
  const t = $<HTMLInputElement>('decoyToggle');
  t.disabled = true;
  try {
    await backend.setAllDecoys(enabled);
    await backend.reset();
    state.decoys = await backend.getDecoys();
    renderDecoys();
    endRunUi();
  } catch (err) {
    toast('미끼망 전환 실패', errMsg(err), true);
    t.checked = !enabled;
  } finally {
    t.disabled = false;
  }
}

const decoyOn = () => state.decoys.some((d) => d.enabled);

async function startRun(): Promise<void> {
  const mode = document.querySelector<HTMLInputElement>('input[name="runMode"]:checked')!.value as RunMode;
  state.run = { decoyOn: decoyOn(), mode, startedAt: Date.now() };
  state.ended = false;
  const btn = $<HTMLButtonElement>('runBtn');
  btn.disabled = true;
  btn.textContent = '실행 중…';
  systemLine(`공격 에이전트 실행 · ${mode === 'replay' ? '녹화 재생' : '실시간'} · 미끼망 ${state.run.decoyOn ? '켜짐' : '꺼짐'}`);
  renderConsole();
  try {
    await backend.run(mode);
  } catch (err) {
    toast('실행 실패', errMsg(err), true);
    endRunUi();
  }
}

/** agent가 마지막에 보내는 X-Agent-Note: __END__ 이벤트로 실행 종료를 판단 */
async function finishRun(): Promise<void> {
  const run = state.run;
  state.ended = true;
  endRunUi();
  try {
    const s = await backend.getStats();
    state.runs.push({
      ended_at: new Date().toISOString(),
      decoy_on: run ? run.decoyOn : decoyOn(),
      mode: run ? run.mode : '-',
      real_leaks: s.real_leaks,
      fake_records: s.fake_records,
      trap_hits: s.trap_hits,
      held_seconds: s.held_seconds,
      quarantined_actors: s.quarantined_actors,
    });
    store.set(RUNS_KEY, state.runs);
    renderRuns();
  } catch (err) {
    toast('결과 집계 실패', errMsg(err), true);
  }
}

function endRunUi(): void {
  state.run = null;
  const btn = $<HTMLButtonElement>('runBtn');
  btn.disabled = false;
  btn.textContent = '▶ 공격 시뮬레이션 실행';
  renderConsole();
}

// ---------- 콘솔 바 ----------

type Phase = 'breach' | 'trapped' | 'attack' | 'done' | 'idle';
const PHASE_LABEL: Record<Phase, string> = {
  breach: '실제 데이터 유출 중', trapped: '공격 주체 격리 중', attack: '공격 진행 중', done: '실행 종료', idle: '대기',
};

function renderConsole(): void {
  const s = state.stats;
  const leaks = s.real_leaks || 0;
  const key: Phase = leaks > 0 ? 'breach'
    : (s.quarantined_actors || 0) > 0 ? 'trapped'
    : state.run ? 'attack'
    : state.ended ? 'done' : 'idle';
  const phase = $('phase');
  phase.className = 'phase ' + key;
  phase.textContent = PHASE_LABEL[key];

  const r = $('riskBadge');
  r.className = 'risk-badge ' + (leaks > 0 ? 'CRITICAL' : (s.total_events || 0) > 0 ? 'SECURE' : '');
  r.textContent = 'LEAK ' + num(leaks);
  renderProgress();
}

function renderProgress(): void {
  const parts = ['요청 ' + num(state.stats.total_events)];
  if (state.run) parts.push('경과 ' + dur((Date.now() - state.run.startedAt) / 1000));
  $('progress').textContent = parts.join(' · ');
}

// ---------- 지표 ----------

function renderStats(s: Stats): void {
  if (!s) return;
  const last = state.stats;
  setKpi('kRealLeaks', num(s.real_leaks), s.real_leaks !== last.real_leaks);
  setKpi('kFake', num(s.fake_records), s.fake_records !== last.fake_records);
  setKpi('kTrap', num(s.trap_hits), s.trap_hits !== last.trap_hits);
  setKpi('kHeld', dur(s.held_seconds), false);
  setKpi('kActors', num(s.quarantined_actors), s.quarantined_actors !== last.quarantined_actors);

  // 가로챈 비율 = 공격자가 받은 레코드 중 가짜 비율
  const total = (s.real_leaks || 0) + (s.fake_records || 0);
  const pct = total ? Math.round((100 * s.fake_records) / total) : null;
  $('kCatch').textContent = pct === null ? '—' : String(pct);
  const ring = document.getElementById('ringFg') as unknown as SVGCircleElement;
  ring.style.strokeDasharray = `${((pct || 0) / 100) * RING_LEN} ${RING_LEN}`;
  ring.setAttribute('class', 'ring-fg ' + (pct === null ? '' : pct < 50 ? 'CRITICAL' : pct < 100 ? 'MEDIUM' : ''));

  state.stats = s;
  renderConsole();
}

function setKpi(id: string, text: string, bump: boolean): void {
  const el = $(id);
  el.textContent = text;
  if (bump && el.parentElement) {
    const card = el.parentElement;
    card.classList.remove('bump');
    void card.offsetWidth;
    card.classList.add('bump');
  }
}

// ---------- 기법 히트맵 ----------

function linkedIps(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [id, d] of Object.entries(state.details)) {
    for (const l of d.links || []) if (l.kind === 'ip') map[l.value] = id;
  }
  return map;
}

function renderTechniques(): void {
  const techs = (state.techniques = computeTechniques(state.events, linkedIps()));
  const breachN = techs.filter((t) => t.state === 'breach').length;
  const trapN = techs.filter((t) => t.state === 'defended').length;
  $('hmMeta').textContent = `뚫림 ${breachN} · 걸림 ${trapN} / ${techs.length}`;

  $('heatmap').innerHTML = techs.map((t) => {
    const prev = state.prevTech[t.id];
    const flash = t.state === 'breach' && prev && prev !== 'breach';
    return `<button type="button" class="cell ${t.state}${flash ? ' flash' : ''}" data-tech="${esc(t.id)}">` +
      `<span class="cid">${esc(t.id)}</span>` +
      `<span class="cname">${esc(t.name)}</span>` +
      `<span class="cval">${t.value === null ? '—' : num(t.value)}</span>` +
      `<span class="cbar"><i style="width:${Math.round(t.ratio * 100)}%"></i></span>` +
      `<span class="clabel">${esc(t.label)}</span>` +
    '</button>';
  }).join('');

  const c = (v: number, cls: string) => `<td class="num ${v ? cls : 'zero'}">${v ? num(v) : '—'}</td>`;
  $('techTable').innerHTML = techs.map((t) =>
    `<tr data-tech="${esc(t.id)}">` +
      `<td><span class="tn">${esc(t.name)}</span><span class="ti">${esc(t.id)}</span></td>` +
      c(t.attempts, '') + c(t.denied, 'amber') + c(t.trapped, 'green') + c(t.real, 'red') +
    '</tr>').join('');

  for (const t of techs) state.prevTech[t.id] = t.state;
}
const renderTechniquesSoon = debounce(renderTechniques, 150);

const STATE_TAG: Partial<Record<TechState, string>> = { breach: 'red', defended: 'green', near: 'amber' };

function openTechnique(id: string): void {
  const t = state.techniques.find((x) => x.id === id);
  if (!t) return;
  $('detailTitle').textContent = `${t.id} · ${t.name}`;
  const evs = t.events.slice(-60);
  const more = t.events.length > evs.length ? `, 최근 ${evs.length}건` : '';
  $('detailBody').innerHTML =
    '<dl class="dl">' +
      `<dt>판정</dt><dd><span class="tag ${STATE_TAG[t.state] || ''}">${esc(t.label)}</span></dd>` +
      `<dt>공격 방식</dt><dd>${esc(t.how)}</dd>` +
      `<dt>미끼망 대응</dt><dd>${esc(t.why)}</dd>` +
      `<dt>집계</dt><dd class="mono">시도 ${t.attempts} · 거부 ${t.denied} · 미끼 ${t.trapped} · 실제 성공 ${t.real}</dd>` +
    '</dl>' +
    `<div><h3>관련 요청 (${t.events.length}건${more})</h3>` +
    `<div class="timeline">${evs.map(eventHtml).join('') || '<div class="empty">관측된 요청이 없습니다.</div>'}</div></div>`;
  showDetail();
}

// ---------- 로그 ----------

function clearLog(): void {
  $('log').innerHTML = EMPTY_LOG;
  state.events = [];
  $('logCount').textContent = '0';
  renderTechniquesSoon();
}

function eventHtml(e: OpsEvent): string {
  const leak = e.routed_to === 'bank' && e.records_out > 0;
  const cls = 'row' + (leak ? ' leak' : '') + (e.routed_to === 'decoy' ? ' decoy' : '');
  const tags = [e.routed_to === 'decoy' ? '<span class="tag green">미끼</span>' : '<span class="tag">bank</span>'];
  if (e.decoy_id) tags.push(`<span class="tag blue">${esc(e.decoy_id)}</span>`);
  if (e.actor_id) tags.push(`<span class="tag amber">${esc(e.actor_id)}</span>`);
  if (e.records_out > 0) tags.push(`<span class="tag ${leak ? 'red' : 'green'}">+${num(e.records_out)}건</span>`);
  let html =
    `<div class="${cls}">` +
      `<span class="t">${time(e.ts)}</span>` +
      `<span class="ip">${esc(e.ip)}</span>` +
      `<span class="req" title="${esc(e.method + ' ' + e.path)}"><span class="m">${esc(e.method)}</span>${esc(e.path)}</span>` +
      `<span class="tags"><span class="st s${String(e.status)[0]}">${esc(e.status)}</span>${tags.join('')}</span>` +
    '</div>';
  if (e.agent_note && e.agent_note !== '__END__') {
    html += `<div class="row note"><span></span><span><span class="who">에이전트 판단 ›</span>${esc(e.agent_note)}</span></div>`;
  }
  return html;
}

function scrollLog(log: HTMLElement): void {
  if ($<HTMLInputElement>('autoScroll').checked) log.scrollTop = log.scrollHeight;
}

function appendEvent(e: OpsEvent): void {
  const log = $('log');
  document.getElementById('logEmpty')?.remove();
  if (e.agent_note === '__END__') {
    log.insertAdjacentHTML('beforeend', `<div class="row sys">── 실행 종료 · ${time(e.ts)} ──</div>`);
  } else {
    log.insertAdjacentHTML('beforeend', eventHtml(e));
    state.events.push(e);
    if (state.events.length > cfg.maxLogRows) state.events.shift();
    $('logCount').textContent = num(state.events.length);
  }
  while (log.children.length > cfg.maxLogRows) log.firstElementChild?.remove();
  scrollLog(log);
  renderTechniquesSoon();
}

function systemLine(text: string): void {
  const log = $('log');
  document.getElementById('logEmpty')?.remove();
  log.insertAdjacentHTML('beforeend', `<div class="row sys">▶ ${esc(text)}</div>`);
  scrollLog(log);
}

// ---------- 공격 주체 ----------

async function refreshActors(): Promise<void> {
  try {
    const list = await backend.getActors();
    state.actors = Object.fromEntries(list.map((a) => [a.id, a]));
    await Promise.all(list.map((a) =>
      backend.getActor(a.id).then((d) => { state.details[a.id] = d; }, () => {})));
    renderActors();
    renderTechniquesSoon();   // IP 묶음이 바뀌면 IP 교체 기법 판정도 바뀜
  } catch (err) {
    console.warn('actors', err);
  }
}
const refreshActorsSoon = debounce(() => void refreshActors(), 300);

function linkTag(l: ActorLink): string {
  const cls = l.confidence === '확정' ? 'green' : 'amber';
  return `<span class="tag ${cls}" title="${esc(l.confidence)}">${esc(l.value)}${l.confidence === '추정' ? ' · 추정' : ''}</span>`;
}

function renderActors(): void {
  const ids = Object.keys(state.actors).sort();
  $('actorMeta').textContent = `${ids.length}명`;
  if (!ids.length) {
    $('actors').innerHTML = '<div class="empty">탐지된 공격 주체가 없습니다.</div>';
    return;
  }
  $('actors').innerHTML = ids.map((id) => {
    const a = state.actors[id];
    const links = state.details[id]?.links || [];
    const ipLinks = links.filter((l) => l.kind === 'ip');
    const tokenCount = links.filter((l) => l.kind === 'token').length;
    const ips = ipLinks.length ? ipLinks.map(linkTag).join('') : '<span class="empty">IP 정보 없음</span>';
    const status: ActorStatus = a.status || 'watching';
    return `<div class="actor ${esc(status)}" data-actor="${esc(id)}">` +
      '<div class="actor-head">' +
        `<span class="actor-id">${esc(id)}</span>` +
        `<span class="tag ${status === 'quarantined' ? 'amber' : ''}">${esc(STATUS_LABEL[status] || status)}</span>` +
        `<span class="actor-score">점수 ${esc(a.score ?? '-')}</span>` +
      '</div>' +
      `<div class="actor-ips">${ips}</div>` +
      '<div class="actor-foot">' +
        `<span>IP ${ipLinks.length || a.ip_count || 0}개 · 토큰 ${tokenCount}개 · 마지막 ${time(a.last_seen)}</span>` +
        (status === 'quarantined' ? `<button class="btn btn-danger btn-sm" data-release="${esc(id)}">오탐 해제</button>` : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function openActor(id: string): Promise<void> {
  $('detailTitle').textContent = id;
  const body = $('detailBody');
  body.innerHTML = '<div class="empty">불러오는 중…</div>';
  showDetail();
  try {
    const d = await backend.getActor(id);
    const links = (d.links || []).map((l) =>
      `<div><span class="tag">${esc(l.kind)}</span>${esc(l.value)} ` +
      `<span class="tag ${l.confidence === '확정' ? 'green' : 'amber'}">${esc(l.confidence)}</span></div>`,
    ).join('') || '<div class="empty">묶인 값이 없습니다.</div>';
    const tl = (d.timeline || []).map(eventHtml).join('') || '<div class="empty">이벤트가 없습니다.</div>';
    body.innerHTML =
      `<div><h3>상태</h3>${esc(STATUS_LABEL[d.status] || d.status)} · 점수 ${esc(d.score)} · ${time(d.first_seen)} ~ ${time(d.last_seen)}</div>` +
      `<div><h3>묶인 IP · 세션 · 토큰</h3><div class="links">${links}</div></div>` +
      `<div><h3>타임라인 (${(d.timeline || []).length}건)</h3><div class="timeline">${tl}</div></div>`;
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(errMsg(err))}</div>`;
  }
}

function showDetail(): void {
  const dlg = $<HTMLDialogElement>('detailModal');
  if (!dlg.open) dlg.showModal();
}

// ---------- 미끼 ----------

function renderDecoys(): void {
  const on = state.decoys.filter((d) => d.enabled).length;
  $('decoyMeta').textContent = `${on} / ${state.decoys.length} 켜짐`;
  $<HTMLInputElement>('decoyToggle').checked = on > 0;
  $('decoyToggleLabel').textContent = on > 0 ? '미끼망 켜짐' : '미끼망 꺼짐';
  $('decoys').innerHTML = state.decoys.map((d) =>
    '<div class="decoy">' +
      '<div class="decoy-info">' +
        `<div class="decoy-id">${esc(DECOY_LABEL[d.id] || d.id)}</div>` +
        `<div class="decoy-path">${esc(d.id)} · ${esc(d.path)}</div>` +
      '</div>' +
      `<label class="switch sm"><input type="checkbox" data-decoy="${esc(d.id)}"${d.enabled ? ' checked' : ''}>` +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label>' +
    '</div>',
  ).join('') || '<div class="empty">미끼 정보를 불러오지 못했습니다.</div>';
}

// ---------- 실행 결과 비교 ----------

function renderRuns(): void {
  if (!state.runs.length) {
    $('runs').innerHTML = '<tr class="empty-row"><td colspan="9">실행이 끝나면 여기에 한 줄씩 쌓입니다.</td></tr>';
    return;
  }
  $('runs').innerHTML = state.runs.map((r, i) =>
    '<tr>' +
      `<td>${i + 1}</td>` +
      `<td class="mono">${time(r.ended_at)}</td>` +
      `<td>${r.decoy_on ? '<span class="tag green">켜짐</span>' : '<span class="tag red">꺼짐</span>'}</td>` +
      `<td>${r.mode === 'replay' ? '재생' : r.mode === 'live' ? '실시간' : '-'}</td>` +
      `<td class="num ${r.real_leaks > 0 ? 'red' : 'green'}">${num(r.real_leaks)}건</td>` +
      `<td class="num">${num(r.fake_records)}건</td>` +
      `<td class="num">${num(r.trap_hits)}</td>` +
      `<td class="num">${dur(r.held_seconds)}</td>` +
      `<td class="num">${num(r.quarantined_actors)}</td>` +
    '</tr>').join('');
}

// ---------- 알림 ----------

function toast(title: string, body: string, isErr = false): void {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 4500);
}

void boot();
