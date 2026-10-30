/**
 * 화면 렌더링
 * 상태 객체(state) 하나를 받아 전체 대시보드를 갱신한다.
 * LLM이 만든 텍스트(thought, message, reason)가 들어오므로 모든 문자열은 esc()로 이스케이프한다.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var RING_C = 2 * Math.PI * 34;

  var LABEL = {
    attack: '공격 AI', breach: '침투 감지', analysis: '방어 AI',
    rule_applied: '룰 적용', verify: '재공격 검증', end: '종료'
  };
  var PHASE = {
    idle: '대기', attack: '공격 진행 중', breach: '침투 발생', rule_generated: '방어 룰 생성 중',
    rule_applied: '룰 적용됨', verified: '재공격 차단 확인', done: '훈련 종료'
  };
  var RULE_STATUS = { generated: '생성됨', applied: '적용됨', verified: '차단 검증됨' };
  var ROUND_STATUS = { pending: '대기', running: '진행 중', verified: '차단 검증' };
  var CELL_LABEL = { breach: '침투 · 침투 성공', near: '위험 근접 · 아직 실패', defended: '방어', untested: '미테스트' };

  var view = {
    lastSeq: 0,          // 타임라인에 그린 마지막 이벤트 번호
    filter: 'all',
    prevTech: {},        // 상태 변화 감지(깜빡임 효과)
    ruleKeys: '',
    selected: null,      // 상세창에 띄운 기법 id
    state: null
  };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { return (v === null || v === undefined) ? (d || '—') : v; }
  function fmtFit(f) { return (f === null || f === undefined) ? '—' : Number(f).toFixed(2); }

  /* ---------- 콘솔 ---------- */
  function renderConsole(s) {
    document.querySelectorAll('[data-bind="scenarioId"]').forEach(function (el) {
      el.textContent = (s.scenario && s.scenario.id) || 'scenario';
    });
    var ph = $('phase');
    ph.className = 'phase ' + (s.phase || 'idle');
    var phaseText = PHASE[s.phase] || s.phase || '대기';
    if (s.round) phaseText = '라운드 ' + s.round + (s.total_rounds ? '/' + s.total_rounds : '') + ' · ' + phaseText;
    ph.textContent = phaseText;

    var rb = $('riskBadge');
    rb.className = 'risk-badge ' + (s.risk_level || '');
    rb.textContent = 'RISK ' + num(s.risk) + '/100 · ' + (s.risk_level || '—');

    var prog = $('progress');
    if (s.total_steps) prog.textContent = s.step + ' / ' + s.total_steps + ' 이벤트';
    else prog.textContent = '이벤트 ' + ((s.events && s.events.length) || 0) + '건';
  }

  /* ---------- KPI ---------- */
  function renderKpis(s) {
    var k = s.kpi || {};
    var risk = s.risk || 0;
    $('kRisk').textContent = num(s.risk);
    var ring = $('ringFg');
    ring.setAttribute('class', 'ring-fg ' + (s.risk_level || ''));
    ring.style.strokeDasharray = (RING_C * risk / 100).toFixed(1) + ' ' + RING_C.toFixed(1);
    $('kRisk').parentNode.className = 'kpi-v ' + (risk >= 80 ? 'red' : risk >= 40 ? 'amber' : 'green');

    $('kAttempts').textContent = num(k.total_attempts);
    $('kAttemptsSub').textContent = '총 공격 시도' + (k.reattack_total ? ' · 재공격 검증 ' + k.reattack_total + '회 포함' : '');

    $('kBreaches').textContent = num(k.breaches);
    $('kBreachSub').textContent = '침투 성공 · ' + (k.breach_rate != null ? k.breach_rate.toFixed(1) + '%' : '—');

    $('kRules').textContent = num(k.rules_applied);
    var rate = k.reattack_total ? Math.round(100 * k.reattack_blocked / k.reattack_total) + '%' : '—';
    $('kRulesSub').innerHTML = '적용된 방어 룰 · 재공격 차단 <b>' + esc(rate) + '</b>';
  }

  /* ---------- 히트맵 + 기법 표 ---------- */
  function renderTechniques(s) {
    var techs = s.techniques || [];
    var breachN = techs.filter(function (t) { return t.state === 'breach'; }).length;
    var defN = techs.filter(function (t) { return t.state === 'defended'; }).length;
    $('hmMeta').textContent = techs.length + ' techniques · ' + breachN + ' breach · ' + defN + ' defended';

    // 바뀐 게 없으면 다시 그리지 않음 (폴링마다 포커스가 날아가는 것 방지)
    var key = JSON.stringify([view.selected, techs]);
    if (key === view.techKey) return;
    view.techKey = key;

    $('heatmap').innerHTML = techs.map(function (t) {
      var st = t.state || 'untested';
      var prev = view.prevTech[t.id];
      var flash = prev && prev !== st && st === 'breach' ? ' flash' : '';
      var sel = view.selected === t.id ? ' selected' : '';
      var val, bar, label;
      if (st === 'defended') {
        val = (t.fitness_peak ? '<span class="was">' + fmtFit(t.fitness_peak) + '</span>' : '') + fmtFit(0);
        bar = 100;
        label = '방어 · ' + fmtFit(t.fitness_peak) + ' → 0.00' + (t.rule_id ? ' · ' + esc(t.rule_id) : '');
      } else {
        val = fmtFit(t.fitness);
        bar = Math.round((t.fitness || 0) * 100);
        label = CELL_LABEL[st] || st;
        if (st === 'breach' && t.fitness < 1) label = '부분 성공 · fitness ' + fmtFit(t.fitness);
      }
      return '<button type="button" class="cell ' + st + sel + flash + '" data-tech="' + esc(t.id) + '" aria-label="' + esc(t.name) + ' 상세 보기">' +
        '<span class="cid">' + esc(t.id) + '</span>' +
        '<span class="cname">' + esc(t.name) + '</span>' +
        '<span class="cval">' + val + '</span>' +
        '<span class="cbar"><i style="width:' + bar + '%"></i></span>' +
        '<span class="clabel">' + label + '</span>' +
      '</button>';
    }).join('');

    $('techTable').innerHTML = techs.map(function (t) {
      function c(v, cls) { return '<td class="n ' + (v ? cls : 'zero') + '">' + (v ? v : '—') + '</td>'; }
      return '<tr data-tech="' + esc(t.id) + '">' +
        '<td><span class="tn">' + esc(t.name) + '</span><span class="ti">' + esc(t.id) + '</span></td>' +
        '<td class="n">' + num(t.attempts, 0) + '</td>' +
        c(t.blocked, 'green') + c(t.partial, 'amber') + c(t.breached, 'red') +
      '</tr>';
    }).join('');

    techs.forEach(function (t) { view.prevTech[t.id] = t.state; });
  }

  /* ---------- 타임라인 (증분 렌더) ---------- */
  function eventHTML(e) {
    var head = '<div class="head"><span class="lab">' + esc(LABEL[e.type] || e.type) + '</span>' +
      '<span class="meta">라운드 ' + esc(e.round) + (e.technique ? ' · <code>' + esc(e.technique) + '</code>' : '') + '</span></div>';
    var body = '';
    if (e.request) {
      var ok = e.status && /(^|\s)2\d\d/.test(String(e.status));
      body += '<div class="req">' + (e.src_ip ? '<span class="ip">' + esc(e.src_ip) + '</span>' : '') + esc(e.request) +
        (e.status ? '<span class="code' + (ok ? ' ok2xx' : '') + '">' + esc(e.status) + '</span>' : '') + '</div>';
    }
    if (e.thought) body += '<div class="thought">에이전트 판단 · ' + esc(e.thought) + '</div>';
    if (e.message) body += '<div class="msg">' + esc(e.message) + '</div>';
    return '<span class="t">' + esc(e.time || '') + '</span><div>' + head + body + '</div>';
  }

  function renderTimeline(s) {
    var list = $('timeline');
    var events = s.events || [];
    var maxSeq = events.length ? events[events.length - 1].seq : 0;

    // 재시작(초기화)되면 처음부터 다시 그림
    if (maxSeq < view.lastSeq) { list.innerHTML = ''; view.lastSeq = 0; }

    if (!events.length) {
      list.innerHTML = '<li class="empty">재생하거나 백엔드가 라운드를 시작하면 공격 AI의 요청과 판단, 방어 AI의 룰, 재공격 검증 결과가 순서대로 쌓입니다.</li>';
      view.lastSeq = 0;
      return;
    }
    var empty = list.querySelector('.empty');
    if (empty) empty.remove();

    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    var added = false;
    events.forEach(function (e) {
      if (e.seq <= view.lastSeq) return;
      var li = document.createElement('li');
      li.className = 'ev ' + (e.type || '') + (matchFilter(e) ? '' : ' hide');
      li.dataset.side = e.side || '';
      li.innerHTML = eventHTML(e);
      list.appendChild(li);
      added = true;
    });
    view.lastSeq = maxSeq;
    if (added && $('followChk').checked && (nearBottom || list.children.length < 4)) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function matchFilter(e) { return view.filter === 'all' || e.side === view.filter; }

  function applyFilter() {
    document.querySelectorAll('#timeline .ev').forEach(function (li) {
      var show = view.filter === 'all' || li.dataset.side === view.filter;
      li.classList.toggle('hide', !show);
    });
  }

  /* ---------- 방어 룰 ---------- */
  function renderRules(s) {
    var rules = s.rules || [];
    var verified = rules.filter(function (r) { return r.status === 'verified'; }).length;
    $('rlMeta').textContent = rules.length + '개 생성 · ' + verified + '개 차단 검증';

    var key = JSON.stringify(rules.map(function (r) { return [r.id, r.status, r.reattack_total]; }));
    if (key === view.ruleKeys) return;
    var hadPrev = view.ruleKeys !== '';
    var prevIds = hadPrev ? JSON.parse(view.ruleKeys).map(function (x) { return x[0]; }) : [];
    view.ruleKeys = key;

    if (!rules.length) { $('rules').innerHTML = '<p class="empty">아직 침투가 없어 생성된 룰이 없습니다.</p>'; return; }

    $('rules').innerHTML = rules.slice().reverse().map(function (r) {
      var isNew = hadPrev && prevIds.indexOf(r.id) < 0 ? ' new' : '';
      var verify = '';
      if (r.reattack_total != null) {
        verify = '<div class="rv"><span class="good">재공격 ' + esc(r.reattack_success) + '/' + esc(r.reattack_total) + ' 성공</span>' +
          '<span class="' + (r.false_positive ? 'warn' : 'good') + '">오탐 ' + esc(Number(r.false_positive).toFixed(1)) + '%</span></div>';
      } else {
        verify = '<div class="rv"><span>재공격 검증 대기</span></div>';
      }
      return '<article class="rule' + isNew + '">' +
        '<div class="top"><span class="rid">' + esc(r.id) + '</span><span class="rtitle">' + esc(r.title) + '</span>' +
        '<span class="rstatus ' + esc(r.status) + '">' + esc(RULE_STATUS[r.status] || r.status) + '</span></div>' +
        '<div class="reason">라운드 ' + esc(r.round) + ' · ' + esc(r.technique) + ' · ' + esc(r.reason) + '</div>' +
        '<pre>' + esc(JSON.stringify(r.rule, null, 2)) + '</pre>' + verify +
      '</article>';
    }).join('');
  }

  /* ---------- 라운드 요약 ---------- */
  function renderRounds(s) {
    var rounds = s.rounds || [];
    var key = JSON.stringify(rounds);
    if (key === view.roundKey) return;
    view.roundKey = key;
    $('roundTable').innerHTML = rounds.map(function (r) {
      var accts = r.accounts && r.accounts.length ? r.accounts.join(', ') : (r.status === 'pending' ? '—' : '공격 중');
      var res = r.reattack_total != null ? '성공 ' + r.reattack_success + ' / ' + r.reattack_total + '회' : '—';
      var fp = r.false_positive != null ? Number(r.false_positive).toFixed(1) + '%' : '—';
      return '<tr>' +
        '<td class="mono">R' + esc(r.round) + '</td>' +
        '<td>' + esc(r.technique) + ' ' + esc(r.label || '') + '</td>' +
        '<td class="' + (r.accounts && r.accounts.length ? 'red' : 'muted') + '">' + esc(accts) + '</td>' +
        '<td class="mono">' + esc(r.rule_id || '—') + '</td>' +
        '<td class="' + (r.reattack_total != null ? (r.reattack_success ? 'red' : 'green') : 'muted') + '">' + esc(res) + '</td>' +
        '<td class="mono ' + (r.false_positive ? 'amber' : (r.false_positive === 0 ? 'green' : 'muted')) + '">' + esc(fp) + '</td>' +
        '<td><span class="st-pill ' + esc(r.status) + '">' + esc(ROUND_STATUS[r.status] || r.status) + '</span></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------- 기법 상세 ---------- */
  function openDetail(id) {
    var s = view.state; if (!s) return;
    var t = (s.techniques || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    view.selected = id;
    var d = t.detail || {};
    var rule = (s.rules || []).filter(function (r) { return r.id === t.rule_id; })[0];
    $('dlgTitle').textContent = 'technique.detail — ' + t.id;
    $('dlgBody').innerHTML =
      '<dl class="dl">' +
        '<dt>기법</dt><dd><b>' + esc(t.name) + '</b>' + (t.name_ko ? ' · ' + esc(t.name_ko) : '') + '</dd>' +
        '<dt>fitness</dt><dd class="big">' + fmtFit(t.fitness_peak || t.fitness) + ' → ' + fmtFit(t.fitness) + '</dd>' +
        '<dt>상태</dt><dd>' + esc(CELL_LABEL[t.state] || t.state) + '</dd>' +
        '<dt>시도 / 뚫림</dt><dd class="mono">' + num(t.attempts, 0) + ' / ' + num(t.breached, 0) + (t.partial ? ' (부분 ' + t.partial + ')' : '') + '</dd>' +
        '<dt>공격 방식</dt><dd>' + esc(d.how || '—') + '</dd>' +
        '<dt>뚫린 이유</dt><dd>' + esc(d.why || '—') + '</dd>' +
        '<dt>방어 룰</dt><dd>' + esc(d.rule || '아직 없음') + '</dd>' +
      '</dl>' +
      (rule ? '<div class="rule"><pre>' + esc(JSON.stringify(rule.rule, null, 2)) + '</pre></div>' : '');
    var dlg = $('techDialog');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else { dlg.setAttribute('open', ''); }
    renderTechniques(s);
  }

  /* ---------- 전체 갱신 ---------- */
  function render(s) {
    view.state = s;
    renderConsole(s);
    renderKpis(s);
    renderTechniques(s);
    renderTimeline(s);
    renderRules(s);
    renderRounds(s);
  }

  function setConn(kind, text) {
    var c = $('conn');
    c.className = 'conn ' + kind;
    c.textContent = text;
  }

  /* ---------- 이벤트 바인딩 ---------- */
  function bind() {
    $('controls').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'play' || b.dataset.action === 'reset') { $('followChk').checked = true; }
      window.RediAPI.control(b.dataset.action).catch(function (e) {
        setConn('err', '제어 실패 · ' + e.message);
      });
    });

    document.addEventListener('click', function (ev) {
      var cell = ev.target.closest('[data-tech]');
      if (cell) openDetail(cell.dataset.tech);
    });
    $('techDialog').addEventListener('close', function () {
      view.selected = null;
      if (view.state) renderTechniques(view.state);
    });

    document.querySelector('.filters').addEventListener('click', function (ev) {
      var chip = ev.target.closest('[data-filter]');
      if (!chip) return;
      view.filter = chip.dataset.filter;
      document.querySelectorAll('.filters .chip').forEach(function (c) {
        var on = c === chip;
        c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', String(on));
      });
      applyFilter();
    });

    $('pdfBtn').addEventListener('click', function () { window.print(); });
  }

  /* ---------- 시작 ---------- */
  bind();
  window.RediAPI.init().then(function (mode) {
    if (mode === 'mock') setConn('mock', 'MOCK · 샘플 데이터');
    else setConn('live', 'LIVE · ' + (window.REDI_CONFIG.apiBase || location.host));
    window.RediAPI.start(
      function (s) {
        if (window.RediAPI.mode() === 'live') setConn('live', 'LIVE · ' + (window.REDI_CONFIG.apiBase || location.host));
        render(s);
      },
      function (e) { setConn('err', '연결 끊김 · 재시도 중 (' + e.message + ')'); }
    );
  });
})();
