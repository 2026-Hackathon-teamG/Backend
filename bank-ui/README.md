# 한결은행 화면 (bank-ui)

공격 에이전트의 표적이 되는 가상 은행 화면입니다.
TypeScript + Vite, 프레임워크 없이 DOM을 직접 다룹니다. `ops-ui`와 같은 구성입니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:8005 (저장하면 바로 반영)
npm run build      # 타입 검사 후 dist/ 생성
npm run typecheck  # 타입 검사만
```

| 상황 | 방법 |
|---|---|
| 백엔드 없이 데모 | `npm run dev` → API가 없으면 자동으로 목업 |
| Docker | `docker build -t bank-ui . && docker run -p 8005:8005 bank-ui` |
| 다른 주소의 게이트웨이 | `http://localhost:8005/?mode=live&api=http://192.168.0.10:8000` |

URL 파라미터
- `mode=auto` (기본): API를 호출하고, 실패하면 목업으로 대체
- `mode=mock`: 항상 목업 / `mode=live`: 항상 API
- `api=<주소>`: 게이트웨이 주소 (기본: 같은 주소)
- `stepup=1`: 목업에서도 로그인마다 추가 인증 요구 (코드 `000000`)

목업 시연 계정은 `src/mock.ts`에 있습니다.

## 화면

| 경로 | 화면 |
|---|---|
| `/` | 메인 |
| `/login` | 로그인, 실패 시 오류 문구. 처음 보는 기기면 인증 코드 입력 단계로 넘어감 |
| `/account` | 내 계좌. 로그인해야 금액을 그림 |
| `/support` | 자주 묻는 질문과 상담 챗봇 |

공격 에이전트는 JS를 실행하지 않고 HTML을 읽습니다. 그래서 머리글과 인감은 `partials/`에서 빌드할 때 넣고, 문구는 HTML에 그대로 둡니다. `nginx.conf`는 없는 경로를 404로 돌려줍니다.

## 백엔드와의 계약

```text
POST /api/v1/login  {"username": "...", "password": "..."}
  200 로그인 성공 (세션 쿠키 발급) / 401 실패
  200 {"step_up_required": true}  처음 보는 기기 (백엔드 STEPUP_ENABLED=1, R5) → 아래 verify 필요

POST /api/v1/login/verify  {"code": "000000"}
  200 로그인 성공 (기기 쿠키 did 발급, 다음부터는 바로 로그인) / 401 코드 틀림 / 400 진행 중인 인증 없음

POST /api/v1/chat   {"message": "..."}
  200 {"reply": "..."}
```

`src/mock.ts`의 챗봇은 인젝션 문구에 내부 지시문을 흘리는 취약점을 재현합니다. 백엔드에서 구현할 때 같은 동작을 맞추면 됩니다.

## 연결

요청 기록과 미끼가 동작하려면 화면도 게이트웨이를 거쳐야 합니다. `TeamG` compose에 `bank-ui`를 추가하고 `BANK_URL=http://bank-ui:8005`로 바꾸면, 화면은 nginx가 내보내고 `/api/`, `/robots.txt`, `/admin-old`, `/health`는 `bank:8001`로 넘어갑니다.

## 가짜 관리자 화면

`decoy/admin_legacy.html`은 `/admin-legacy`용 HTML입니다. 빌드에 포함하지 않으며, 미끼 라우터가 켜져 있을 때만 응답해야 하므로 gateway `decoys/`에서 사용합니다. 개발 서버에서는 `http://localhost:8005/decoy/admin_legacy.html`로 볼 수 있습니다.
