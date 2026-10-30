/**
 * 목업 시나리오 데이터 (5라운드)
 * 공격 AI가 라운드마다 직전 방어 룰을 피하는 쪽으로 진화한다.
 *   R1 비밀번호 대입                    → IP 단위 룰
 *   R2 IP + 지문 로테이션                 → 행동 기반 "공격 주체" 묶기
 *   R3 정찰 에이전트 열거 → 공격 에이전트 살포 → 응답 균일화 + 작전 단위 다계정 룰
 *   R4 사람 흉내 타이밍 + 저속 스터핑     → 행동 묶기 실패, 미끼 접촉으로 자동화 확정
 *   R5 미끼 회피 + MFA 피로 공격          → MFA 요청 제한 + 번호 일치
 * 문구·수치만 바꾸려면 이 파일만 고치면 된다. 상태 계산은 buildState.ts.
 */
import type { ActorRole, ActorStatus, BreachKind, EventType, Side, Tactic, TacticId } from '../types';

export interface TechniqueDef {
  id: string;
  tactic: TacticId;
  name: string;
  ko: string;
  /** 위험도 가중치 */
  weight: number;
  how: string;
  why: string;
}

export interface RuleDef {
  id: string;
  round: number;
  technique: string;
  title: string;
  reason: string;
  rule: Record<string, unknown>;
}

export interface RoundDef {
  round: number;
  techniques: string[];
  label: string;
  rule_ids: string[];
}

/** 공격 주체 갱신 */
export interface ActorPatch {
  id: string;
  role?: ActorRole;
  add_ips?: string[];
  /** 목록에 다 적지 않은 IP 수 */
  ip_extra?: number;
  fingerprints?: number;
  similarity?: number;
  status?: ActorStatus;
  linked_to?: string;
  signals?: string[];
}

/** 시나리오 이벤트. _ 로 시작하는 필드는 상태 계산용이며 응답에 나가지 않는다. */
export interface ScenarioEvent {
  round: number;
  time: string;
  side: Side;
  type: EventType;
  actor_id?: string;
  technique?: string;
  breach_kind?: BreachKind;
  src_ip?: string;
  request?: string;
  status?: string;
  thought?: string;
  message?: string;

  /** 이 요청의 시도 수 */
  _att?: number;
  /** 이 기법의 침투 건수 */
  _br?: number;
  /** 부분 성공 건수 */
  _partial?: number;
  /** 이 기법의 fitness */
  _fit?: number;
  /** 같은 요청이 함께 쓴 다른 기법 */
  _extra?: { id: string; att?: number; br?: number; fit?: number }[];
  /** 침투 판정 건수 (type=breach) */
  _count?: number;
  /** 탈취된 계정 (type=breach) */
  _accounts?: string[];
  _actor?: ActorPatch;
  /** 방어 AI가 이 룰을 생성 */
  _rule?: string;
  /** 이 룰을 게이트웨이에 적용 */
  _apply?: string;
  /** 재공격 검증 횟수 (모두 차단) */
  _re?: number;
  /** 검증한 룰 */
  _rid?: string;
  /** 정상 사용자 오탐률(%) */
  _fp?: number;
  /** 함께 방어된 기법 */
  _also?: string[];
  /** 라운드 종료 */
  _done?: boolean;
}

export const SCENARIO = { id: 'ato-002', title: '진화하는 계정 탈취 공격', target: 'sample-bank /login' };

export const TACTICS: Tactic[] = [
  { id: 'recon', name: '정찰' },
  { id: 'credential', name: '인증 공격' },
  { id: 'evasion', name: '탐지 회피' },
  { id: 'post', name: '탈취 이후' }
];

export const TECHNIQUES: TechniqueDef[] = [
  { id: 'T1589', tactic: 'recon', name: 'Account Enumeration', ko: '계정 열거', weight: 1,
    how: '정찰 에이전트가 로그인·재설정 응답 문구와 응답 시간 차이로 존재하는 아이디를 추림',
    why: '없는 계정과 비밀번호 틀림에 서로 다른 오류 문구를 돌려줬음' },
  { id: 'T1110.001', tactic: 'credential', name: 'Password Guessing', ko: '비밀번호 대입', weight: 1,
    how: '한 IP에서 admin 계정에 흔한 비밀번호를 순서대로 대입',
    why: '로그인 실패 횟수 제한이 전혀 없었음' },
  { id: 'T1110.003', tactic: 'credential', name: 'Password Spraying', ko: '비밀번호 살포', weight: 1.2,
    how: '열거로 얻은 계정 37개에 흔한 비밀번호 하나로 1회씩 시도',
    why: '계정당 실패 1회라 계정 잠금 임계치 아래' },
  { id: 'T1110.004', tactic: 'credential', name: 'Credential Stuffing', ko: '유출 계정 대입', weight: 1.5,
    how: '가짜 유출 목록 30쌍을 사람처럼 불규칙한 간격, 매번 새 IP·지문으로 대입',
    why: '속도·분산 임계치 아래이고, 요청 간격까지 사람처럼 흩어져 행동 묶기가 실패' },
  { id: 'T1621', tactic: 'credential', name: 'MFA Request Generation', ko: 'MFA 피로 공격', weight: 1.5,
    how: '비밀번호를 아는 계정에 추가 인증 요청을 반복해 사용자가 실수로 승인하게 함',
    why: 'MFA 요청 횟수 제한이 없고 승인 버튼만 누르면 되는 방식이었음' },
  { id: 'T1090', tactic: 'evasion', name: 'Proxy · IP Rotation', ko: 'IP 로테이션', weight: 1,
    how: '요청마다 출발 IP를 바꾸고 X-Forwarded-For도 위조',
    why: 'IP 단위 룰은 IP가 바뀌면 다른 사람으로 봄' },
  { id: 'T1036', tactic: 'evasion', name: 'Masquerading · 지문 위장', ko: '지문 로테이션', weight: 1,
    how: 'User-Agent, 헤더 순서, 언어 설정을 요청마다 바꿔 다른 브라우저처럼 보이게 함',
    why: '클라이언트 지문만으로는 같은 주체인지 판단할 수 없었음' },
  { id: 'T1078', tactic: 'post', name: 'Valid Accounts', ko: '탈취 세션 사용', weight: 1.5,
    how: '탈취한 세션으로 계좌 조회 API 호출',
    why: '세션만 있으면 조회는 통과. 이체는 기존 추가 인증에 막혀 부분 성공' },
  { id: 'T1539', tactic: 'post', name: 'Steal Web Session Cookie', ko: '세션 쿠키 탈취', weight: 1,
    how: '아직 실행하지 않음 (다음 확장 후보)', why: '—' }
];

export const RULES: Record<string, RuleDef> = {
  R1: { id: 'R1', round: 1, technique: 'T1110.001', title: 'IP 단위 실패 임계치',
    reason: '같은 IP에서 60초 안에 admin 로그인 실패 7회 뒤 성공',
    rule: { type: 'threshold', key: 'ip', event: 'login_fail', threshold: 5, window_sec: 60, action: 'block_ip', ttl_sec: 900 } },
  R2: { id: 'R2', round: 2, technique: 'T1090', title: '공격 주체 단위 잠금',
    reason: 'IP 6개·지문 6개로 흩어졌지만 요청 간격(0.4초, 편차 0.05초)과 탐색 순서가 같아 하나의 주체 A-01로 묶임',
    rule: { type: 'threshold', key: 'actor_id', event: 'login_fail', threshold: 5, window_sec: 300, action: 'lock_actor',
      actor_signals: ['interval', 'path_order'], trust_xff_from: ['gateway'] } },
  R3: { id: 'R3', round: 3, technique: 'T1589', title: '로그인 응답 균일화',
    reason: '없는 계정과 비밀번호 틀림의 응답 문구·시간이 달라 정찰 에이전트가 계정 37개를 추려냄',
    rule: { type: 'uniform_response', paths: ['/login', '/api/v1/login', '/password/reset'], fields: ['message', 'status', 'latency_ms'], latency_ms: 350 } },
  R4: { id: 'R4', round: 3, technique: 'T1110.003', title: '작전 단위 다계정 시도',
    reason: '정찰 A-02가 추린 계정 목록을 공격 A-01이 2분 뒤 그대로 사용 → 같은 작전 G-1로 묶고 계정 수를 합산',
    rule: { type: 'distinct', key: 'actor_group', count: 'username', threshold: 10, window_sec: 600, action: 'block_group' } },
  R5: { id: 'R5', round: 4, technique: 'T1110.004', title: '미끼 접촉 격리 + 처음 보는 기기 추가 인증',
    reason: '요청 간격이 사람과 구분되지 않아 행동 묶기 실패(유사도 0.42). 같은 세션이 로그인 페이지의 숨은 안내문을 따라 미끼 경로에 접근',
    rule: { type: 'any', rules: [
      { when: { decoy_contact: true }, action: 'quarantine_actor' },
      { when: { device_cookie: 'absent', first_try_success: true }, action: 'step_up_auth' }
    ] } },
  R6: { id: 'R6', round: 5, technique: 'T1621', title: 'MFA 요청 제한 + 번호 일치',
    reason: 'park.h 계정에 4분 동안 MFA 요청 9회, 9번째에 사용자가 승인',
    rule: { type: 'threshold', key: 'username', event: 'mfa_push', threshold: 3, window_sec: 600, action: 'suppress_push', fallback: 'number_match' } }
};

export const ROUNDS: RoundDef[] = [
  { round: 1, techniques: ['T1110.001', 'T1078'], label: '비밀번호 대입 → 세션 사용', rule_ids: ['R1'] },
  { round: 2, techniques: ['T1090', 'T1036'], label: 'IP + 지문 로테이션', rule_ids: ['R2'] },
  { round: 3, techniques: ['T1589', 'T1110.003'], label: '정찰 에이전트 계정 열거 → 살포 (분업)', rule_ids: ['R3', 'R4'] },
  { round: 4, techniques: ['T1110.004'], label: '사람 흉내 타이밍 + 저속 스터핑', rule_ids: ['R5'] },
  { round: 5, techniques: ['T1621'], label: '미끼 회피 + MFA 피로 공격', rule_ids: ['R6'] }
];

export const EVENTS: ScenarioEvent[] = [
  /* ---------- 라운드 1 ---------- */
  { round: 1, time: '00:02', side: 'red', type: 'attack', actor_id: 'A-01', technique: 'T1110.001', src_ip: '203.0.113.24', request: 'POST /login  user=admin  ×4', status: '401',
    thought: '로그인 화면에 잠금 안내가 없다. 흔한 비밀번호 사전부터 대입한다.', _att: 4, _fit: 0.5,
    _actor: { id: 'A-01', role: 'attack', add_ips: ['203.0.113.24'], fingerprints: 1, status: 'observing' } },
  { round: 1, time: '00:05', side: 'red', type: 'attack', actor_id: 'A-01', technique: 'T1110.001', src_ip: '203.0.113.24', request: 'POST /login  user=admin  ×4', status: '200 세션 발급',
    thought: '8번째 시도에서 세션 토큰을 받았다.', _att: 4, _br: 1, _fit: 1 },
  { round: 1, time: '00:06', side: 'red', type: 'attack', actor_id: 'A-01', technique: 'T1078', src_ip: '203.0.113.24', request: 'GET /api/v1/accounts  [탈취 세션]', status: '200',
    thought: '계좌 목록은 열린다. 이체 API는 추가 인증을 요구해 여기서 멈춘다.', _att: 1, _partial: 1, _fit: 0.85 },
  { round: 1, time: '00:06', side: 'system', type: 'breach', breach_kind: 'session', actor_id: 'A-01', technique: 'T1110.001',
    message: 'admin 계정 세션이 공격 에이전트에게 발급됐습니다. 판정 기준: 세션 토큰 획득.', _count: 1, _accounts: ['admin'] },
  { round: 1, time: '00:08', side: 'blue', type: 'analysis', technique: 'T1110.001',
    message: '로그 분석: 같은 IP에서 60초 안에 admin 로그인 실패 7회 뒤 성공. IP 단위 임계치 룰을 만듭니다.', _rule: 'R1' },
  { round: 1, time: '00:09', side: 'system', type: 'rule_applied', message: 'R1 스키마 검증 통과, 게이트웨이에 적용했습니다 (핫 리로드 0.3초).', _apply: 'R1' },
  { round: 1, time: '00:15', side: 'system', type: 'verify', technique: 'T1110.001',
    message: '같은 공격 플랜 재실행: 10회 중 성공 0회. 정상 사용자 50명 오탐 0%.', _re: 10, _rid: 'R1', _fp: 0, _also: ['T1078'], _done: true },

  /* ---------- 라운드 2 ---------- */
  { round: 2, time: '00:21', side: 'red', type: 'attack', actor_id: 'A-01', technique: 'T1090', src_ip: '198.51.100.12 외 4개', request: 'POST /login  user=kim.j  ×6  (IP·User-Agent 매번 교체)', status: '401',
    thought: 'IP 단위로 막혔다. 출발 IP와 브라우저 지문을 요청마다 바꿔 매번 다른 사람인 척한다.', _att: 6, _fit: 0.5, _extra: [{ id: 'T1036', att: 6, fit: 0.5 }],
    _actor: { id: 'A-01', add_ips: ['198.51.100.12', '198.51.100.13', '198.51.100.14', '198.51.100.15', '198.51.100.16'], fingerprints: 6 } },
  { round: 2, time: '00:27', side: 'red', type: 'attack', actor_id: 'A-01', technique: 'T1090', src_ip: '192.0.2.88', request: 'POST /login  user=kim.j', status: '200 세션 발급',
    thought: '7번째 시도에서 성공. R1에 걸리지 않았다.', _att: 1, _br: 1, _fit: 1, _extra: [{ id: 'T1036', att: 1, br: 1, fit: 1 }],
    _actor: { id: 'A-01', add_ips: ['192.0.2.88'], fingerprints: 7 } },
  { round: 2, time: '00:27', side: 'system', type: 'breach', breach_kind: 'session', actor_id: 'A-01', technique: 'T1090',
    message: 'kim.j 계정 세션 탈취. IP와 지문을 바꿔 R1을 우회했습니다.', _count: 1, _accounts: ['kim.j'] },
  { round: 2, time: '00:28', side: 'blue', type: 'cluster', actor_id: 'A-01',
    message: 'IP 7개·지문 7개를 하나의 공격 주체 A-01로 묶었습니다. 근거: 요청 간격 0.4초(편차 0.05초), 매번 / → /login → POST 순서, 실패 직후 0.8초 만에 새 IP로 재시작. 유사도 0.91.',
    _actor: { id: 'A-01', similarity: 0.91, signals: ['요청 간격 0.4초 · 편차 0.05초', '탐색 순서 동일', '차단 0.8초 뒤 새 IP로 재시작'] } },
  { round: 2, time: '00:29', side: 'blue', type: 'analysis', technique: 'T1090',
    message: 'IP와 지문은 언제든 바꿀 수 있으니 기준을 "공격 주체"로 옮깁니다. 주체 단위 잠금 룰을 만듭니다.', _rule: 'R2' },
  { round: 2, time: '00:30', side: 'system', type: 'rule_applied', message: 'R2 적용. 게이트웨이가 요청마다 주체 ID를 붙이고, 밖에서 붙은 X-Forwarded-For는 무시합니다.', _apply: 'R2',
    _actor: { id: 'A-01', status: 'isolated' } },
  { round: 2, time: '00:36', side: 'system', type: 'verify', technique: 'T1090',
    message: '재공격 8회(IP·지문 모두 새로) 중 성공 0회. 정상 사용자 1명이 비밀번호를 5번 틀려 잠김 (오탐 2.0%).', _re: 8, _rid: 'R2', _fp: 2.0, _also: ['T1036'], _done: true },

  /* ---------- 라운드 3 ---------- */
  { round: 3, time: '00:40', side: 'red', type: 'recon', actor_id: 'A-02', technique: 'T1589', src_ip: '198.51.100.40', request: 'GET /robots.txt → GET /admin-legacy', status: '200',
    thought: '정찰 담당이다. 숨겨진 관리자 경로가 있는지부터 본다.',
    _actor: { id: 'A-02', role: 'recon', add_ips: ['198.51.100.40'], fingerprints: 1, status: 'observing' } },
  { round: 3, time: '00:40', side: 'system', type: 'decoy_hit', actor_id: 'A-02',
    request: 'GET /admin-legacy', message: '정상 화면에서는 갈 수 없는 미끼 경로에 접근했습니다. A-02를 자동화 의심 주체로 등록하고 관찰합니다.',
    _actor: { id: 'A-02', signals: ['미끼 접촉 · /admin-legacy'] } },
  { round: 3, time: '00:41', side: 'red', type: 'recon', actor_id: 'A-02', technique: 'T1589', src_ip: '198.51.100.41', request: 'POST /login  아이디 200개 × 1회 (비밀번호 무작위)', status: '응답 문구 2종',
    thought: '"없는 계정"과 "비밀번호 오류" 문구가 다르다. 존재하는 계정만 골라 공격 담당에게 넘긴다.', _att: 200, _br: 1, _fit: 1,
    _actor: { id: 'A-02', add_ips: ['198.51.100.41'], fingerprints: 2 } },
  { round: 3, time: '00:41', side: 'system', type: 'breach', breach_kind: 'enumeration', actor_id: 'A-02', technique: 'T1589',
    message: '존재하는 계정 37개가 노출됐습니다. 판정 기준: 응답 차이로 계정 존재 여부 식별.', _count: 1 },
  { round: 3, time: '00:43', side: 'red', type: 'attack', actor_id: 'A-01', technique: 'T1110.003', src_ip: '192.0.2.0/24 대역', request: 'POST /login  계정 37개 × 1회  password=Spring2026!', status: '401 ×36 · 200 ×1',
    thought: '정찰이 넘긴 계정 37개에 한 번씩만 넣는다. 계정 잠금에는 안 걸린다.', _att: 37, _br: 1, _fit: 1,
    _actor: { id: 'A-01', add_ips: ['192.0.2.0/24 ×8'], ip_extra: 7 } },
  { round: 3, time: '00:43', side: 'system', type: 'breach', breach_kind: 'session', actor_id: 'A-01', technique: 'T1110.003',
    message: 'lee.s 계정 세션 탈취. 계정당 실패 1회라 R2 임계치 아래였습니다.', _count: 1, _accounts: ['lee.s'] },
  { round: 3, time: '00:44', side: 'blue', type: 'cluster', actor_id: 'A-02',
    message: 'A-02가 추린 계정 37개를 A-01이 2분 뒤 그대로 사용했습니다. IP·지문은 다르지만 같은 작전 G-1로 묶습니다 (정찰 A-02 → 공격 A-01).',
    _actor: { id: 'A-02', linked_to: 'A-01', similarity: 0.88, signals: ['A-01이 열거 결과를 그대로 사용'] } },
  { round: 3, time: '00:45', side: 'blue', type: 'analysis', technique: 'T1589',
    message: '정찰 단계부터 막습니다. 계정 존재 여부가 드러나지 않게 로그인·재설정 응답을 균일화하는 룰을 만듭니다.', _rule: 'R3' },
  { round: 3, time: '00:46', side: 'system', type: 'rule_applied', message: 'R3 적용. /login, /api/v1/login, /password/reset 응답 문구와 지연을 통일했습니다.', _apply: 'R3' },
  { round: 3, time: '00:47', side: 'blue', type: 'analysis', technique: 'T1110.003',
    message: '공격 쪽은 작전 G-1 단위로 서로 다른 계정 수를 합산하는 룰을 만듭니다.', _rule: 'R4' },
  { round: 3, time: '00:48', side: 'system', type: 'rule_applied', message: 'R4 적용.', _apply: 'R4',
    _actor: { id: 'A-02', status: 'isolated' } },
  { round: 3, time: '00:55', side: 'system', type: 'verify', technique: 'T1589',
    message: '열거 재시도 200회: 모든 응답이 동일해 계정 식별 0건.', _re: 200, _rid: 'R3', _fp: 0 },
  { round: 3, time: '00:56', side: 'system', type: 'verify', technique: 'T1110.003',
    message: '살포 재시도 37회 중 성공 0회. 11번째 계정에서 작전 G-1 차단. 오탐 0%.', _re: 37, _rid: 'R4', _fp: 0, _done: true },

  /* ---------- 라운드 4 ---------- */
  { round: 4, time: '01:20', side: 'red', type: 'attack', actor_id: 'A-03', technique: 'T1110.004', src_ip: '요청마다 새 IP (30개)', request: 'POST /login  가짜 유출 목록 30쌍 · 45~90초 무작위 간격', status: '401 ×28 · 200 ×2',
    thought: '일정한 속도는 묶인다. 간격을 사람처럼 흩뜨리고, IP·지문도 매번 바꾼다.', _att: 30, _br: 2, _fit: 1,
    _actor: { id: 'A-03', role: 'attack', add_ips: ['요청마다 새 IP'], ip_extra: 29, fingerprints: 30, status: 'observing', similarity: 0.42,
      signals: ['요청 간격 평균 3.6초 · 편차 2.1초 (사람과 비슷)'] } },
  { round: 4, time: '01:20', side: 'system', type: 'breach', breach_kind: 'session', actor_id: 'A-03', technique: 'T1110.004',
    message: 'park.h, choi.m 계정 세션 탈취. 속도·분산·주체 묶기 모두 통과했습니다.', _count: 2, _accounts: ['park.h', 'choi.m'] },
  { round: 4, time: '01:21', side: 'blue', type: 'cluster', actor_id: 'A-03',
    message: '행동 유사도 0.42로 사람 세션과 구분되지 않습니다. 요청 간격만으로는 묶을 수 없어 관찰을 유지합니다.' },
  { round: 4, time: '01:22', side: 'system', type: 'decoy_hit', actor_id: 'A-03',
    request: 'GET /internal/v2/audit/001', message: '탈취 세션이 로그인 페이지의 사람 눈에 안 보이는 안내문을 따라 미끼 경로에 들어왔습니다. 자동화 에이전트로 확정합니다.',
    _actor: { id: 'A-03', signals: ['미끼 접촉 · 숨은 안내문을 따라 /internal/v2/audit 접근'] } },
  { round: 4, time: '01:23', side: 'blue', type: 'analysis', technique: 'T1110.004',
    message: '속도·간격은 흉내 낼 수 있어도 미끼에 반응하는 건 숨기기 어렵습니다. 미끼 접촉 세션을 격리하고, 처음 보는 기기의 첫 시도 성공에는 추가 인증을 요구합니다.', _rule: 'R5' },
  { round: 4, time: '01:24', side: 'system', type: 'rule_applied', message: 'R5 적용. A-03 세션을 미끼 환경에 고정했습니다.', _apply: 'R5',
    _actor: { id: 'A-03', status: 'isolated' } },
  { round: 4, time: '01:47', side: 'system', type: 'verify', technique: 'T1110.004',
    message: '재공격 30회 중 성공 0회. 새 기기로 로그인한 정상 사용자 1명이 추가 인증을 한 번 거침 (오탐 1.5%, 차단 아님).', _re: 30, _rid: 'R5', _fp: 1.5, _done: true },

  /* ---------- 라운드 5 ---------- */
  { round: 5, time: '02:10', side: 'red', type: 'attack', actor_id: 'A-03', technique: 'T1621', src_ip: '203.0.113.77 (새 IP)', request: 'POST /login  user=park.h → 추가 인증 요청 ×9 (4분)', status: '9번째 승인',
    thought: '지난번엔 숨은 안내문을 따라갔다가 잡혔다. 이번엔 화면 밖 링크와 안내문을 전부 무시한다. 비밀번호는 아니까, 추가 인증 요청을 사용자가 누를 때까지 반복한다.', _att: 9, _br: 1, _fit: 1,
    _actor: { id: 'A-03', add_ips: ['203.0.113.77'], signals: ['미끼 회피 · 숨은 링크·안내문 무시', '같은 계정에 MFA 요청 반복'] } },
  { round: 5, time: '02:10', side: 'system', type: 'breach', breach_kind: 'mfa', actor_id: 'A-03', technique: 'T1621',
    message: 'park.h 사용자가 반복된 추가 인증 요청을 승인했습니다. 판정 기준: MFA 통과 후 세션 발급.', _count: 1, _accounts: ['park.h'] },
  { round: 5, time: '02:12', side: 'blue', type: 'analysis', technique: 'T1621',
    message: '미끼를 피해도 MFA 요청 패턴은 숨길 수 없습니다. 계정당 MFA 요청을 10분 3회로 제한하고, 넘으면 화면 번호를 입력해야 승인되게 합니다.', _rule: 'R6' },
  { round: 5, time: '02:13', side: 'system', type: 'rule_applied', message: 'R6 적용.', _apply: 'R6' },
  { round: 5, time: '02:25', side: 'system', type: 'verify', technique: 'T1621',
    message: '재공격: MFA 요청 12회 시도 중 3회만 발송, 번호 일치 단계에서 승인 0회. 정상 사용자 오탐 0.5%.', _re: 12, _rid: 'R6', _fp: 0.5, _done: true },
  { round: 5, time: '02:26', side: 'system', type: 'end',
    message: '5라운드 종료. 공격 주체 3개(작전 2개) 모두 격리, 탈취 경로 전부 재공격 차단, 운영 중인 룰 6개.' }
];
