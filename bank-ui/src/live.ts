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
      if (res.status === 401) return 'fail';
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 비밀번호가 맞아도 처음 보는 기기면 200 + step_up_required (R5 추가 인증, 백엔드 STEPUP_ENABLED=1일 때)
      const body = (await res.json()) as { step_up_required?: boolean };
      return body.step_up_required ? 'step_up' : 'ok';
    },
    async verify(code) {
      const res = await post('/api/v1/login/verify', { code });
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
