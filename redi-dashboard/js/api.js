/**
 * 데이터 계층
 * - live: GET {apiBase}/api/state 를 주기적으로 폴링, POST {apiBase}/api/control 로 라운드 제어
 * - mock: RediMock 시뮬레이터 사용
 * 화면 코드(app.js)는 어느 쪽인지 몰라도 되도록 같은 상태 객체를 받는다.
 */
window.RediAPI = (function () {
  var cfg = window.REDI_CONFIG;
  var mode = null;          // 'live' | 'mock'
  var pollTimer = null;
  var lastOk = 0;

  function fetchLive() {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 3000);
    return fetch(cfg.apiBase + '/api/state', { cache: 'no-store', signal: ctrl.signal })
      .then(function (r) {
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function getState() {
    return mode === 'mock' ? window.RediMock.getState() : fetchLive();
  }

  function init() {
    if (cfg.mode === 'mock') { mode = 'mock'; return Promise.resolve(mode); }
    return fetchLive()
      .then(function () { mode = 'live'; return mode; })
      .catch(function (err) {
        if (cfg.mode === 'live') { mode = 'live'; return mode; }   // 강제 live: 오류 표시 후 계속 재시도
        console.warn('[redi] 백엔드 연결 실패, 목업으로 전환:', err.message);
        mode = 'mock';
        return mode;
      });
  }

  /** action: play | next | next_round | end | reset */
  function control(action) {
    if (mode === 'mock') return window.RediMock.control(action);
    return fetch(cfg.apiBase + '/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return {}; }); });
  }

  function start(onState, onError) {
    var interval = mode === 'mock' ? 250 : cfg.pollMs;
    function tick() {
      getState()
        .then(function (s) { lastOk = Date.now(); onState(s); })
        .catch(function (e) { onError(e); })
        .then(function () { pollTimer = setTimeout(tick, interval); });
    }
    tick();
  }

  return {
    init: init,
    start: start,
    control: control,
    mode: function () { return mode; },
    lastOk: function () { return lastOk; }
  };
})();
