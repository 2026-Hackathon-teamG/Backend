# REDI 관제 대시보드 (프론트엔드)

공격 AI와 방어 AI가 계정 탈취 시나리오로 싸우는 과정을 보여주는 관제 화면입니다.
빌드 도구 없이 HTML + CSS + 바닐라 JS로 만들었습니다. 해커톤 중 바로 수정하고 바로 띄울 수 있게 하려는 선택입니다.

## 실행

| 상황 | 방법 |
|---|---|
| 백엔드 없이 데모 | `index.html`을 브라우저로 열기 → 자동으로 MOCK 모드 |
| 로컬 서버로 열기 | `python -m http.server 5500` → http://localhost:5500 |
| 백엔드 연동 테스트 | `pip install fastapi uvicorn` → `uvicorn server_stub:app --port 8000` → http://localhost:8000 |
| 다른 주소의 백엔드에 붙이기 | `index.html?mode=live&api=http://192.168.0.10:8000` |

URL 파라미터
- `mode=auto` (기본): `/api/state` 연결을 시도하고, 실패하면 목업으로 전환
- `mode=mock`: 항상 목업 / `mode=live`: 항상 백엔드 (끊기면 빨간 배지로 표시하고 계속 재시도)
- `api=<주소>`: 백엔드 주소, `poll=<ms>`: 폴링 간격 (기본 1000)

오른쪽 위 배지로 지금 어떤 데이터를 보고 있는지 확인할 수 있습니다: `LIVE` 초록, `MOCK` 호박색, 연결 끊김 빨강.

## 화면 구성

1. **콘솔 바**: 시나리오, 현재 라운드·단계, RISK 배지, 요약 PDF(브라우저 인쇄), 재생 컨트롤
2. **KPI 4개**: 종합 위험도 링, 총 공격 시도, 침투 성공(성공률), 적용된 방어 룰(재공격 차단률)
3. **mitre_attck.heatmap**: 기법별 카드. 침투=빨강, 위험 근접=호박, 방어=초록(`전 → 후` 표시), 미테스트=점선. 클릭하면 상세 창
4. **penetration.by_technique**: 기법별 시도 / 방어 / 부분 / 뚫림
5. **battle.timeline**: 공격 AI 요청·판단, 침투 감지, 방어 AI 분석, 룰 적용, 재공격 검증. 필터와 자동 스크롤
6. **rules.active**: 방어 AI가 만든 룰 JSON과 검증 결과 (생성됨 → 적용됨 → 차단 검증됨)
7. **rounds.summary**: 라운드별 탈취 계정, 생성 룰, 재공격 결과, 오탐률

## 백엔드와의 계약

프론트는 두 엔드포인트만 씁니다.

### `GET /api/state`
전체 상태를 매 폴링마다 통째로 돌려주면 됩니다. 전체 예시는 `docs/sample-state.json`(종료 시점), `docs/sample-state-round2-breach.json`(라운드 2 침투 직후)에 있습니다.

```jsonc
{
  "scenario": { "id": "ato-001", "title": "계정 탈취 시나리오", "target": "sample-bank /login" },
  "round": 2, "total_rounds": 4,
  "phase": "breach",               // idle | attack | breach | rule_generated | rule_applied | verified | done
  "risk": 79, "risk_level": "MEDIUM",   // CRITICAL(≥80) | MEDIUM(≥40) | LOW(>0) | SECURE(0)
  "kpi": {
    "total_attempts": 26,          // 공격 + 재공격 검증
    "attack_attempts": 16,
    "breaches": 2,                 // 탈취된 계정 수
    "breach_rate": 12.5,           // breaches / attack_attempts × 100
    "rules_applied": 1,
    "reattack_total": 10, "reattack_blocked": 10
  },
  "techniques": [{
    "id": "T1110.001", "name": "Password Guessing", "name_ko": "비밀번호 대입",
    "state": "defended",           // breach | near | defended | untested
    "fitness": 0, "fitness_peak": 1,
    "attempts": 18, "blocked": 10, "partial": 0, "breached": 1,
    "rule_id": "R1",
    "detail": { "how": "…", "why": "…", "rule": "R1 · IP 단위 실패 임계치" }   // 선택
  }],
  "rules": [{
    "id": "R1", "round": 1, "technique": "T1110.001", "title": "IP 단위 실패 임계치",
    "reason": "같은 IP에서 60초 안에 admin 로그인 실패 7회 뒤 성공",
    "rule": { "type": "threshold", "key": "ip", "threshold": 5, "window_sec": 60, "action": "block_ip" },
    "status": "verified",          // generated | applied | verified
    "reattack_total": 10, "reattack_success": 0, "false_positive": 0.0
  }],
  "events": [{
    "seq": 1,                      // 단조 증가. 프론트는 새 seq만 추가로 그림 (줄어들면 초기화로 판단)
    "time": "00:02", "round": 1,
    "side": "red",                 // red | blue | system  (타임라인 필터 기준)
    "type": "attack",              // attack | breach | analysis | rule_applied | verify | end
    "technique": "T1110.001",
    "src_ip": "203.0.113.24", "request": "POST /login user=admin ×4", "status": "401",
    "thought": "공격 AI의 판단 한 줄",   // 선택
    "message": "시스템/방어 AI 메시지"    // 선택
  }],
  "rounds": [{
    "round": 1, "technique": "T1110.001", "label": "비밀번호 대입",
    "accounts": ["admin"], "rule_id": "R1",
    "status": "verified",          // pending | running | verified
    "reattack_total": 10, "reattack_success": 0, "false_positive": 0.0
  }]
}
```

### `POST /api/control`
`{"action": "play" | "next" | "next_round" | "end" | "reset"}`
재생 버튼이 이걸 보냅니다. 백엔드가 데모 중 라운드를 수동으로 넘기는 용도로 `next_round`만 구현해도 충분합니다.

### 판정 기준 (백엔드와 맞춰야 할 것)
- **fitness**: 세션 토큰 획득 = 1.0, 부분 성공(조회만 가능 등) = 0.8~0.99, 시도 중 실패 = 0.5, 재공격이 모두 막힘 = 0
- **state**: `fitness == null` → untested, `0` → defended, `≥ 0.8` → breach, 그 외 → near
- **risk**: `100 × (0.7 × 현재 최고 fitness + 0.3 × 테스트한 기법의 가중 평균 fitness)`.
  열린 침투가 하나라도 있으면 높게, 전부 막히면 0이 되도록 했습니다. 백엔드에서 계산해 내려주면 프론트는 그대로 표시합니다.

## 파일

```
index.html          화면 뼈대
css/style.css       스타일 (색상 토큰은 맨 위 :root)
js/config.js        API 주소·모드·폴링 간격
js/api.js           데이터 계층 (live 폴링 / mock 전환)
js/mock.js          목업 시나리오 4라운드 + 상태 계산 (API 응답 모양의 기준)
js/app.js           렌더링
server_stub.py      백엔드 연동 테스트용 FastAPI 스텁
docs/*.json         상태 응답 예시
```

## 수정 포인트
- 시나리오·문구 바꾸기: `js/mock.js`의 `EVENTS`, `RULES`, `ROUNDS`
- 색: `css/style.css` 맨 위 `:root`
- LLM이 만든 문장(thought, message, reason)은 모두 이스케이프해서 넣습니다. `innerHTML`에 새 필드를 넣을 땐 `esc()`를 꼭 거치세요.
