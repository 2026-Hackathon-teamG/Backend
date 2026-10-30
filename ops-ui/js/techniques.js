/**
 * 이벤트를 공격 기법별로 나눠 히트맵 상태를 계산합니다.
 * 백엔드는 기법 정보를 주지 않으므로 Event 필드(path, status, routed_to, decoy_id, records_out, ip)만으로 판정합니다.
 *
 * 기법마다 세는 값
 *   attempts: 해당 기법으로 본 요청 수
 *   denied:   4xx·5xx로 거부된 수
 *   trapped:  미끼가 응답했거나 미끼에 닿은 수
 *   real:     실제 서비스에서 성공한 수
 * 상태: real > 0 → breach, trapped > 0 → defended, attempts > 0 → near, 아니면 untested
 */
window.Techniques = (function () {
  function pathOf(e) { return String(e.path || '').split('?')[0]; }
  function ok(e) { return e.status >= 200 && e.status < 300; }
  function isDecoy(e) { return e.routed_to === 'decoy'; }

  var DEFS = [
    {
      id: 'T1595', name: '정찰 · 숨은 경로 탐색',
      how: '메인, robots.txt, API 문서, 관리자 경로를 훑어 단서를 찾습니다.',
      why: '미끼망은 robots.txt와 API 문서에 에이전트만 읽는 미끼를 심어, 정찰 단계에서 함정 쪽으로 유도합니다.',
      match: function (e) {
        var p = pathOf(e);
        return p === '/' || p === '/robots.txt' || p === '/api/v1/docs' || p.indexOf('/admin') === 0;
      },
      trapped: function (e) { return !!e.decoy_id; },
      real: function () { return false; },
      labels: { defended: '미끼를 읽음' }
    },
    {
      id: 'T1190', name: '인증 우회 · 내부 헤더 위장',
      how: 'X-Internal-Request 헤더로 내부 요청인 척해 로그인 없이 고객 API를 호출합니다.',
      why: '세션 없이 /api/v1/customers가 200을 받으면 우회 성공으로 봅니다. 격리된 주체는 같은 응답 형식의 미끼로 보냅니다.',
      match: function (e) { return pathOf(e) === '/api/v1/customers' && !e.session_id; },
      trapped: isDecoy,
      real: function (e) { return !isDecoy(e) && ok(e); }
    },
    {
      id: 'T1213', name: '고객 정보 열거 · 수집',
      how: '고객 id를 순서대로 바꾸거나 내보내기 API를 넘겨 가며 레코드를 모읍니다.',
      why: '실제 서비스가 레코드를 내주면 유출입니다. 미끼 공간에서는 추적 표식이 든 가짜 레코드만 나갑니다.',
      match: function (e) {
        var p = pathOf(e);
        return p === '/api/v1/customers' || p === '/api/internal/export';
      },
      trapped: isDecoy,
      real: function (e) { return !isDecoy(e) && e.records_out > 0; }
    },
    {
      id: 'AML.T0051', name: '숨은 안내문 추종 (프롬프트 주입 역이용)',
      how: 'API 문서 속 사람 눈에 안 보이는 문장을 읽고 /api/internal/export를 호출합니다.',
      why: 'AI 에이전트는 읽은 글로 행동을 정합니다. 방어자가 심은 문장을 따랐다면 에이전트라는 강한 신호입니다.',
      match: function (e) {
        var p = pathOf(e);
        return e.decoy_id === 'docs_bait' || e.decoy_id === 'admin_legacy' || p === '/api/internal/export';
      },
      trapped: function (e) { return pathOf(e) === '/api/internal/export'; },
      real: function () { return false; },
      labels: { near: '안내문 노출', defended: '안내문에 걸려듦' }
    },
    {
      id: 'T1090', name: 'IP 교체 · 추적 회피',
      how: '403·429를 받으면 IP를 바꿔 같은 작업을 이어 갑니다.',
      why: 'IP 차단은 바뀐 IP를 같은 공격자로 보지 못합니다. 미끼망은 서명된 토큰과 행동 지문으로 같은 주체로 묶습니다.',
      // ip가 바뀐 요청만 해당. ctx.prevIp는 compute()가 채움
      match: function (e, ctx) { return ctx.prevIp !== null && e.ip !== ctx.prevIp; },
      trapped: function (e, ctx) { return !!(e.actor_id || ctx.linkedIps[e.ip]); },
      real: function (e, ctx) { return !(e.actor_id || ctx.linkedIps[e.ip]); },
      labels: { breach: '회피 성공', defended: '같은 주체로 묶임' }
    },
    {
      id: 'T1567', name: '데이터 반출',
      how: '응답으로 받은 고객 레코드를 가져갑니다.',
      why: '실제 레코드는 0건이어야 합니다. 미끼 레코드는 이메일 도메인에 공격 주체 표식이 들어 있어 유출 경로를 추적할 수 있습니다.',
      match: function (e) { return e.records_out > 0; },
      trapped: isDecoy,
      real: function (e) { return !isDecoy(e); },
      count: function (e) { return e.records_out; },
      labels: { breach: '실제 레코드 반출', defended: '가짜 레코드만 반출' }
    }
  ];

  var LABELS = { breach: '실제 성공 · 뚫림', near: '시도 중', defended: '미끼에 걸림', untested: '관측 없음' };

  /**
   * events: 시간순 Event 목록
   * linkedIps: 공격 주체에 묶인 IP 집합 {ip: actorId}
   */
  function compute(events, linkedIps) {
    var out = DEFS.map(function (d) {
      return { id: d.id, name: d.name, how: d.how, why: d.why, attempts: 0, denied: 0, trapped: 0, real: 0, events: [] };
    });
    var ctx = { prevIp: null, linkedIps: linkedIps || {} };
    events.forEach(function (e) {
      if (e.agent_note === '__END__') return;
      DEFS.forEach(function (d, i) {
        if (!d.match(e, ctx)) return;
        var t = out[i], n = d.count ? d.count(e) : 1;
        t.attempts++;
        if (e.status >= 400) t.denied++;
        if (d.real(e, ctx)) t.real += n;
        else if (d.trapped(e, ctx)) t.trapped += n;
        t.events.push(e);
      });
      ctx.prevIp = e.ip;
    });
    out.forEach(function (t, i) {
      t.state = t.real > 0 ? 'breach' : t.trapped > 0 ? 'defended' : t.attempts > 0 ? 'near' : 'untested';
      t.label = (DEFS[i].labels || {})[t.state] || LABELS[t.state];
      t.value = t.state === 'breach' ? t.real : t.state === 'defended' ? t.trapped : t.state === 'near' ? t.attempts : null;
      var share = t.state === 'breach' ? t.real : t.state === 'defended' ? t.trapped : t.denied;
      var total = DEFS[i].count ? t.real + t.trapped : t.attempts;
      t.ratio = total ? Math.min(1, share / total) : 0;
    });
    return out;
  }

  return { compute: compute };
})();
