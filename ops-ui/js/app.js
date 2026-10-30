/**
 * 미끼망 관제실 화면.
 * 데이터 출처는 backend 하나뿐이고, live/mock 어느 쪽이든 같은 메서드와 같은 WS 메시지를 씁니다.
 * 기법 히트맵은 받은 이벤트로 화면에서 계산합니다 (js/techniques.js).
 */
(function () {
  var cfg = window.MIKKI_CONFIG;
  var esc = U.esc;
  var $ = function (id) { return document.getElementById(id); };

  var DECOY_LABEL = {
    robots: 'robots.txt 숨은 경로',
    admin_legacy: '가짜 관리자 화면',
    docs_bait: 'API 문서 속 안내문',
    endless_export: '끝없는 내보내기 API'
  };
  var STATUS_LABEL = { watching: '감시 중', quarantined: '격리됨', released: '해제됨' };
  var RING_LEN = 2 * Math.PI * 34;
  var RUNS_KEY = 'mikki.runs';

  var backend = null;
  var state = {
    decoys: [],
    events: [],          // 히트맵 계산용. 로그와 같은 개수만 유지
    actors: {},          // id → /ops/actors 행
    details: {},         // id → /ops/actors/{id} 응답
    toasted: {},         // 격리 알림을 이미 띄운 공격 주체
    stats: {},
    techniques: [],
    prevTech: {},        // 기법 id → 직전 상태 (뚫림 전환 시 깜빡임)
    run: null,           // 진행 중인 실행 {decoyOn, mode, startedAt}
    ended: false,
    runs: U.store.get(RUNS_KEY, [])
  };

  // ---------- 시작 ----------

  function pickBackend() {
    if (cfg.mode === 'mock') return Promise.resolve(MockBackend(cfg));
    var live = LiveBackend(cfg);
    if (cfg.mode === 'live') return Promise.resolve(live);
    return live.probe().then(function () { return live; }, function () {
      console.info('[미끼망] detector에 연결할 수 없어 목업으로 띄웁니다:', cfg.apiBase);
      return MockBackend(cfg);
    });
  }

  function boot() {
    bindControls();
    renderRuns();
    renderTechniques();
    renderConsole();
    setInterval(renderProgress, 1000);
    pickBackend().then(function (b) {
      backend = b;
      backend.connect(onMessage, setConn);
      loadAll();
    });
  }

  function loadAll() {
    return Promise.all([
      backend.getDecoys().then(function (d) { state.decoys = d; renderDecoys(); }),
      backend.getStats().then(renderStats),
      backend.getEvents().then(function (list) { clearLog(); list.forEach(appendEvent); }),
      refreshActors()
    ]).catch(function (err) { toast('불러오기 실패', err.message, true); });
  }

  // ---------- WS 메시지 ----------

  function onMessage(msg) {
    switch (msg.type) {
      case 'event':
        appendEvent(msg.data);
        if (msg.data.actor_id) refreshActorsSoon();
        if (msg.data.agent_note === '__END__') finishRun();
        break;
      case 'stats':
        renderStats(msg.data);
        break;
      case 'actor_update':
        onActorUpdate(msg.data || {});
        break;
      case 'reset':
        clearLog();
        state.actors = {}; state.details = {}; state.toasted = {}; state.prevTech = {};
        state.ended = false;
        renderActors();
        renderTechniquesSoon();
        break;
    }
  }

  function onActorUpdate(a) {
    if (!a.id) return;
    state.actors[a.id] = Object.assign({}, state.actors[a.id], a);
    if (a.status === 'quarantined' && !state.toasted[a.id]) {
      state.toasted[a.id] = true;
      // detector가 Discord로 보내는 문구와 같은 형식
      toast('Discord · 미끼망 알림', '[미끼망] ' + a.id + ' 격리 · IP ' + (a.ip_count || 1) + '개');
    }
    refreshActorsSoon();
  }

  function setConn(status) {
    var b = $('connBadge');
    b.className = 'badge ' + ({ live: 'live', mock: 'mock', down: 'down' }[status] || '');
    b.textContent = { live: '● LIVE', mock: 'MOCK', down: '연결 끊김 · 재시도 중', connecting: '연결 중' }[status] || status;
    b.title = status === 'mock' ? '백엔드 없이 목업 데이터를 보고 있습니다' : cfg.apiBase;
    // 재연결되면 놓친 상태를 다시 받음
    if (status === 'live' && backend && state.events.length) loadAll();
  }

  // ---------- 조작 ----------

  function bindControls() {
    $('decoyToggle').addEventListener('change', function (e) { setAllDecoys(e.target.checked); });
    $('runBtn').addEventListener('click', startRun);
    $('resetBtn').addEventListener('click', function () {
      backend.reset().then(endRunUi).catch(function (err) { toast('초기화 실패', err.message, true); });
    });
    $('pdfBtn').addEventListener('click', function () { window.print(); });
    $('clearRunsBtn').addEventListener('click', function () {
      state.runs = []; U.store.set(RUNS_KEY, state.runs); renderRuns();
    });
    $('decoys').addEventListener('change', function (e) {
      var id = e.target.dataset.decoy;
      if (!id) return;
      backend.setDecoy(id, e.target.checked).then(function () { return backend.getDecoys(); })
        .then(function (d) { state.decoys = d; renderDecoys(); })
        .catch(function (err) { toast('미끼 변경 실패', err.message, true); renderDecoys(); });
    });
    $('actors').addEventListener('click', function (e) {
      var rel = e.target.closest('[data-release]');
      if (rel) {
        e.stopPropagation();
        backend.releaseActor(rel.dataset.release).then(refreshActors)
          .catch(function (err) { toast('해제 실패', err.message, true); });
        return;
      }
      var card = e.target.closest('[data-actor]');
      if (card) openActor(card.dataset.actor);
    });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tech]');
      if (t) openTechnique(t.dataset.tech);
    });
    $('detailClose').addEventListener('click', function () { $('detailModal').close(); });
  }

  // 토글 → 전체 켜기/끄기 후 초기화 (명세: PUT /ops/decoys 후 POST /ops/demo/reset)
  function setAllDecoys(enabled) {
    var t = $('decoyToggle');
    t.disabled = true;
    backend.setAllDecoys(enabled)
      .then(function () { return backend.reset(); })
      .then(function () { return backend.getDecoys(); })
      .then(function (d) { state.decoys = d; renderDecoys(); endRunUi(); })
      .catch(function (err) { toast('미끼망 전환 실패', err.message, true); t.checked = !enabled; })
      .then(function () { t.disabled = false; });
  }

  function decoyOn() { return state.decoys.some(function (d) { return d.enabled; }); }

  function startRun() {
    var mode = document.querySelector('input[name="runMode"]:checked').value;
    state.run = { decoyOn: decoyOn(), mode: mode, startedAt: Date.now() };
    state.ended = false;
    var btn = $('runBtn');
    btn.disabled = true;
    btn.textContent = '실행 중…';
    systemLine('공격 에이전트 실행 · ' + (mode === 'replay' ? '녹화 재생' : '실시간') + ' · 미끼망 ' + (state.run.decoyOn ? '켜짐' : '꺼짐'));
    renderConsole();
    backend.run(mode).catch(function (err) {
      toast('실행 실패', err.message, true);
      endRunUi();
    });
  }

  // agent가 마지막에 보내는 X-Agent-Note: __END__ 이벤트로 실행 종료를 판단
  function finishRun() {
    var run = state.run || { decoyOn: decoyOn(), mode: '-' };
    backend.getStats().then(function (s) {
      state.runs.push({
        ended_at: new Date().toISOString(), decoy_on: run.decoyOn, mode: run.mode,
        real_leaks: s.real_leaks, fake_records: s.fake_records, trap_hits: s.trap_hits,
        held_seconds: s.held_seconds, quarantined_actors: s.quarantined_actors
      });
      U.store.set(RUNS_KEY, state.runs);
      renderRuns();
    }).catch(function (err) { toast('결과 집계 실패', err.message, true); });
    state.ended = true;
    endRunUi();
  }

  function endRunUi() {
    state.run = null;
    var btn = $('runBtn');
    btn.disabled = false;
    btn.textContent = '▶ 공격 시뮬레이션 실행';
    renderConsole();
  }

  // ---------- 콘솔 바 ----------

  function renderConsole() {
    var s = state.stats;
    var phase = $('phase');
    var key = s.real_leaks > 0 ? 'breach'
      : s.quarantined_actors > 0 ? 'trapped'
      : state.run ? 'attack'
      : state.ended ? 'done' : 'idle';
    phase.className = 'phase ' + key;
    phase.textContent = {
      breach: '실제 데이터 유출 중', trapped: '공격 주체 격리 중', attack: '공격 진행 중', done: '실행 종료', idle: '대기'
    }[key];
    if (key === 'done' && s.real_leaks > 0) phase.textContent = '종료 · 실제 유출 있음';

    var r = $('riskBadge');
    r.className = 'risk-badge ' + (s.real_leaks > 0 ? 'CRITICAL' : s.total_events > 0 ? 'SECURE' : '');
    r.textContent = 'LEAK ' + U.num(s.real_leaks);
    renderProgress();
  }

  function renderProgress() {
    var s = state.stats;
    var parts = ['요청 ' + U.num(s.total_events)];
    if (state.run) parts.push('경과 ' + U.dur((Date.now() - state.run.startedAt) / 1000));
    $('progress').textContent = parts.join(' · ');
  }

  // ---------- 지표 ----------

  function renderStats(s) {
    if (!s) return;
    var last = state.stats;
    setKpi('kRealLeaks', U.num(s.real_leaks), s.real_leaks !== last.real_leaks);
    setKpi('kFake', U.num(s.fake_records), s.fake_records !== last.fake_records);
    setKpi('kTrap', U.num(s.trap_hits), s.trap_hits !== last.trap_hits);
    setKpi('kHeld', U.dur(s.held_seconds), false);
    setKpi('kActors', U.num(s.quarantined_actors), s.quarantined_actors !== last.quarantined_actors);

    // 가로챈 비율 = 공격자가 받은 레코드 중 가짜 비율
    var total = (s.real_leaks || 0) + (s.fake_records || 0);
    var pct = total ? Math.round(100 * s.fake_records / total) : null;
    $('kCatch').textContent = pct === null ? '—' : pct;
    var ring = $('ringFg');
    ring.style.strokeDasharray = ((pct || 0) / 100 * RING_LEN) + ' ' + RING_LEN;
    ring.setAttribute('class', 'ring-fg ' + (pct === null ? '' : pct < 50 ? 'CRITICAL' : pct < 100 ? 'MEDIUM' : ''));

    state.stats = s;
    renderConsole();
  }

  function setKpi(id, text, bump) {
    var el = $(id);
    el.textContent = text;
    if (bump) {
      var card = el.parentNode;
      card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump');
    }
  }

  // ---------- 기법 히트맵 ----------

  function linkedIps() {
    var map = {};
    Object.keys(state.details).forEach(function (id) {
      (state.details[id].links || []).forEach(function (l) { if (l.kind === 'ip') map[l.value] = id; });
    });
    return map;
  }

  function renderTechniques() {
    var techs = state.techniques = Techniques.compute(state.events, linkedIps());
    var breachN = techs.filter(function (t) { return t.state === 'breach'; }).length;
    var trapN = techs.filter(function (t) { return t.state === 'defended'; }).length;
    $('hmMeta').textContent = '뚫림 ' + breachN + ' · 걸림 ' + trapN + ' / ' + techs.length;

    $('heatmap').innerHTML = techs.map(function (t) {
      var flash = t.state === 'breach' && state.prevTech[t.id] && state.prevTech[t.id] !== 'breach';
      return '<button type="button" class="cell ' + t.state + (flash ? ' flash' : '') + '" data-tech="' + esc(t.id) + '">' +
        '<span class="cid">' + esc(t.id) + '</span>' +
        '<span class="cname">' + esc(t.name) + '</span>' +
        '<span class="cval">' + (t.value === null ? '—' : U.num(t.value)) + '</span>' +
        '<span class="cbar"><i style="width:' + Math.round(t.ratio * 100) + '%"></i></span>' +
        '<span class="clabel">' + esc(t.label) + '</span>' +
      '</button>';
    }).join('');

    $('techTable').innerHTML = techs.map(function (t) {
      function c(v, cls) { return '<td class="num ' + (v ? cls : 'zero') + '">' + (v ? U.num(v) : '—') + '</td>'; }
      return '<tr data-tech="' + esc(t.id) + '">' +
        '<td><span class="tn">' + esc(t.name) + '</span><span class="ti">' + esc(t.id) + '</span></td>' +
        c(t.attempts, '') + c(t.denied, 'amber') + c(t.trapped, 'green') + c(t.real, 'red') +
      '</tr>';
    }).join('');

    techs.forEach(function (t) { state.prevTech[t.id] = t.state; });
  }
  var renderTechniquesSoon = U.debounce(renderTechniques, 150);

  function openTechnique(id) {
    var t = state.techniques.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    $('detailTitle').textContent = t.id + ' · ' + t.name;
    var evs = t.events.slice(-60);
    $('detailBody').innerHTML =
      '<dl class="dl">' +
        '<dt>판정</dt><dd><span class="tag ' + ({ breach: 'red', defended: 'green', near: 'amber' }[t.state] || '') + '">' + esc(t.label) + '</span></dd>' +
        '<dt>공격 방식</dt><dd>' + esc(t.how) + '</dd>' +
        '<dt>미끼망 대응</dt><dd>' + esc(t.why) + '</dd>' +
        '<dt>집계</dt><dd class="mono">시도 ' + t.attempts + ' · 거부 ' + t.denied + ' · 미끼 ' + t.trapped + ' · 실제 성공 ' + t.real + '</dd>' +
      '</dl>' +
      '<div><h3>관련 요청 (' + t.events.length + '건' + (t.events.length > evs.length ? ', 최근 ' + evs.length + '건' : '') + ')</h3>' +
      '<div class="timeline">' + (evs.map(eventHtml).join('') || '<div class="empty">관측된 요청이 없습니다.</div>') + '</div></div>';
    showDetail();
  }

  // ---------- 로그 ----------

  function clearLog() {
    $('log').innerHTML = '<div class="empty" id="logEmpty">아직 들어온 요청이 없습니다. "공격 시뮬레이션 실행"을 눌러 보세요.</div>';
    state.events = [];
    $('logCount').textContent = '0';
    renderTechniquesSoon();
  }

  function eventHtml(e) {
    var leak = e.routed_to === 'bank' && e.records_out > 0;
    var cls = 'row' + (leak ? ' leak' : '') + (e.routed_to === 'decoy' ? ' decoy' : '');
    var tags = [];
    tags.push(e.routed_to === 'decoy' ? '<span class="tag green">미끼</span>' : '<span class="tag">bank</span>');
    if (e.decoy_id) tags.push('<span class="tag blue">' + esc(e.decoy_id) + '</span>');
    if (e.actor_id) tags.push('<span class="tag amber">' + esc(e.actor_id) + '</span>');
    if (e.records_out > 0) tags.push('<span class="tag ' + (leak ? 'red' : 'green') + '">+' + U.num(e.records_out) + '건</span>');
    var html =
      '<div class="' + cls + '">' +
        '<span class="t">' + U.time(e.ts) + '</span>' +
        '<span class="ip">' + esc(e.ip) + '</span>' +
        '<span class="req" title="' + esc(e.method + ' ' + e.path) + '"><span class="m">' + esc(e.method) + '</span>' + esc(e.path) + '</span>' +
        '<span class="tags"><span class="st s' + String(e.status)[0] + '">' + esc(e.status) + '</span>' + tags.join('') + '</span>' +
      '</div>';
    if (e.agent_note && e.agent_note !== '__END__') {
      html += '<div class="row note"><span></span><span><span class="who">에이전트 판단 ›</span>' + esc(e.agent_note) + '</span></div>';
    }
    return html;
  }

  function appendEvent(e) {
    var log = $('log');
    var empty = $('logEmpty');
    if (empty) empty.remove();
    if (e.agent_note === '__END__') {
      log.insertAdjacentHTML('beforeend', '<div class="row sys">── 실행 종료 · ' + U.time(e.ts) + ' ──</div>');
    } else {
      log.insertAdjacentHTML('beforeend', eventHtml(e));
      state.events.push(e);
      if (state.events.length > cfg.maxLogRows) state.events.shift();
      $('logCount').textContent = U.num(state.events.length);
    }
    while (log.children.length > cfg.maxLogRows) log.firstChild.remove();
    if ($('autoScroll').checked) log.scrollTop = log.scrollHeight;
    renderTechniquesSoon();
  }

  function systemLine(text) {
    var empty = $('logEmpty');
    if (empty) empty.remove();
    var log = $('log');
    log.insertAdjacentHTML('beforeend', '<div class="row sys">▶ ' + esc(text) + '</div>');
    if ($('autoScroll').checked) log.scrollTop = log.scrollHeight;
  }

  // ---------- 공격 주체 ----------

  function refreshActors() {
    return backend.getActors().then(function (list) {
      var next = {};
      list.forEach(function (a) { next[a.id] = a; });
      state.actors = next;
      return Promise.all(list.map(function (a) {
        return backend.getActor(a.id).then(function (d) { state.details[a.id] = d; }, function () {});
      }));
    }).then(function () {
      renderActors();
      renderTechniquesSoon();   // IP 묶음이 바뀌면 IP 교체 기법 판정도 바뀜
    }).catch(function (err) { console.warn('actors', err); });
  }
  var refreshActorsSoon = U.debounce(refreshActors, 300);

  function linkTag(l) {
    var cls = l.confidence === '확정' ? 'green' : 'amber';
    return '<span class="tag ' + cls + '" title="' + esc(l.confidence) + '">' + esc(l.value) +
      (l.confidence === '추정' ? ' · 추정' : '') + '</span>';
  }

  function renderActors() {
    var ids = Object.keys(state.actors).sort();
    $('actorMeta').textContent = ids.length + '명';
    if (!ids.length) {
      $('actors').innerHTML = '<div class="empty">탐지된 공격 주체가 없습니다.</div>';
      return;
    }
    $('actors').innerHTML = ids.map(function (id) {
      var a = state.actors[id];
      var d = state.details[id] || {};
      var ipLinks = (d.links || []).filter(function (l) { return l.kind === 'ip'; });
      var tokenCount = (d.links || []).filter(function (l) { return l.kind === 'token'; }).length;
      var ips = ipLinks.length ? ipLinks.map(linkTag).join('') : '<span class="empty">IP 정보 없음</span>';
      var status = a.status || 'watching';
      return '<div class="actor ' + esc(status) + '" data-actor="' + esc(id) + '">' +
        '<div class="actor-head">' +
          '<span class="actor-id">' + esc(id) + '</span>' +
          '<span class="tag ' + (status === 'quarantined' ? 'amber' : '') + '">' + esc(STATUS_LABEL[status] || status) + '</span>' +
          '<span class="actor-score">점수 ' + esc(a.score != null ? a.score : '-') + '</span>' +
        '</div>' +
        '<div class="actor-ips">' + ips + '</div>' +
        '<div class="actor-foot">' +
          '<span>IP ' + (ipLinks.length || a.ip_count || 0) + '개 · 토큰 ' + tokenCount + '개 · 마지막 ' + U.time(a.last_seen) + '</span>' +
          (status === 'quarantined' ? '<button class="btn btn-danger btn-sm" data-release="' + esc(id) + '">오탐 해제</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openActor(id) {
    $('detailTitle').textContent = id;
    $('detailBody').innerHTML = '<div class="empty">불러오는 중…</div>';
    showDetail();
    backend.getActor(id).then(function (d) {
      var links = (d.links || []).map(function (l) {
        return '<div><span class="tag">' + esc(l.kind) + '</span>' + esc(l.value) +
          ' <span class="tag ' + (l.confidence === '확정' ? 'green' : 'amber') + '">' + esc(l.confidence) + '</span></div>';
      }).join('') || '<div class="empty">묶인 값이 없습니다.</div>';
      var tl = (d.timeline || []).map(eventHtml).join('') || '<div class="empty">이벤트가 없습니다.</div>';
      $('detailBody').innerHTML =
        '<div><h3>상태</h3>' + esc(STATUS_LABEL[d.status] || d.status) + ' · 점수 ' + esc(d.score) +
          ' · ' + U.time(d.first_seen) + ' ~ ' + U.time(d.last_seen) + '</div>' +
        '<div><h3>묶인 IP · 세션 · 토큰</h3><div class="links">' + links + '</div></div>' +
        '<div><h3>타임라인 (' + (d.timeline || []).length + '건)</h3><div class="timeline">' + tl + '</div></div>';
    }).catch(function (err) {
      $('detailBody').innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
    });
  }

  function showDetail() {
    var dlg = $('detailModal');
    if (!dlg.open) dlg.showModal();
  }

  // ---------- 미끼 ----------

  function renderDecoys() {
    var on = state.decoys.filter(function (d) { return d.enabled; }).length;
    $('decoyMeta').textContent = on + ' / ' + state.decoys.length + ' 켜짐';
    $('decoyToggle').checked = on > 0;
    $('decoyToggleLabel').textContent = on > 0 ? '미끼망 켜짐' : '미끼망 꺼짐';
    $('decoys').innerHTML = state.decoys.map(function (d) {
      return '<div class="decoy">' +
        '<div class="decoy-info">' +
          '<div class="decoy-id">' + esc(DECOY_LABEL[d.id] || d.id) + '</div>' +
          '<div class="decoy-path">' + esc(d.id) + ' · ' + esc(d.path) + '</div>' +
        '</div>' +
        '<label class="switch sm"><input type="checkbox" data-decoy="' + esc(d.id) + '"' + (d.enabled ? ' checked' : '') + '>' +
          '<span class="switch-track"><span class="switch-thumb"></span></span></label>' +
      '</div>';
    }).join('') || '<div class="empty">미끼 정보를 불러오지 못했습니다.</div>';
  }

  // ---------- 실행 결과 비교 ----------

  function renderRuns() {
    if (!state.runs.length) {
      $('runs').innerHTML = '<tr class="empty-row"><td colspan="9">실행이 끝나면 여기에 한 줄씩 쌓입니다.</td></tr>';
      return;
    }
    $('runs').innerHTML = state.runs.map(function (r, i) {
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td class="mono">' + U.time(r.ended_at) + '</td>' +
        '<td>' + (r.decoy_on ? '<span class="tag green">켜짐</span>' : '<span class="tag red">꺼짐</span>') + '</td>' +
        '<td>' + (r.mode === 'replay' ? '재생' : r.mode === 'live' ? '실시간' : '-') + '</td>' +
        '<td class="num ' + (r.real_leaks > 0 ? 'red' : 'green') + '">' + U.num(r.real_leaks) + '건</td>' +
        '<td class="num">' + U.num(r.fake_records) + '건</td>' +
        '<td class="num">' + U.num(r.trap_hits) + '</td>' +
        '<td class="num">' + U.dur(r.held_seconds) + '</td>' +
        '<td class="num">' + U.num(r.quarantined_actors) + '</td>' +
      '</tr>';
    }).join('');
  }

  // ---------- 알림 ----------

  function toast(title, body, isErr) {
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.innerHTML = '<b>' + esc(title) + '</b>' + esc(body);
    $('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, isErr ? 6000 : 4500);
  }

  boot();
})();
