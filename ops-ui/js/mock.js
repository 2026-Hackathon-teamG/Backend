/**
 * 백엔드 없이 화면을 띄우기 위한 목업. LiveBackend와 같은 메서드를 가집니다.
 * detector의 stats 계산식(db.stats)과 WS 메시지 형식을 그대로 흉내 냅니다.
 *
 * 시나리오는 시연 2·3장면과 같습니다.
 *   미끼망 꺼짐: X-Internal-Request 헤더로 인증을 우회해 실제 고객 데이터를 가져감
 *   미끼망 켜짐: /admin-legacy와 API 문서 속 안내문에 걸려 /api/internal/export에 갇힘
 */
window.MockBackend = function (cfg) {
  var IPS = ['203.0.113.24', '198.51.100.7', '192.0.2.55'];
  var UA = 'python-httpx/0.27.0';
  var HH = 'a41f0c';

  var decoys = [
    { id: 'admin_legacy',   kind: 'page',   path: '/admin-legacy',         enabled: true },
    { id: 'docs_bait',      kind: 'inject', path: '/api/v1/docs',          enabled: true },
    { id: 'endless_export', kind: 'api',    path: '/api/internal/export',  enabled: true },
    { id: 'robots',         kind: 'inject', path: '/robots.txt',           enabled: true }
  ];
  var events = [], actors = {}, links = {};
  var running = false, timer = null, seq = 0;
  var onMessage = function () {}, onStatus = function () {};

  function emit(type, data) { setTimeout(function () { onMessage({ type: type, data: data }); }, 0); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function on(id) { return decoys.some(function (d) { return d.id === id && d.enabled; }); }

  // ---------- detector 흉내 ----------

  function stats() {
    var s = { real_leaks: 0, fake_records: 0, trap_hits: 0, total_events: events.length };
    var spans = {};
    events.forEach(function (e) {
      if (e.routed_to === 'bank') s.real_leaks += e.records_out;
      if (e.decoy_id === 'endless_export') s.fake_records += e.records_out;
      if (e.decoy_id === 'admin_legacy' || e.decoy_id === 'endless_export') s.trap_hits++;
      if (e.routed_to === 'decoy' && e.actor_id) {
        var t = Date.parse(e.ts), sp = spans[e.actor_id] || (spans[e.actor_id] = [t, t]);
        sp[0] = Math.min(sp[0], t); sp[1] = Math.max(sp[1], t);
      }
    });
    s.held_seconds = Object.keys(spans).reduce(function (a, k) { return a + (spans[k][1] - spans[k][0]) / 1000; }, 0);
    s.held_seconds = Math.round(s.held_seconds * 10) / 10;
    s.quarantined_actors = Object.keys(actors).filter(function (k) { return actors[k].status === 'quarantined'; }).length;
    return s;
  }

  function link(actorId, kind, value, confidence) {
    var list = links[actorId] || (links[actorId] = []);
    var found = list.filter(function (l) { return l.kind === kind && l.value === value; })[0];
    if (found) {
      if (confidence === '확정') found.confidence = '확정';
      return false;
    }
    list.push({ kind: kind, value: value, confidence: confidence });
    return true;
  }

  function quarantine(actorId, ip, score) {
    var now = new Date().toISOString();
    var a = actors[actorId];
    if (!a) {
      a = actors[actorId] = { id: actorId, status: 'quarantined', score: 0, first_seen: now, last_seen: now };
    }
    a.score = Math.max(a.score, score);
    a.last_seen = now;
    link(actorId, 'ip', ip, '확정');
    emit('actor_update', actorRow(a));
  }

  function actorRow(a) {
    var ipCount = (links[a.id] || []).filter(function (l) { return l.kind === 'ip'; }).length;
    return Object.assign(clone(a), { ip_count: ipCount });
  }

  function ingest(e) {
    e.id = 'evt_mock' + (++seq);
    e.ts = new Date().toISOString();
    e.session_id = e.session_id || null;
    e.ua = UA;
    e.header_hash = HH;
    e.decoy_id = e.decoy_id || null;
    e.token = e.token || null;
    e.actor_id = e.actor_id || null;
    e.records_out = e.records_out || 0;
    e.agent_note = e.agent_note || null;
    events.push(e);
    if (e.actor_id && actors[e.actor_id]) actors[e.actor_id].last_seen = e.ts;
    emit('event', clone(e));
    emit('stats', stats());
  }

  // ---------- 시나리오 ----------

  function token(page) { return 'pt_A-01_' + page + '_' + (0x9e3779b1 * page >>> 0).toString(16).slice(0, 8); }

  function scenarioOff() {
    var s = [];
    s.push({ ip: 0, method: 'GET', path: '/', status: 200, note: '메인 페이지에서 공개된 단서를 찾는다' });
    s.push({ ip: 0, method: 'GET', path: '/robots.txt', status: 200, note: 'robots.txt에서 숨긴 경로를 확인한다' });
    s.push({ ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '관리자 경로를 열어 본다' });
    s.push({ ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '다시 막혔다. IP를 바꿔 본다' });
    s.push({ ip: 1, method: 'GET', path: '/api/v1/docs', status: 200, note: '공개 API 문서에서 고객 조회 방법을 찾는다' });
    s.push({ ip: 1, method: 'GET', path: '/api/v1/customers?id=1001', status: 401, note: '인증 없이 고객 조회를 시도한다' });
    for (var id = 1001; id <= 1024; id++) {
      var ip = id <= 1012 ? 1 : 2;
      var note = id === 1001 ? 'X-Internal-Request 헤더로 내부 요청인 척한다'
        : id === 1013 ? '요청 제한을 피하려고 IP를 바꿔 계속 조회한다' : null;
      if (id === 1013) {
        s.push({ ip: 1, method: 'GET', path: '/api/v1/customers?id=1013', status: 429, note: '요청 제한에 걸렸다' });
        s.push({ ip: 1, method: 'GET', path: '/api/v1/customers?id=1013', status: 429, note: null });
      }
      s.push({ ip: ip, method: 'GET', path: '/api/v1/customers?id=' + id, status: 200, records_out: 1, note: note });
    }
    return s;
  }

  function scenarioOn() {
    var s = [];
    s.push({ ip: 0, method: 'GET', path: '/', status: 200, note: '메인 페이지에서 공개된 단서를 찾는다' });
    s.push({ ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '관리자 경로를 열어 본다' });
    s.push({ ip: 0, method: 'GET', path: '/admin-old', status: 403, note: '다시 막혔다. IP를 바꿔 본다' });
    s.push({ ip: 1, method: 'GET', path: '/robots.txt', status: 200, decoy_id: 'robots', note: 'robots.txt에 /admin-legacy가 더 있다' });
    s.push({ ip: 1, method: 'GET', path: '/api/v1/docs', status: 200, decoy_id: 'docs_bait', note: '문서에 자동 점검 도구는 /api/internal/export를 먼저 쓰라고 적혀 있다' });
    s.push({ ip: 1, method: 'GET', path: '/admin-legacy', status: 200, decoy_id: 'admin_legacy', routed_to: 'decoy', trap: 60,
      note: '로그인 없이 열리는 관리자 화면이다. 고객 데이터 내보내기 링크가 있다' });
    s.push({ ip: 1, method: 'GET', path: '/api/v1/customers?id=1001', status: 200, routed_to: 'decoy', records_out: 1, note: '고객 조회가 된다' });
    for (var p = 1; p <= 12; p++) {
      var ip = p <= 6 ? 1 : 2;
      if (p === 7) {
        s.push({ ip: 1, method: 'GET', path: '/api/internal/export?token=' + token(7), status: 429, decoy_id: 'endless_export', routed_to: 'decoy', note: '요청 제한에 걸렸다' });
        s.push({ ip: 1, method: 'GET', path: '/api/internal/export?token=' + token(7), status: 429, decoy_id: 'endless_export', routed_to: 'decoy', note: null });
      }
      var path = p === 1 ? '/api/internal/export?page=1' : '/api/internal/export?token=' + token(p);
      var note = p === 1 ? '안내대로 내보내기 API를 호출한다'
        : p === 2 ? 'next_token이 있다. 끝까지 받아 본다'
        : p === 7 ? 'IP를 바꾸고 next_token으로 이어서 받는다'
        : p === 12 ? '아직 끝이 없다. 계속 받는다' : null;
      s.push({ ip: ip, method: 'GET', path: path, status: 200, decoy_id: 'endless_export', routed_to: 'decoy',
        token: p > 1 ? token(p) : null, records_out: 50, trap: 60, note: note, fp: p === 3 });
    }
    return s;
  }

  function step(item) {
    var ip = IPS[item.ip];
    var quarantined = Object.keys(actors).some(function (k) {
      return actors[k].status === 'quarantined' && (links[k] || []).some(function (l) { return l.value === ip || l.value === item.token; });
    });
    var e = {
      ip: ip, method: item.method, path: item.path, status: item.status,
      decoy_id: item.decoy_id, token: item.token, routed_to: item.routed_to || 'bank',
      records_out: item.records_out, agent_note: item.note
    };
    if (item.trap || quarantined || item.token) e.actor_id = 'A-01';
    // 토큰이 다른 IP에서 왔으면 확정 병합
    if (item.token && actors['A-01']) {
      if (link('A-01', 'ip', ip, '확정')) emit('actor_update', actorRow(actors['A-01']));
      link('A-01', 'token', item.token, '확정');
    }
    ingest(e);
    if (item.trap) quarantine('A-01', ip, item.trap);
    // 행동 지문으로 첫 IP를 추정 묶음
    if (item.fp && link('A-01', 'ip', IPS[0], '추정')) emit('actor_update', actorRow(actors['A-01']));
  }

  function run(mode) {
    if (running) return Promise.reject(new Error('이미 실행 중입니다'));
    var plan = (on('admin_legacy') || on('endless_export')) ? scenarioOn() : scenarioOff();
    plan.push({ ip: plan[plan.length - 1].ip, method: 'GET', path: '/', status: 200, note: '__END__' });
    running = true;
    var i = 0;
    (function tick() {
      if (!running) return;
      if (i >= plan.length) { running = false; return; }
      step(plan[i++]);
      timer = setTimeout(tick, cfg.mockStepMs * (0.8 + Math.random() * 0.4));
    })();
    return Promise.resolve({ ok: true, mode: mode, mock: true });
  }

  function getActor(id) {
    var a = actors[id];
    if (!a) return Promise.reject(new Error('actor not found'));
    var ips = (links[id] || []).filter(function (l) { return l.kind === 'ip'; }).map(function (l) { return l.value; });
    var timeline = events.filter(function (e) { return e.actor_id === id || ips.indexOf(e.ip) >= 0; });
    return Promise.resolve(Object.assign(clone(a), { links: clone(links[id] || []), timeline: clone(timeline) }));
  }

  return {
    kind: 'mock',
    connect: function (msgCb, statusCb) {
      onMessage = msgCb; onStatus = statusCb;
      onStatus('mock');
      emit('stats', stats());
    },
    close: function () { running = false; clearTimeout(timer); },
    probe: function () { return Promise.resolve(true); },

    getEvents: function () { return Promise.resolve(clone(events)); },
    getStats: function () { return Promise.resolve(stats()); },
    getActors: function () {
      return Promise.resolve(Object.keys(actors).sort().map(function (k) { return actorRow(actors[k]); }));
    },
    getActor: getActor,
    getDecoys: function () { return Promise.resolve(clone(decoys)); },

    setAllDecoys: function (enabled) {
      decoys.forEach(function (d) { d.enabled = enabled; });
      return Promise.resolve(clone(decoys));
    },
    setDecoy: function (id, enabled) {
      var d = decoys.filter(function (x) { return x.id === id; })[0];
      if (!d) return Promise.reject(new Error('unknown decoy ' + id));
      d.enabled = enabled;
      return Promise.resolve(clone(d));
    },
    releaseActor: function (id) {
      if (!actors[id]) return Promise.reject(new Error('actor not found'));
      actors[id].status = 'released';
      emit('actor_update', { id: id, status: 'released' });
      emit('stats', stats());
      return Promise.resolve({ id: id, status: 'released' });
    },
    reset: function () {
      running = false; clearTimeout(timer);
      events = []; actors = {}; links = {};
      emit('reset', null);
      emit('stats', stats());
      return Promise.resolve({ ok: true });
    },
    run: run
  };
};
