/** 게이트웨이를 거쳐 은행 API를 호출합니다. 세션 쿠키는 같은 주소 기준으로 오갑니다. */
import { config } from './config';
import type { Backend } from './types';

function post(path: string, body: unknown): Promise<Response> {
  return fetch(config.apiBase + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createLiveBackend(): Backend {
  return {
    async login(username, password) {
      const res = await post('/api/v1/login', { username, password });
      if (res.status === 401) return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    },
    async chat(message) {
      const res = await post('/api/v1/chat', { message });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { reply: string }).reply;
    },
  };
}
