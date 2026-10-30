# ops-ui · REDI 관제 대시보드

공격 AI와 방어 AI가 계정 탈취 시나리오로 싸우고, 뚫린 지점이 방어 룰로 바뀌어 재공격을 막는 과정을 보여주는 관제 화면입니다.
**TypeScript + Vite**, 프레임워크 없이 바닐라 DOM으로 만들었습니다.

## 빠른 시작

```bash
cd ops-ui
npm install
npm run dev        # http://localhost:5173  (같은 Wi-Fi의 다른 PC는 http://<내 IP>:5173)
```

백엔드가 꺼져 있으면 자동으로 **MOCK**(5라운드 샘플 시나리오)으로 돌고, 켜져 있으면 **LIVE**로 붙습니다. 오른쪽 위 배지로 구분합니다.

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버. 저장하면 바로 반영. `/api` 요청은 백엔드(기본 `localhost:8000`)로 프록시 |
| `npm run build` | 타입 검사 후 `dist/`에 배포용 파일 생성 |
| `npm run preview` | `dist/`를 미리보기 (http://localhost:4173) |
| `npm run typecheck` | 타입 검사만 |
| `npm run sample` | 목업 시나리오로 `stub/`의 예시 응답 JSON 재생성 |

> `dist/index.html`은 더블클릭(file://)으로 열면 동작하지 않습니다. `npm run preview`나 백엔드 서버로 여세요.

## 설정

`.env.example`을 `.env.local`로 복사해 바꿉니다 (`.env.local`은 git에 안 올라감).

| 변수 | 기본값 | 설명 |
|---|---|---|
| `API_PROXY_TARGET` | `http://localhost:8000` | dev·preview가 `/api`를 넘길 백엔드 주소 |
| `VITE_DATA_MODE` | `auto` | `auto`(백엔드 시도 → 실패 시 목업) / `live` / `mock` |
| `VITE_API_BASE` | (비움) | 빌드본을 백엔드와 다른 주소에서 띄울 때만 |
| `VITE_POLL_MS` | `1000` | 폴링 간격 |
| `VITE_MOCK_STEP_MS` | `900` | 목업 재생 속도 (발표용이면 1500 추천) |

URL 파라미터가 가장 우선합니다: `?mode=mock`, `?mode=live&api=http://192.168.0.10:8000`, `?speed=1500`

## 시나리오 재생 (MOCK)

| 버튼 | 동작 |
|---|---|
| ▶ 처음부터 재생 | 0단계부터 자동 진행 |
| 다음 단계 / 다음 라운드 | 한 이벤트 / 한 라운드씩 (발표용) |
| 결과 바로 보기 / 초기화 | 마지막 상태 / 빈 화면 |

| 라운드 | 공격 패턴 | 침투 | 방어 룰 |
|---|---|---|---|
| R1 | 비밀번호 대입 → 탈취 세션 사용 | 세션 탈취 | R1 IP 단위 임계치 |
| R2 | IP + 브라우저 지문 로테이션 | 세션 탈취 | R2 공격 주체 단위 잠금 |
| R3 | 정찰 에이전트 계정 열거 → 공격 에이전트 살포 | 계정 열거, 세션 탈취 | R3 응답 균일화, R4 작전 단위 다계정 |
| R4 | 사람 흉내 타이밍 + 저속 스터핑 | 세션 탈취 | R5 미끼 접촉 격리 + 새 기기 추가 인증 |
| R5 | 미끼 회피 + MFA 피로 공격 | MFA 승인 | R6 MFA 요청 제한 + 번호 일치 |

## 백엔드 연동

프론트는 두 엔드포인트만 씁니다.

- `GET /api/state` → **`src/types.ts`의 `DashboardState`** 모양 (예시: `stub/sample-state.json`, `stub/sample-state-round4-decoy.json`)
- `POST /api/control` ← `{"action": "play" | "next" | "next_round" | "end" | "reset"}`

연동 테스트용 스텁:
```bash
pip install fastapi uvicorn
cd stub && uvicorn server_stub:app --host 0.0.0.0 --port 8000
# 다른 터미널에서 npm run dev → LIVE 배지 확인
```
`npm run build` 후 스텁을 켜면 `http://localhost:8000/`에서 빌드본도 같이 서빙합니다.

### 판정 기준 (백엔드와 맞출 것)
- **breach_kind:**
  - `session`: 세션 획득
  - `enumeration`: 응답 차이로 계정 식별
  - `mfa`: MFA 승인 받음
  - `data`: 실제 데이터 수집
- **fitness:** 침투 1.0, 부분 0.8~0.99, 시도 중 실패 0.5, 재공격 모두 차단 0, 미테스트 `null`
- **state:** `null`→untested, `0`→defended, `≥0.8`→breach, 그 외→near
- **공격 주체:** 행동 유사도 ≥0.85면 같은 주체. 미끼 접촉은 유사도와 무관하게 자동화 확정
- **risk:** `100 × (0.7 × 현재 최고 fitness + 0.3 × 테스트한 기법의 가중 평균 fitness)`

## 폴더 구조

```
index.html               화면 뼈대
src/
  main.ts                진입점: 데이터 소스 선택, 폴링·재시도
  types.ts               ★ /api/state 응답 타입 (백엔드 계약)
  config.ts              .env / URL 파라미터 읽기
  api.ts                 LiveSource(백엔드) / MockSource(목업)
  styles.css             스타일 (색상 토큰은 맨 위 :root)
  mock/scenario.ts       5라운드 시나리오 데이터 ← 문구·수치 수정은 여기
  mock/buildState.ts     이벤트 → 상태 계산
  ui/                    화면 모듈 (header, techniques, actors, timeline, rulesRounds)
scripts/export-sample.ts 예시 응답 생성
stub/                    백엔드 스텁 + 예시 응답
```

## 수정 포인트
- **새 공격 기법:** `mock/scenario.ts`의 `TECHNIQUES`에 추가하고 `tactic`을 지정하면 히트맵에 자동 배치됩니다.
- **새 이벤트 타입:**
  1. `types.ts`의 `EventType`에 추가
  2. `ui/shared.ts`의 `LABEL`에 추가 (빠뜨리면 타입 오류로 알려 줌)
  3. `styles.css`의 `.ev.<타입>`에 색 지정
- **보안:** LLM이 만든 문장(thought, message, reason, signals)은 반드시 `esc()`를 거쳐 `innerHTML`에 넣으세요.
