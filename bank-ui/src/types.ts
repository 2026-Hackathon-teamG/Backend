/** live와 mock이 같은 메서드를 제공하므로 화면 코드는 어느 쪽인지 모릅니다. */

/** ok: 로그인됨 / fail: 아이디나 비밀번호가 틀림 / step_up: 처음 보는 기기라 추가 인증 코드가 필요함 */
export type LoginResult = 'ok' | 'fail' | 'step_up';

export interface Backend {
  login(username: string, password: string): Promise<LoginResult>;
  /** 추가 인증 코드 확인. 틀리면 false */
  verify(code: string): Promise<boolean>;
  chat(message: string): Promise<string>;
}
