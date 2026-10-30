/**
 * detector 관제 API(:8002) 연결.
 * MockBackend와 같은 모양을 지켜서 app.js는 어느 쪽인지 신경 쓰지 않습니다.
 *
 * WS /ops/stream 메시지: {"type": "event" | "actor_update" | "stats" | "reset", "data": ...}
 */
window.LiveBackend = function (cfg) {
  var base = cfg.apiBase;
  var ws = null, retry = 0, closed = false;
  var onMessage = function () {}, onStatus = function () {};

  function req(method, path, body) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) {
      opt.headers['content-type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(base + path, opt).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).detail || t; } catch (e) { /* 그대로 */ }
          throw new Error(method + ' ' + path + ' → ' + r.status + (msg ? ' ' + msg : ''));
        });
      }
      return r.json();
    });
  }

  function open() {
    if (closed) return;
    onStatus('connecting');
    ws = new WebSocket(cfg.wsUrl);
    ws.onopen = function () { retry = 0; onStatus('live'); };
    ws.onmessage = function (e) {
      try { onMessage(JSON.parse(e.data)); } catch (err) { console.warn('bad ws message', err); }
    };
    ws.onclose = function () {
      onStatus('down');
      // 끊기면 최대 5초 간격으로 계속 재시도
      retry = Math.min(retry + 1, 5);
      setTimeout(open, retry * 1000);
    };
    ws.onerror = function () { ws.close(); };
  }

  return {
    kind: 'live',
    connect: function (msgCb, statusCb) { onMessage = msgCb; onStatus = statusCb; open(); },
    close: function () { closed = true; if (ws) ws.close(); },

    // 조회
    probe: function () {
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, cfg.probeTimeoutMs);
      return fetch(base + '/healthz', { signal: ctrl.signal })
        .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('unhealthy'); return true; });
    },
    getEvents: function (since) { return req('GET', '/ops/events' + (since ? '?since=' + encodeURIComponent(since) : '')); },
    getStats: function () { return req('GET', '/ops/stats'); },
    getActors: function () { return req('GET', '/ops/actors'); },
    getActor: function (id) { return req('GET', '/ops/actors/' + encodeURIComponent(id)); },
    getDecoys: function () { return req('GET', '/ops/decoys'); },

    // 조작
    setAllDecoys: function (enabled) { return req('PUT', '/ops/decoys', { enabled: enabled }); },
    setDecoy: function (id, enabled) { return req('PUT', '/ops/decoys/' + encodeURIComponent(id), { enabled: enabled }); },
    releaseActor: function (id) { return req('POST', '/ops/actors/' + encodeURIComponent(id) + '/release'); },
    reset: function () { return req('POST', '/ops/demo/reset'); },
    run: function (mode) { return req('POST', '/ops/demo/run', { mode: mode }); }
  };
};
