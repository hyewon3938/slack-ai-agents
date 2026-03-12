# 코드 컨벤션 & 개발 가이드라인

## 팀 규모 가정

1\~2인 소규모 팀. 협업 가능한 수준의 컨벤션 유지.

---

## 네이밍 규칙

| 대상 | 규칙 | 예시 |
|------|------|------|
| 파일명 | kebab-case | `mcp-client.ts` |
| 변수, 함수 | camelCase | `createLLMClient()` |
| 클래스, 인터페이스, 타입 | PascalCase | `LLMClient`, `ToolCall` |
| 상수 | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT` |
| 환경변수 | UPPER_SNAKE_CASE | `GROQ_API_KEY` |

## 파일 & 함수 크기

- 한 파일 200줄 이하 권장 (초과 시 분리 검토)
- 한 함수 30줄 이하 권장
- 한 함수는 하나의 역할만 수행

## Export 규칙

- named export 사용, default export 지양
- 이유: 자동완성/리팩토링 편의, 명시적 이름 강제

## TypeScript 규칙

- `strict: true` 필수
- `any` 사용 금지 → `unknown` + 타입 가드로 대체
- 인터페이스는 사용처 가까이 정의 (여러 곳에서 쓰이면 `shared/types/`로)

## 에러 처리

- 외부 API 호출 경계(Slack, LLM, Notion)에서만 try-catch
- 내부 로직은 타입 시스템으로 안전성 확보
- 에러 로그 형식 통일: `[모듈명] 에러 내용`

## 임포트 순서

1. Node.js 내장 모듈
2. 외부 패키지
3. 내부 모듈 (`@/shared/...`)
4. 상대경로 임포트

---

## 웹 대시보드 컨벤션 (web/)

### 디렉토리 구조 — 도메인별 feature 폴더

```
web/src/
├── app/                          # Next.js 라우팅 (얇게 유지)
│   ├── api/{domain}/             # API 라우트 (도메인별)
│   └── {domain}/page.tsx         # 페이지 = 훅 호출 + 컴포넌트 조합만
├── features/                     # 도메인별 feature 폴더 (핵심)
│   └── {domain}/
│       ├── components/           # 도메인 전용 컴포넌트
│       ├── hooks/                # 도메인 전용 훅
│       └── lib/                  # 도메인 전용 유틸, 타입, 쿼리
├── components/                   # 도메인 무관 공통 UI (modal, bottom-sheet 등)
└── lib/                          # 앱 전역 유틸 (db, auth, kst, 공통 타입)
```

**핵심 원칙:**
- **새 도메인 추가 = `features/` 안에 폴더 하나 생성** (기존 코드 수정 최소화)
- `features/{domain}/` 안에 components, hooks, lib이 자기 완결적으로 존재
- 도메인 간 공유가 필요한 것만 `components/` 또는 `lib/`로 올림
- page.tsx는 훅 호출 + 레이아웃 조합만 (얇은 껍질)

### 컴포넌트 분류

| 분류 | 위치 | 역할 | 예시 |
|------|------|------|------|
| Page | `app/**/page.tsx` | 훅 호출 + 레이아웃 조합 (로직 최소화) | `schedules/page.tsx` |
| Feature | `features/{domain}/components/` | 도메인 로직 + UI, 콜백으로 외부 통신 | `month-view.tsx`, `schedule-form.tsx` |
| UI | `components/` | 도메인 무관, 재사용 가능, 비즈니스 로직 없음 | `modal.tsx`, `filter-bar.tsx` |

### 컴포넌트 구조 규칙

- **named export만 사용** (default export는 `page.tsx`만 예외)
- **Props 인터페이스**는 컴포넌트 파일 상단에 정의
- **콜백 네이밍**: 외부 전달용 `on*` (onSubmit, onClose), 내부 핸들러 `handle*` (handleClick)
- **한 파일 = 한 컴포넌트** 원칙. 내부 서브컴포넌트는 같은 파일에 허용하되 export 금지
- 컴포넌트 파일 200줄 초과 시 서브컴포넌트나 유틸 분리 검토

### 데이터 페칭 패턴

- **도메인 훅**이 데이터 페칭 + 상태 + CRUD 핸들러를 캡슐화
- page.tsx는 훅의 반환값만 컴포넌트에 전달
- 폴링 간격: 15초 (브라우저 탭 비활성 시 중단)
- 401 → `/login` 리다이렉트 패턴 통일
- 새 도메인 추가 시 동일 패턴 복제 (과한 추상화 금지)

### API 라우트 패턴

도메인별 동일 구조 유지:
```
api/{domain}/route.ts       → GET (목록), POST (생성)
api/{domain}/[id]/route.ts  → GET (단건), PATCH (수정), DELETE (삭제)
```
- 모든 라우트 `requireAuth()` 필수
- 입력 검증 + 컬럼 화이트리스트 필수
- 에러 응답: `{ error: string }` (내부 정보 노출 금지)

### 타입 분리 규칙

| 위치 | 내용 |
|------|------|
| `features/{domain}/lib/types.ts` | 도메인 전용 타입 |
| `lib/types.ts` | 공통 타입 (CategoryRow, 색상 시스템, API 응답 등) |

### 상태 관리

- **Client 상태**: `useState`로 로컬 UI 상태 관리. 글로벌 상태 라이브러리 불필요
- **URL 상태**: 뷰 전환, 필터 등 공유 가능한 상태는 URL 파라미터 활용
- **폼 상태**: 필드 5\~6개 수준은 `useState` 직접 관리. 라이브러리 불필요

### 공통 추상화 기준

- **같은 UI 패턴이 2곳 이상** 반복되면 공통 컴포넌트로 추출
- **같은 상수/맵이 2곳 이상** 반복되면 `lib/types.ts` 또는 전용 상수 파일로 이동
- **같은 hook 패턴이 2곳 이상** 반복되면 `hooks/`로 추출
- 추상화 비용 > 중복 비용이면 중복 허용 (소규모 프로젝트 기준)

### 스타일링 (Tailwind)

- **정적 스타일**: Tailwind 클래스 직접 사용
- **동적 색상**: Tailwind가 동적 클래스를 지원하지 않으므로 inline `style` 사용
- **색상 맵**: 상태/카테고리별 색상 매핑은 `lib/types.ts`에 중앙 관리
- **반응형**: `md:` 브레이크포인트 (모바일 퍼스트)

### 에러 처리

- **API 호출 (`fetch`)**: 반드시 try-catch 감싸기
- **catch 블록**: `unknown` 타입 + 사용자에게 피드백 (alert 또는 UI 에러 상태)
- **폼 제출**: loading 상태 관리 (`setSaving(true)` → finally에서 해제)

### 임포트 순서 (React 파일)

1. React / Next.js (`react`, `next/navigation` 등)
2. 외부 패키지 (`@dnd-kit`, `date-fns` 등)
3. 내부 라이브러리 (`@/lib/...`, `@/features/...`)
4. 같은 디렉토리 컴포넌트 (`./schedule-card`)

---

## 보안 체크리스트

> Public 저장소 + 개인 데이터 → 모든 변경에서 보안을 최우선으로 점검한다.

### 시크릿 관리
- [ ] 코드/커밋에 API 키, 비밀번호, 토큰, IP 주소 포함 여부 확인
- [ ] 새 환경변수 추가 시 `.env.example` 동기화
- [ ] VM .env / Vercel 환경변수 / docker-compose.yml 간 시크릿 전달 확인

### API 엔드포인트
- [ ] 모든 라우트에 인증(세션) 검증 미들웨어 적용
- [ ] 사용자 입력(body, query, params)은 서버에서 반드시 검증
- [ ] SQL 동적 쿼리에 파라미터 바인딩 (`$1`, `$2`) 사용
- [ ] 동적 컬럼명은 화이트리스트(Set) 기반 필터링
- [ ] 에러 응답에 스택 트레이스, DB 구조 등 내부 정보 미포함

### 인프라/배포
- [ ] Neon DB 연결에 SSL(`sslmode=require`) 적용 확인
- [ ] 쿠키: `HttpOnly`, `SameSite=lax` 필수 / `Secure`는 HTTPS 환경에서만
- [ ] 보안 헤더 설정 (CSP, X-Frame-Options, X-Content-Type-Options)
- [ ] HTTPS 적용 여부 확인 (Vercel: 자동, VM: 외부 노출 최소화)

### 의존성
- [ ] 새 패키지 추가 시 알려진 취약점 확인 (`yarn audit`)
- [ ] 불필요한 패키지 제거

---

## 설계 원칙

| 원칙 | 적용 방식 |
|------|----------|
| 단일 책임 | 에이전트별 분리, shared 모듈은 하나의 역할만 |
| 추상화 | LLM 레이어 인터페이스 정의 (교체 대비). 나머지는 필요할 때 |
| 중복 최소화 | 에이전트 공통 로직은 shared로, 고유 로직만 각 디렉토리에 |
| 캡슐화 | MCP 클라이언트 내부 구현은 외부에 노출하지 않음 |
| 오버엔지니어링 경계 | 현재 필요한 것만 구현. 단, 인터페이스는 교체/추가에 열려있게 |

### "확장성 있되 오버엔지니어링 아닌" 기준

- 인터페이스/타입은 미리 정의해도 좋다 (비용 낮음, 확장성 높음)
- 구현체는 현재 필요한 것만 (예: Groq 구현체만, Claude는 교체 시점에)
- 공통 base class, 복잡한 DI 컨테이너 같은 건 만들지 않음
- 3개 에이전트 중 2개 이상 패턴이 반복되면 그때 추상화

---

## 리팩토링 기준

아래 조건 중 **2개 이상** 해당되면 리팩토링 검토:

- [ ] 같은 로직이 3곳 이상에서 반복
- [ ] 한 파일이 200줄 초과
- [ ] 한 함수가 3가지 이상의 일을 수행
- [ ] 새 에이전트 추가 시 기존 코드 수정 필요 (개방-폐쇄 위반)
- [ ] 테스트 작성이 어려울 정도로 결합도가 높음

**타이밍**: 각 에이전트 완성 후, 다음 에이전트 시작 전

---

## 테스트 전략

**도구**: vitest

**테스트 대상 (우선순위순)**:

| 영역 | 유형 | 이유 |
|------|------|------|
| LLM 추상화 레이어 | 단위 | Provider 교체 시 동작 보장 |
| 채널별 라우팅 | 단위 | 올바른 에이전트로 분기되는지 |
| 에이전트 프롬프트 + 도구 호출 | 통합 | 자연어 → 도구 선택 흐름 |
| Cron 알림 로직 | 단위 | 데이터 조회 → 메시지 포맷팅 |

**원칙**:
- 외부 API(Slack, Groq, Notion)는 mock 처리
- 비즈니스 로직 중심 테스트 (유틸리티 함수 100% 커버리지 불필요)

---

## 브랜치 & PR 전략

**브랜치**: 간소화된 GitHub Flow

```
main (배포 가능 상태)
 └── feature/xxx (기능)
 └── fix/xxx (버그)
```

**네이밍**: `feature/slack-bolt-setup`, `feature/llm-abstraction`, `fix/date-parsing`

**PR 규칙**:
- 1 Issue = 1 PR
- 커밋 메시지: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`)
- PR 설명에 변경 사항 요약 + 테스트 계획

---

## 기술 선택 시 원칙

새 기술/라이브러리 도입 시 반드시 근거를 남긴다:
- 왜 이 기술인가? (대안 대비 장점)
- 프로젝트 규모에 적합한가?
- 유지보수 비용은?

현재 기술 선택 근거는 GitHub Issues 각 항목에 기록됨.
