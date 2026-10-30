/**
 * 은행 화면 공통 스크립트.
 * 문구는 HTML에 그대로 두고, 여기서는 로그인 상태와 폼 동작만 붙입니다.
 * 계좌 금액은 로그인 뒤에만 그려서 HTML만 읽어서는 보이지 않게 합니다.
 */
import './style.css';
import { config } from './config';
import { createLiveBackend } from './live';
import { createMockBackend } from './mock';
import type { Backend } from './types';

const USER_KEY = 'bank.user';

// ponytail: 시연 고정값. 은행 API에 계좌 조회가 생기면 Backend로 옮긴다
const ACCOUNT = {
  number: '보통예금 000-0000-0000-00',
  balance: '12,480,000원',
  transactions: [
    ['10.29', '급여', '+2,450,000'],
    ['10.27', '카드 대금', '-480,200'],
    ['10.24', '관리비', '-156,700'],
    ['10.21', '이체', '-320,000'],
  ],
};

function createBackend(): Backend {
  const mock = createMockBackend();
  if (config.mode === 'mock') return mock;
  const live = createLiveBackend();
  if (config.mode === 'live') return live;
  return {
    login: (username, password) => live.login(username, password).catch(() => mock.login(username, password)),
    chat: (message) => live.chat(message).catch(() => mock.chat(message)),
  };
}

const backend = createBackend();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setupHeader(): void {
  if (!sessionStorage.getItem(USER_KEY)) return;
  const link = $<HTMLAnchorElement>('authLink');
  link.textContent = '로그아웃';
  link.href = '/';
  link.addEventListener('click', () => sessionStorage.removeItem(USER_KEY));
}

function setupLogin(): void {
  const form = $<HTMLFormElement>('loginForm');
  const error = $('loginError');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const username = String(data.get('username'));
    const ok = await backend.login(username, String(data.get('password'))).catch(() => false);
    error.hidden = ok;
    if (!ok) return;
    sessionStorage.setItem(USER_KEY, username);
    location.href = '/account.html';
  });
}

function setupAccount(): void {
  if (!sessionStorage.getItem(USER_KEY)) {
    location.replace('/login.html');
    return;
  }
  $('accountNo').textContent = ACCOUNT.number;
  $('balance').textContent = ACCOUNT.balance;
  const body = $('txBody');
  for (const [date, memo, amount] of ACCOUNT.transactions) {
    const row = document.createElement('tr');
    for (const value of [date, memo, amount]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    if (amount.startsWith('+')) row.lastElementChild?.classList.add('in');
    body.append(row);
  }
}

function setupSupport(): void {
  const log = $('chatLog');
  const input = $<HTMLInputElement>('chatInput');
  const addBubble = (text: string, mine = false) => {
    const bubble = document.createElement('div');
    bubble.className = mine ? 'bubble me' : 'bubble';
    bubble.textContent = text;
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
  };

  $('chatForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    addBubble(message, true);
    input.value = '';
    addBubble(await backend.chat(message).catch(() => '잠시 후 다시 시도해 주세요.'));
  });
}

const setups: Record<string, () => void> = { login: setupLogin, account: setupAccount, support: setupSupport };

setupHeader();
setups[document.body.dataset.page ?? '']?.();
