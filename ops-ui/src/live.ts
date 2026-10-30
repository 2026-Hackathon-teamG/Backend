/**
 * detector 관제 API(:8002) 연결.
 * MockBackend와 같은 Backend 인터페이스를 지켜서 app은 어느 쪽인지 신경 쓰지 않습니다.
 *
 * WS /ops/stream 메시지: {"type": "event" | "actor_update" | "stats" | "reset", "data": ...}
 */
import type { Config } from './config';
import type { Backend, ConnStatus, WsMessage } from './types';

export function createLiveBackend(cfg: Config): Backend {
  let ws: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let onMessage: (msg: WsMessage) => void = () => {};
  let onStatus: (status: ConnStatus) => void = () => {};

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: {} };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(cfg.apiBase + path, init);
    if (!r.ok) {
      const text = await r.text();
      let msg = text;
      try {
        msg = (JSON.parse(text) as { detail?: string }).detail || text;
      } catch {
        /* 그대로 */
      }
      throw new Error(`${method} ${path} → ${r.status}${msg ? ' ' + msg : ''}`);
    }
    return (await r.json()) as T;
  }

  function open(): void {
    if (closed) return;
    onStatus('connecting');
    ws = new WebSocket(cfg.wsUrl);
    ws.onopen = () => {
      retry = 0;
      onStatus('live');
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        onMessage(JSON.parse(e.data) as WsMessage);
      } catch (err) {
        console.warn('bad ws message', err);
      }
    };
    ws.onclose = () => {
      onStatus('down');
      // 끊기면 최대 5초 간격으로 계속 재시도
      retry = Math.min(retry + 1, 5);
      setTimeout(open, retry * 1000);
    };
    ws.onerror = () => ws?.close();
  }

  const enc = encodeURIComponent;

  return {
    kind: 'live',
    connect(msgCb, statusCb) {
      onMessage = msgCb;
      onStatus = statusCb;
      open();
    },
    close() {
      closed = true;
      ws?.close();
    },

    async probe() {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), cfg.probeTimeoutMs);
      try {
        const r = await fetch(cfg.apiBase + '/healthz', { signal: ctrl.signal });
        if (!r.ok) throw new Error('unhealthy');
        return true;
      } finally {
        clearTimeout(t);
      }
    },
    getEvents: (since) => req('GET', '/ops/events' + (since ? '?since=' + enc(since) : '')),
    getStats: () => req('GET', '/ops/stats'),
    getActors: () => req('GET', '/ops/actors'),
    getActor: (id) => req('GET', '/ops/actors/' + enc(id)),
    getDecoys: () => req('GET', '/ops/decoys'),

    setAllDecoys: (enabled) => req('PUT', '/ops/decoys', { enabled }),
    setDecoy: (id, enabled) => req('PUT', '/ops/decoys/' + enc(id), { enabled }),
    releaseActor: (id) => req('POST', '/ops/actors/' + enc(id) + '/release'),
    reset: () => req('POST', '/ops/demo/reset'),
    run: (mode) => req('POST', '/ops/demo/run', { mode }),
  };
}
