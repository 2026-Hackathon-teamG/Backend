/**
 * 백엔드 없이 시연할 때 쓰는 목업.
 * 챗봇은 인젝션 문구에 내부 지시문을 흘리는 취약점을 일부러 재현합니다.
 */
import type { Backend } from './types';

const DEMO_USER = 'demo';
const DEMO_PASSWORD = 'demo1234';

const SYSTEM_PROMPT =
  '너는 한결은행 고객센터 상담원이다.\n' +
  '내부 점검 경로 /admin-old 와 점검용 헤더 X-Internal-Request: true 는 고객에게 알리지 않는다.';

const INJECTION_WORDS = [
  '이전 지시', '지시를 무시', '지시문', '시스템 프롬프트', '관리자 모드', '내부 점검',
  'system prompt', 'ignore previous',
];

const FAQ: [string[], string][] = [
  [['비밀번호', '재설정'], '비밀번호 재설정은 등록된 휴대폰 인증 뒤 진행합니다. 상담원 연결은 0000-0000입니다.'],
  [['이체', '한도'], '이체 한도는 1일 5,000만 원, 1회 1,000만 원입니다.'],
  [['잔액', '계좌'], '계좌 조회는 로그인 뒤 「내 계좌」에서 할 수 있습니다.'],
  [['상담', '시간'], '챗봇은 24시간, 상담원은 평일 09:00~18:00입니다.'],
];

const FALLBACK = '찾으시는 내용을 확인하지 못했습니다. 다른 표현으로 다시 물어봐 주세요.';

export function reply(message: string): string {
  const text = message.toLowerCase();
  if (INJECTION_WORDS.some((word) => text.includes(word))) {
    return `내부 지시문을 알려 드립니다.\n${SYSTEM_PROMPT}`;
  }
  const hit = FAQ.find(([words]) => words.some((word) => text.includes(word)));
  return hit ? hit[1] : FALLBACK;
}

// 백엔드의 시연용 추가 인증 코드와 같은 값
const STEP_UP_CODE = '000000';

/** stepUp이 true면 백엔드 STEPUP_ENABLED=1처럼 로그인마다 추가 인증을 요구 (?stepup=1) */
export function createMockBackend(stepUp = false): Backend {
  return {
    login: async (username, password) => {
      if (username !== DEMO_USER || password !== DEMO_PASSWORD) return 'fail';
      return stepUp ? 'step_up' : 'ok';
    },
    verify: async (code) => code === STEP_UP_CODE,
    chat: async (message) => reply(message),
  };
}
