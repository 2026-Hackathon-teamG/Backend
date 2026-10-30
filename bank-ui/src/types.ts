/** live와 mock이 같은 메서드를 제공하므로 화면 코드는 어느 쪽인지 모릅니다. */
export interface Backend {
  /** 아이디나 비밀번호가 틀리면 false */
  login(username: string, password: string): Promise<boolean>;
  chat(message: string): Promise<string>;
}
