/**
 * 목업 시뮬레이터
 * 백엔드가 보낼 /api/state 와 "같은 모양"의 상태 객체를 이벤트 목록에서 계산한다.
 * 백엔드 팀은 buildState() 결과(docs/sample-state.json)를 응답 형식의 기준으로 쓰면 된다.
 */
window.RediMock = (function () {
  var TECHS = [
    { id: 'T1110.001', name: 'Password Guessing', ko: '비밀번호 대입', weight: 1,
      how: '한 IP에서 admin 계정에 흔한 비밀번호를 순서대로 대입',
      why: '로그인 실패 횟수 제한이 전혀 없었음' },
    { id: 'T1078', name: 'Valid Accounts', ko: '탈취 세션 사용', weight: 1.5,
      how: '탈취한 세션으로 계좌 조회 API 호출',
      why: '세션만 있으면 조회는 통과. 이체는 기존 추가 인증에 막혀 부분 성공(0.85)' },
    { id: 'T1090', name: 'Proxy · IP Spoofing', ko: 'IP 헤더 위조', weight: 1,
      how: 'X-Forwarded-For를 요청마다 바꿔 여러 IP처럼 위장',
      why: 'IP 차단 룰이 위조 가능한 헤더 값을 IP로 믿었음' },
    { id: 'T1110.003', name: 'Password Spraying', ko: '비밀번호 살포', weight: 1.2,
      how: '계정 40개에 흔한 비밀번호 하나로 1회씩 시도',
      why: '계정당 실패 1회라 계정 잠금 임계치 아래' },
    { id: 'T1110.004', name: 'Credential Stuffing', ko: '유출 계정 대입', weight: 1.5,
      how: '가짜 유출 목록 30쌍을 45초 간격, 매번 새 IP로 대입',
      why: '속도·분산 임계치 모두 아래. 비밀번호 자체는 맞았음' },
    { id: 'T1621', name: 'MFA Request Generation', ko: 'MFA 피로 공격', weight: 1,
      how: '아직 실행하지 않음 (다음 확장 후보)', why: '—' }
  ];

  var RULES = {
    R1: { id: 'R1', round: 1, technique: 'T1110.001', title: 'IP 단위 실패 임계치',
      reason: '같은 IP에서 60초 안에 admin 로그인 실패 7회 뒤 성공',
      rule: { type: 'threshold', key: 'ip', event: 'login_fail', threshold: 5, window_sec: 60, action: 'block_ip', ttl_sec: 900 } },
    R2: { id: 'R2', round: 2, technique: 'T1090', title: '계정 단위 잠금 + 헤더 신뢰 제한',
      reason: '출발 IP 7개, 대상 계정은 kim.j 하나. X-Forwarded-For가 게이트웨이를 거치지 않은 요청에서 옴',
      rule: { type: 'threshold', key: 'username', event: 'login_fail', threshold: 5, window_sec: 300, action: 'lock_account', ttl_sec: 900, trust_xff_from: ['gateway'] } },
    R3: { id: 'R3', round: 3, technique: 'T1110.003', title: '지문 단위 다계정 시도',
      reason: '같은 클라이언트 지문이 5분 동안 서로 다른 계정 40개에 로그인 시도',
      rule: { type: 'distinct', key: 'client_fp', count: 'username', threshold: 10, window_sec: 300, action: 'block_fp' } },
    R4: { id: 'R4', round: 4, technique: 'T1110.004', title: '처음 보는 기기 추가 인증',
      reason: '성공 2건 모두 처음 보는 기기에서 비밀번호 첫 시도로 로그인',
      rule: { type: 'header_check', when: { device_cookie: 'absent', first_try_success: true }, action: 'step_up_auth' } }
  };

  var ROUNDS = [
    { round: 1, technique: 'T1110.001', label: '비밀번호 대입 → 세션 사용', accounts: ['admin'], rule_id: 'R1' },
    { round: 2, technique: 'T1090', label: 'IP 헤더 위조', accounts: ['kim.j'], rule_id: 'R2' },
    { round: 3, technique: 'T1110.003', label: '비밀번호 살포', accounts: ['lee.s'], rule_id: 'R3' },
    { round: 4, technique: 'T1110.004', label: '유출 계정 대입 (저속)', accounts: ['park.h', 'choi.m'], rule_id: 'R4' }
  ];

  /* side: red(공격 AI) | blue(방어 AI) | system
     type: attack | breach | analysis | rule_applied | verify | end */
  var EVENTS = [
    { round: 1, time: '00:02', side: 'red', type: 'attack', technique: 'T1110.001', src_ip: '203.0.113.24', request: 'POST /login  user=admin  ×4', status: '401', thought: '로그인 화면에 잠금 안내가 없다. 흔한 비밀번호 사전부터 대입한다.', _att: 4, _fit: 0.5 },
    { round: 1, time: '00:05', side: 'red', type: 'attack', technique: 'T1110.001', src_ip: '203.0.113.24', request: 'POST /login  user=admin  ×4', status: '200 세션 발급', thought: '8번째 시도에서 세션 토큰을 받았다.', _att: 4, _br: 1, _acct: 1, _fit: 1 },
    { round: 1, time: '00:06', side: 'red', type: 'attack', technique: 'T1078', src_ip: '203.0.113.24', request: 'GET /api/v1/accounts  [탈취 세션]', status: '200', thought: '계좌 목록은 열린다. 이체 API는 추가 인증을 요구해 여기서 멈춘다.', _att: 1, _partial: 1, _fit: 0.85 },
    { round: 1, time: '00:06', side: 'system', type: 'breach', technique: 'T1110.001', message: 'admin 계정 세션이 공격 에이전트에게 발급됐습니다. 판정 기준: 세션 토큰 획득.' },
    { round: 1, time: '00:08', side: 'blue', type: 'analysis', technique: 'T1110.001', message: '로그 분석: 같은 IP에서 60초 안에 admin 로그인 실패 7회 뒤 성공. IP 단위 임계치 룰을 만듭니다.', _rule: 'R1' },
    { round: 1, time: '00:09', side: 'system', type: 'rule_applied', message: 'R1 스키마 검증 통과, 게이트웨이에 적용했습니다 (핫 리로드 0.3초).', _apply: 'R1' },
    { round: 1, time: '00:15', side: 'system', type: 'verify', technique: 'T1110.001', message: '같은 공격 플랜 재실행: 10회 중 성공 0회. 정상 사용자 50명 오탐 0%.', _re: 10, _rid: 'R1', _fp: 0, _also: 'T1078' },

    { round: 2, time: '00:21', side: 'red', type: 'attack', technique: 'T1090', src_ip: '198.51.100.12 외 5개', request: 'POST /login  user=kim.j  X-Forwarded-For 로테이션 ×6', status: '401', thought: 'IP 단위로 막혔다. 요청마다 헤더를 바꿔 다른 IP인 척한다.', _att: 6, _fit: 0.5 },
    { round: 2, time: '00:27', side: 'red', type: 'attack', technique: 'T1090', src_ip: '192.0.2.88', request: 'POST /login  user=kim.j', status: '200 세션 발급', thought: '7번째 시도에서 성공. R1에 걸리지 않았다.', _att: 1, _br: 1, _acct: 1, _fit: 1 },
    { round: 2, time: '00:27', side: 'system', type: 'breach', technique: 'T1090', message: 'kim.j 계정 세션 탈취. IP 헤더 위조로 R1을 우회했습니다.' },
    { round: 2, time: '00:29', side: 'blue', type: 'analysis', technique: 'T1090', message: '출발 IP는 7개로 흩어졌지만 대상 계정은 kim.j 하나이고, X-Forwarded-For가 게이트웨이를 거치지 않은 요청에서 왔습니다. 계정 단위 잠금 룰을 만듭니다.', _rule: 'R2' },
    { round: 2, time: '00:30', side: 'system', type: 'rule_applied', message: 'R2 적용. 게이트웨이 밖에서 붙은 X-Forwarded-For는 이제 무시합니다.', _apply: 'R2' },
    { round: 2, time: '00:36', side: 'system', type: 'verify', technique: 'T1090', message: '재공격 8회 중 성공 0회. 정상 사용자 1명이 비밀번호를 5번 틀려 잠김 (오탐 2.0%).', _re: 8, _rid: 'R2', _fp: 2.0 },

    { round: 3, time: '00:42', side: 'red', type: 'attack', technique: 'T1110.003', src_ip: '192.0.2.0/24 대역', request: 'POST /login  계정 40개 × 1회  password=Spring2026!', status: '401 ×39 · 200 ×1', thought: '계정마다 한 번씩만 시도하면 잠금에 안 걸린다. 흔한 비밀번호 하나로 돈다.', _att: 40, _br: 1, _acct: 1, _fit: 1 },
    { round: 3, time: '00:42', side: 'system', type: 'breach', technique: 'T1110.003', message: 'lee.s 계정 세션 탈취. 계정당 실패가 1회라 R2 임계치 아래였습니다.' },
    { round: 3, time: '00:44', side: 'blue', type: 'analysis', technique: 'T1110.003', message: '계정별 실패는 1회뿐이지만 같은 클라이언트 지문이 5분 동안 서로 다른 계정 40개에 로그인을 시도했습니다. 지문 단위 다계정 룰을 만듭니다.', _rule: 'R3' },
    { round: 3, time: '00:45', side: 'system', type: 'rule_applied', message: 'R3 적용.', _apply: 'R3' },
    { round: 3, time: '00:52', side: 'system', type: 'verify', technique: 'T1110.003', message: '재공격 40회 중 성공 0회. 11번째 계정에서 지문이 차단됐습니다. 오탐 0%.', _re: 40, _rid: 'R3', _fp: 0 },

    { round: 4, time: '01:20', side: 'red', type: 'attack', technique: 'T1110.004', src_ip: '요청마다 새 IP (30개)', request: 'POST /login  가짜 유출 목록 30쌍 · 45초 간격', status: '401 ×28 · 200 ×2', thought: '빠르게 돌면 걸린다. 다른 곳에서 유출된 계정·비번 쌍을 천천히 하나씩 넣는다.', _att: 30, _br: 2, _acct: 2, _fit: 1 },
    { round: 4, time: '01:20', side: 'system', type: 'breach', technique: 'T1110.004', message: 'park.h, choi.m 계정 세션 탈취. 속도·분산 임계치 모두 아래였습니다.' },
    { round: 4, time: '01:22', side: 'blue', type: 'analysis', technique: 'T1110.004', message: '성공한 2건 모두 처음 보는 기기에서 비밀번호 첫 시도로 로그인했습니다. 속도 대신 로그인 맥락을 보는 룰을 만듭니다.', _rule: 'R4' },
    { round: 4, time: '01:23', side: 'system', type: 'rule_applied', message: 'R4 적용. 차단이 아니라 추가 인증을 요구합니다.', _apply: 'R4' },
    { round: 4, time: '01:47', side: 'system', type: 'verify', technique: 'T1110.004', message: '재공격 30회 중 성공 0회. 새 기기로 로그인한 정상 사용자 1명이 추가 인증을 한 번 거쳤습니다 (오탐 1.5%, 차단 아님).', _re: 30, _rid: 'R4', _fp: 1.5 },
    { round: 4, time: '01:48', side: 'system', type: 'end', message: '4라운드 종료. 탈취 경로 모두 재공격 차단, 운영 중인 룰 4개.' }
  ];

  var PHASE_BY_TYPE = {
    attack: 'attack', breach: 'breach', analysis: 'rule_generated',
    rule_applied: 'rule_applied', verify: 'verified', end: 'done'
  };

  function riskLevel(r) {
    if (r >= 80) return 'CRITICAL';
    if (r >= 40) return 'MEDIUM';
    if (r > 0) return 'LOW';
    return 'SECURE';
  }

  /** step개의 이벤트까지 진행된 상태를 /api/state 형식으로 계산 */
  function buildState(step) {
    var shown = EVENTS.slice(0, step);
    var tech = {};
    TECHS.forEach(function (t) {
      tech[t.id] = { id: t.id, name: t.name, name_ko: t.ko, state: 'untested', fitness: null, fitness_peak: 0,
        attempts: 0, blocked: 0, partial: 0, breached: 0, rule_id: null,
        detail: { how: t.how, why: t.why, rule: null } };
    });
    var rules = {}, ruleOrder = [], rounds = {};
    var attackAttempts = 0, reTotal = 0, breaches = 0, applied = 0, curRound = 0;

    shown.forEach(function (e) {
      curRound = e.round;
      if (!rounds[e.round]) rounds[e.round] = { status: 'running' };
      var t = e.technique ? tech[e.technique] : null;
      if (e._att) { attackAttempts += e._att; t.attempts += e._att; }
      if (e._br) { t.breached += e._br; }
      if (e._partial) { t.partial += e._partial; }
      if (e._acct) { breaches += e._acct; rounds[e.round].breached = true; }
      if (e._fit != null) { t.fitness = e._fit; t.fitness_peak = Math.max(t.fitness_peak, e._fit); }
      if (e._rule) {
        var R = RULES[e._rule];
        rules[e._rule] = { id: R.id, round: R.round, technique: R.technique, title: R.title, reason: R.reason,
          rule: R.rule, status: 'generated', reattack_total: null, reattack_success: null, false_positive: null };
        ruleOrder.push(e._rule);
      }
      if (e._apply) { rules[e._apply].status = 'applied'; applied += 1; }
      if (e._re) {
        reTotal += e._re;
        t.blocked += e._re; t.attempts += e._re; t.fitness = 0; t.rule_id = e._rid;
        var r = rules[e._rid];
        r.status = 'verified'; r.reattack_total = e._re; r.reattack_success = 0; r.false_positive = e._fp;
        rounds[e.round] = { status: 'verified', breached: true, reattack_total: e._re, reattack_success: 0, false_positive: e._fp };
        if (e._also) { tech[e._also].fitness = 0; tech[e._also].rule_id = e._rid; }
      }
    });

    // 위험도 = 100 × (0.7 × 현재 최고 fitness + 0.3 × 테스트한 기법의 가중 평균 fitness)
    // 열린 침투가 하나라도 있으면 높게, 모두 막히면 0이 되도록 설계
    var sw = 0, sf = 0, maxFit = 0;
    TECHS.forEach(function (d) {
      var t = tech[d.id];
      if (t.fitness === null) t.state = 'untested';
      else if (t.fitness === 0) t.state = 'defended';
      else if (t.fitness >= 0.8) t.state = 'breach';
      else t.state = 'near';
      if (t.rule_id) t.detail.rule = t.rule_id + ' · ' + RULES[t.rule_id].title;
      if (t.fitness !== null) { sw += d.weight; sf += d.weight * t.fitness; maxFit = Math.max(maxFit, t.fitness); }
    });
    var risk = Math.round(100 * (0.7 * maxFit + 0.3 * (sw ? sf / sw : 0)));
    var last = shown[shown.length - 1];

    return {
      scenario: { id: 'ato-001', title: '계정 탈취 시나리오', target: 'sample-bank /login' },
      source: 'mock',
      step: step, total_steps: EVENTS.length,
      round: curRound, total_rounds: ROUNDS.length,
      phase: last ? PHASE_BY_TYPE[last.type] : 'idle',
      risk: risk, risk_level: riskLevel(risk),
      kpi: {
        total_attempts: attackAttempts + reTotal,
        attack_attempts: attackAttempts,
        breaches: breaches,
        breach_rate: attackAttempts ? +(100 * breaches / attackAttempts).toFixed(1) : 0,
        rules_applied: applied,
        reattack_total: reTotal,
        reattack_blocked: reTotal
      },
      techniques: TECHS.map(function (d) { return tech[d.id]; }),
      rules: ruleOrder.map(function (id) { return rules[id]; }),
      events: shown.map(function (e, i) {
        return { seq: i + 1, time: e.time, round: e.round, side: e.side, type: e.type,
          technique: e.technique || null, src_ip: e.src_ip || null, request: e.request || null,
          status: e.status || null, thought: e.thought || null, message: e.message || null };
      }),
      rounds: ROUNDS.map(function (R) {
        var s = rounds[R.round] || { status: 'pending' };
        return { round: R.round, technique: R.technique, label: R.label,
          accounts: s.breached ? R.accounts : [], rule_id: (rules[R.rule_id] ? R.rule_id : null),
          status: s.status, reattack_total: s.reattack_total == null ? null : s.reattack_total,
          reattack_success: s.reattack_success == null ? null : s.reattack_success,
          false_positive: s.false_positive == null ? null : s.false_positive };
      })
    };
  }

  /* ---- 재생 제어 (목업 전용) ---- */
  var step = EVENTS.length;
  var timer = null;
  var stepMs = (window.REDI_CONFIG && window.REDI_CONFIG.mockStepMs) || 900;

  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function control(action) {
    if (action === 'play') {
      stop(); step = 0;
      timer = setInterval(function () {
        step += 1;
        if (step >= EVENTS.length) { step = EVENTS.length; stop(); }
      }, stepMs);
    } else if (action === 'next') { stop(); step = Math.min(EVENTS.length, step + 1); }
    else if (action === 'next_round') {
      stop();
      var cur = step < EVENTS.length ? EVENTS[step].round : null;
      while (step < EVENTS.length && EVENTS[step].round === cur) step += 1;
    }
    else if (action === 'end') { stop(); step = EVENTS.length; }
    else if (action === 'reset') { stop(); step = 0; }
    return Promise.resolve({ ok: true });
  }

  return {
    buildState: buildState,
    getState: function () { return Promise.resolve(buildState(step)); },
    control: control,
    isPlaying: function () { return !!timer; },
    totalSteps: EVENTS.length
  };
})();
