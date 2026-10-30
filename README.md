# REDI – AI 기반 계정 탈취 공격 및 방어 시뮬레이션

**REDI**는 공격 AI와 방어 AI가 상호작용하는 과정을 통해 계정 탈취(ATO, Account Takeover) 공격과 방어 전략을 시뮬레이션하고, 그 결과를 시각적으로 분석하는 보안 훈련 프로젝트입니다.

가상의 은행 서비스인 **한결은행**을 공격 대상으로 설정하고, 공격 AI가 다양한 공격 기법으로 계정 탈취를 시도하면 방어 AI가 공격 패턴을 분석하여 방어 규칙을 생성하고 적용합니다.

공격과 방어가 반복되는 과정을 관제 대시보드에서 확인할 수 있으며, 방어 규칙 적용 전후의 공격 성공률과 보안 수준 변화를 비교할 수 있습니다.

## 📌 주요 기능

### 1. 한결은행 (Bank UI)

공격 대상이 되는 가상의 은행 서비스를 제공합니다.

- **인터넷뱅킹 로그인**
  - 사용자 인증 및 로그인 처리
  - 새로운 기기에서 로그인할 경우 추가 인증(Step-up Authentication) 수행
- **계좌 조회**
  - 로그인 후 계좌 정보 및 잔액 확인
  - 최근 거래 내역 확인
- **고객센터**
  - 자주 묻는 질문(FAQ) 제공
  - 챗봇을 통한 고객 문의 및 응답
- **백엔드 연동**
  - 실제 백엔드 API 연동
  - 백엔드 연결 실패 시 목업 데이터로 대체 가능한 Auto 모드 지원

### 2. REDI 관제 대시보드 (Ops UI)

공격 AI와 방어 AI의 상호작용 및 보안 대응 결과를 실시간으로 모니터링합니다.

- **공격 현황 모니터링**
  - 전체 공격 시도 횟수
  - 계정 탈취 성공 횟수
  - 종합 위험도 및 방어 규칙 적용 현황
- **공격 출발지 시각화**
  - 3D 지구본을 활용한 공격 출발지 표시
  - 실제 서비스 및 미끼망(Decoy)을 대상으로 한 공격 경로 시각화
- **MITRE ATT&CK 기반 공격 분석**
  - 공격 기법별 탐지 및 침투 결과
  - 기법별 공격 성공률과 방어 현황
- **공격 주체(Actor) 분석**
  - IP 및 브라우저 지문이 변경되어도 행동 패턴을 기반으로 동일 공격 주체 식별
  - 공격 주체별 활동 내역 확인
- **실시간 공격 타임라인**
  - 공격 AI(Red Agent)의 공격 과정
  - 방어 AI(Blue Agent)의 분석 및 대응 과정
  - 시스템의 방어 규칙 적용 및 검증 과정
- **라운드별 방어 효과 분석**
  - 방어 규칙 적용 전후 공격 결과 비교
  - 방어 성공 여부 및 정상 사용자 오탐률 확인
- **훈련 제어**
  - 처음부터 재생
  - 다음 단계 진행
  - 다음 라운드 진행
  - 결과 바로 보기
  - 시뮬레이션 초기화
- **결과 리포트**
  - 훈련 결과 요약 PDF 출력

## ⚔️ 공격 및 방어 시나리오

총 5개의 라운드로 구성되며, 공격 AI는 이전 라운드에서 적용된 방어 규칙을 우회하는 방향으로 공격 전략을 발전시킵니다.

| 라운드 | 공격 기법 | 방어 전략 |
|---|---|---|
| Round 1 | 비밀번호 대입 (Password Guessing) | IP 기반 실패 횟수 제한 |
| Round 2 | IP 및 브라우저 지문 로테이션 | 공격 주체(Actor) 기반 차단 |
| Round 3 | 계정 열거 및 비밀번호 살포 | 응답 균일화 및 작전 단위 탐지 |
| Round 4 | 저속 크리덴셜 스터핑 | 미끼 경로 접촉 탐지 및 추가 인증 |
| Round 5 | MFA 피로 공격 | MFA 요청 횟수 제한 및 번호 일치 인증 |

각 라운드에서는 공격 결과를 분석하고 새로운 방어 규칙을 생성합니다. 이후 동일하거나 유사한 공격을 다시 수행하여 방어 규칙이 실제 공격을 차단하는지 검증합니다.

## 🛠️ 기술 스택

### Bank UI

| 구분 | 기술 |
|---|---|
| Language | TypeScript |
| Build Tool | Vite |
| Styling | CSS |
| Backend Communication | Fetch API |

### Ops UI

| 구분 | 기술 |
|---|---|
| Language | TypeScript |
| Build Tool | Vite |
| 3D Visualization | globe.gl |
| Geographic Data | world-atlas |
| Data Processing | topojson-client |
| Styling | CSS |

## 📂 프로젝트 구조

```text
frontend/
├── bank-ui/                  # 한결은행 서비스
│   ├── index.html            # 메인 화면
│   ├── login.html            # 로그인 화면
│   ├── account.html          # 계좌 조회 화면
│   ├── support.html          # 고객센터 화면
│   ├── partials/             # 공통 HTML 조각
│   ├── src/
│   │   ├── main.ts           # 화면 초기화 및 이벤트 처리
│   │   ├── config.ts         # 실행 환경 설정
│   │   ├── live.ts           # 실제 백엔드 API 연동
│   │   ├── mock.ts           # 목업 백엔드
│   │   └── types.ts          # 공통 타입 정의
│   ├── package.json
│   └── vite.config.ts
│
└── ops-ui/                   # REDI 관제 대시보드
    ├── index.html
    ├── src/
    │   ├── main.ts           # 애플리케이션 진입점
    │   ├── config.ts         # 실행 환경 설정
    │   ├── api.ts            # 데이터 소스 및 API 통신
    │   ├── mock/             # 공격 시나리오 및 목업 데이터
    │   └── styles.css
    ├── scripts/
    │   └── export-sample.ts  # 백엔드용 샘플 데이터 생성
    ├── stub/                 # 샘플 응답 데이터
    ├── package.json
    └── vite.config.ts
```

## 🚀 실행 방법

각 UI는 독립적인 Vite 프로젝트로 구성되어 있습니다.

### 1. 사전 요구 사항

- Node.js
- npm

### 2. Bank UI 실행

```bash
cd bank-ui

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

기본 실행 주소:

```text
http://localhost:8005
```

### 3. Ops UI 실행

```bash
cd ops-ui

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

기본 실행 주소:

```text
http://localhost:5173
```

## ⚙️ 실행 환경 설정

두 프로젝트 모두 실제 백엔드 연동과 목업 모드를 지원합니다.

### Bank UI

URL 파라미터를 통해 실행 모드를 변경할 수 있습니다.

| 파라미터 | 설명 |
|---|---|
| `mode=auto` | 백엔드 호출 실패 시 목업으로 전환 |
| `mode=live` | 실제 백엔드 API 사용 |
| `mode=mock` | 목업 데이터 사용 |
| `stepup=1` | 목업에서도 추가 인증 활성화 |
| `api=` | 백엔드 API 주소 지정 |

예시:

```text
# 목업 모드
http://localhost:8005/?mode=mock

# 실제 백엔드 연동
http://localhost:8005/?mode=live&api=http://localhost:8000
```

목업 모드 테스트 계정:

| 항목 | 값 |
|---|---|
| 아이디 | `demo` |
| 비밀번호 | `demo1234` |
| 추가 인증 코드 | `000000` |

### Ops UI

| 파라미터 | 설명 |
|---|---|
| `mode=auto` | 백엔드 연결 실패 시 목업으로 전환 |
| `mode=live` | 실제 백엔드 데이터 사용 |
| `mode=mock` | 브라우저 내장 시나리오 사용 |
| `api=` | 백엔드 API 주소 지정 |
| `poll=` | 데이터 조회 주기(ms) |
| `speed=` | 목업 시나리오 재생 속도(ms) |

예시:

```text
# 목업 모드
http://localhost:5173/?mode=mock

# 실제 백엔드 연동
http://localhost:5173/?mode=live&api=http://localhost:8002
```

기본적으로 Ops UI는 `http://localhost:8002`를 백엔드 API 대상으로 사용하며, Vite 개발 서버에서 `/api` 요청을 프록시합니다.

환경 변수로도 설정할 수 있습니다.

```env
# .env.local

API_PROXY_TARGET=http://localhost:8002
```

## 🔗 백엔드 API 연동

### Bank UI

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/v1/login` | 로그인 |
| POST | `/api/v1/login/verify` | 추가 인증 |
| POST | `/api/v1/chat` | 고객센터 챗봇 |

### Ops UI

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/state` | 현재 훈련 상태 조회 |
| POST | `/api/control` | 훈련 제어 |

Ops UI는 주기적으로 훈련 상태를 조회하며, 통신 실패 시 재시도 간격을 늘려 연결을 복구합니다.

## 📦 빌드 및 배포

각 프로젝트 디렉터리에서 실행합니다.

```bash
# 프로덕션 빌드
npm run build

# 빌드 결과 미리보기
npm run preview

# TypeScript 타입 검사
npm run typecheck
```

빌드 결과물은 각 프로젝트의 `dist/` 디렉터리에 생성됩니다.

## 📝 참고 사항

- 본 프로젝트는 해커톤 시연 및 보안 훈련을 위한 가상 환경입니다.
- 은행 서비스의 계좌 및 거래 정보는 시연용 데이터입니다.
- 공격 시나리오의 IP 주소와 지리적 위치는 가상 데이터입니다.
- 실제 금융 서비스나 실제 공격 대상 시스템을 대상으로 동작하지 않습니다.
- 목업 모드에서는 백엔드 서버 없이 주요 기능과 공격·방어 시나리오를 확인할 수 있습니다.

---

**REDI – Red AI vs Blue AI**

*Simulate attacks. Analyze behaviors. Strengthen defenses.*
