# 미끼망 관제실 (ops-ui)

미끼망 게이트웨이에 걸린 AI 공격 에이전트를 실시간으로 보여 주는 관제 화면입니다.
빌드 도구 없이 HTML + CSS + 바닐라 JS로 만들었습니다. 해커톤 중 바로 고치고 바로 띄우기 위해서입니다.

## 실행

| 상황 | 방법 |
|---|---|
| 백엔드 없이 데모 | `index.html`을 브라우저로 열기 → detector가 없으면 자동으로 MOCK |
| 로컬 서버로 열기 | `python -m http.server 8003` → http://localhost:8003 |
| Docker | `docker build -t ops-ui . && docker run -p 8003:8003 ops-ui` |
| 다른 주소의 detector | `index.html?mode=live&api=http://192.168.0.10:8002` |

URL 파라미터
- `mode=auto` (기본): detector `/healthz` 확인 후 LIVE, 실패하면 MOCK
- `mode=mock`: 항상 목업 / `mode=live`: 항상 detector (끊기면 빨간 배지, 계속 재연결)
- `api=<주소>`: detector 주소 (기본: 화면을 연 호스트의 `:8002`)
- `step=<ms>`: 목업 요청 간격 (기본 650)

오른쪽 위 배지: `LIVE` 초록, `MOCK` 호박, `연결 끊김` 빨강.

## 화면 구성

이전 `redi-dashboard`의 콘솔 바, 위험도 링, MITRE 히트맵, 요약 PDF를 미끼망 데이터에 맞게 옮겨 합쳤습니다.

1. **콘솔 바**: 단계 배지(대기 / 공격 진행 중 / 실제 데이터 유출 중 / 공격 주체 격리 중 / 실행 종료), `LEAK n` 배지, 요약 PDF(브라우저 인쇄), 미끼망 토글, 실시간/재생, 실행, 초기화
2. **지표 6개**: 가로챈 비율 링(가짜 ÷ (실제 + 가짜) 레코드), 실제 고객 데이터 유출, 가짜 레코드 제공, 함정 접촉, 묶어 둔 시간, 격리된 공격 주체
3. **mitre_attck.heatmap / penetration.by_technique**: 기법 6개 카드와 표. 뚫림=빨강, 시도 중=호박, 미끼에 걸림=초록, 관측 없음=점선. 클릭하면 판정 근거와 관련 요청
4. **events.stream**: 요청 로그. bank로 나간 실제 유출은 빨강, 미끼 응답은 초록. `agent_note`는 "에이전트 판단" 줄로 표시
5. **actors**: 공격 주체(`A-01` …) 카드. IP가 바뀌어도 한 카드 아래로 묶임. 확정=초록, 추정=호박. 클릭하면 타임라인
6. **decoys**: 미끼 4종 개별 켜기/끄기
7. **runs.compare**: 실행이 끝날 때마다 `/ops/stats` 값으로 한 줄 추가 (브라우저에 저장, 초기화해도 남음)

격리 알림(`actor_update`, status=`quarantined`)이 오면 Discord 알림과 같은 문구로 토스트를 띄웁니다.

### 기법 판정 (`js/techniques.js`)

백엔드는 기법 정보를 주지 않으므로 받은 이벤트로 화면에서 계산합니다.

| 기법 | 해당 요청 | 뚫림 | 미끼에 걸림 |
|---|---|---|---|
| T1595 정찰 · 숨은 경로 탐색 | `/`, `/robots.txt`, `/api/v1/docs`, `/admin*` | — | 미끼가 주입된 응답을 읽음 |
| T1190 인증 우회 · 내부 헤더 위장 | 세션 없는 `/api/v1/customers` | bank가 2xx | 미끼로 라우팅 |
| T1213 고객 정보 열거 · 수집 | `/api/v1/customers`, `/api/internal/export` | bank가 레코드 반환 | 미끼로 라우팅 |
| AML.T0051 숨은 안내문 추종 | `docs_bait`, `admin_legacy`, `/api/internal/export` | — | export 호출 |
| T1090 IP 교체 · 추적 회피 | 직전 요청과 IP가 다른 요청 | 새 IP가 어느 주체에도 안 묶임 | 새 IP가 주체에 묶임 |
| T1567 데이터 반출 (레코드 수) | `records_out > 0` | bank 레코드 | 미끼 레코드 |

T1190은 Event에 헤더 정보가 없어 "세션 없이 고객 API 성공"으로 근사합니다. 백엔드가 `X-Internal-Request` 여부를 이벤트에 넣어 주면 더 정확해집니다.

## 백엔드 계약 (detector :8002)

| 메서드 | 경로 | 화면에서 쓰는 곳 |
|---|---|---|
| WS | `/ops/stream` | `event`, `actor_update`, `stats`, `reset` 메시지로 실시간 갱신 |
| GET | `/ops/events` | 처음 열 때와 재연결 때 최근 로그 채우기 |
| GET | `/ops/stats` | 지표 초기값, 실행 종료 시 비교 표 |
| GET | `/ops/actors`, `/ops/actors/{id}` | 공격 주체 카드와 상세 |
| POST | `/ops/actors/{id}/release` | 오탐 해제 버튼 |
| GET/PUT | `/ops/decoys`, `/ops/decoys/{id}` | 미끼 상태 |
| POST | `/ops/demo/reset` | 초기화, 미끼망 토글 직후 |
| POST | `/ops/demo/run` | `{"mode": "live" \| "replay"}` |

- 미끼망 토글 = `PUT /ops/decoys {"enabled": …}` → `POST /ops/demo/reset`
- 실행 종료 = `agent_note`가 `__END__`인 이벤트 수신
- `agent_note`, `path` 등은 공격자가 정하는 문자열이므로 모두 이스케이프해서 그립니다

## 파일

```
ops-ui/
├── index.html
├── css/style.css
├── js/
│   ├── config.js   # 주소, 모드, URL 파라미터
│   ├── util.js     # 이스케이프, 숫자·시간 포맷, localStorage
│   ├── techniques.js # 이벤트 → MITRE 기법 히트맵 판정
│   ├── live.js     # detector REST + WS (자동 재연결)
│   ├── mock.js     # 같은 인터페이스의 목업. 시연 시나리오 2·3장면 재현
│   └── app.js      # 화면 렌더링과 조작
├── nginx.conf      # :8003, /healthz
└── Dockerfile
```
