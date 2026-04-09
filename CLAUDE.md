# slack-ai-agents

개인 라이프 데이터 AI 에이전트 시스템.
자연어(Slack) → AI(Claude Sonnet + SQL 도구) → PostgreSQL → Slack 응답.

## 아키텍처 (v3)

```
[Slack] ──메시지──→ [Oracle VM: Node.js 서버 (Docker)]
                        │
                        ▼
                  [Claude Sonnet API (tool use)]
                        │
                   ┌────┴────┐
                   ▼         ▼
              [PostgreSQL]  [외부 API]
              (Oracle VM)   (명리학: Gemini)
                   ↑
              [Vercel]
              (Next.js 웹 대시보드)
```

## 기술 스택

- Runtime: Node.js + TypeScript (strict)
- Slack: @slack/bolt (Socket Mode)
- LLM: Claude Sonnet (메인) — 명리학 분석 전용: Gemini
- DB: PostgreSQL (Oracle VM, Docker)
- Web: Next.js 16 (Vercel 배포)
- Cron: node-cron (timezone: Asia/Seoul)
- Test: vitest

## 핵심 설계 원칙

- **SQL 도구 기반**: LLM이 직접 SQL을 작성하여 데이터 조회/변경/분석
- **도메인별 분리**: 각 도메인의 스키마/API/로직은 도메인 문서에서 관리
- **환경변수 기반 설정**: API 키, DB 접속 정보 등 모두 .env로 관리

## 도메인별 상세

각 도메인의 DB 스키마, API, 컴포넌트 구조, 핵심 로직은 개별 문서 참조:

| 도메인 | 문서 | Slack 채널 |
|--------|------|-----------|
| 일정 관리 | [docs/domains/schedule.md](docs/domains/schedule.md) | #life |
| 루틴 관리 | [docs/domains/routine.md](docs/domains/routine.md) | #life |
| 사주/일기 | [docs/domains/insight.md](docs/domains/insight.md) | #insight |
| 지출/예산 | [docs/domains/budget.md](docs/domains/budget.md) | #money |

**해당 도메인 작업 시 관련 문서만 읽으면 됨** — 전체 스키마를 로드할 필요 없음.

## 에이전트 도구

| 도구 | 설명 |
|------|------|
| `query_db` | SELECT 쿼리 실행 (조회, 분석) |
| `modify_db` | INSERT/UPDATE/DELETE 실행 (변경) |
| `get_schema` | DB 스키마 확인 |

## 에이전트 말투 — 잔소리꾼 친구

- 반말, 이모지/존댓말 금지
- 걱정 많고 잔소리 좀 하지만 진심으로 챙겨주는 친구 톤
- 어미: ~자, ~써, ~해, ~어 (훈장님처럼 ~거라 금지)
- 잔소리는 짧게 한 문장

## 크론 알림

| 시간 | 내용 |
|------|------|
| 09:05 | 오늘 일정 + 낮 루틴 체크리스트 + 어제 리뷰 |
| 23:55 | 하루 종합 리뷰 + 밤 루틴 + 마무리 잔소리 |

## ⛔ 보안 규칙 (CRITICAL — 모든 코드 변경 시 반드시 준수)

> **이 프로젝트는 Public 저장소이며, 개인 일정·수면·루틴 등 민감한 라이프 데이터를 다룬다.**
> **코드 구조, 배포 설정, API 엔드포인트가 모두 공개되어 있으므로 "코드가 보여도 안전한" 설계를 해야 한다.**

### 절대 금지
- API 키, 비밀번호, 토큰, DB 접속 정보 → 코드/커밋에 절대 포함 금지
- **개인 재정 정보(금액, 자산, 부채, 수입, 구독료, 고정비 등) → 코드/커밋/이슈/PR에 절대 포함 금지**
- **개인 상황(재직 상태, 이직/취업 준비, 자금 사정 등) → 이슈/PR/커밋 메시지에 노출 금지**
- **런웨이, 자금 소진 시점 등 재정 상황을 유추할 수 있는 표현 → 공개 영역에 사용 금지**
- 금액이 필요한 스크립트는 반드시 0 또는 placeholder로 작성하고, 실행 전 직접 입력하도록 안내
- .env 값은 .env.example에 키 이름만 기재
- 시스템 프롬프트에 개인정보(이름, IP, 도메인 등) 하드코딩 금지
- 커밋 히스토리에 민감정보 유입 시 즉시 알림
- **이슈/PR 설명은 포트폴리오용 공개 문서로 취급 — 기능 설명만 두루뭉실하게 작성**

### 커밋 메시지 / 이슈 / PR 작성 보안 규칙

> **모든 공개 텍스트(커밋 메시지, 이슈 제목/본문, PR 제목/본문, 댓글)는 포트폴리오에 노출된다고 전제한다.**

- 구체적 취약점/공격 벡터 기술 금지 — "보안 강화", "검증 로직 개선" 수준으로 추상화
- IP 주소, DB 비밀번호, 토큰, 파일 경로 등 인프라 정보 절대 포함 금지
- "유출 대응", "비밀번호 회전", "BFG 정리" 등 **사후 대응 사실 자체**도 노출 금지 (보안 허점이 있었다는 힌트가 됨)
- "런웨이", "이직", "재정 상황" 등 개인 상황을 유추할 수 있는 단어 사용 금지
- **순화/정리 작업 자체를 기록하지 않는다** — "런웨이를 순화했다"는 사실이 또 다른 정보 유출
- 보안 관련 이슈/PR은 **기술적 개선 관점**으로만 작성:
  - Bad: "DB 비밀번호가 git에 유출되어 교체 + BFG 정리"
  - Good: "DB 크레덴셜 교체 + git 히스토리 정리"
  - Bad: "런웨이 표현을 예산 시뮬레이션으로 순화"
  - Good: "이슈/PR 표현 정리"

### 보안 체크리스트
상세 보안 체크리스트 → docs/conventions.md "보안 체크리스트" 섹션 참조

### Claude 보안 행동 규칙
- **모든 PR/코드 리뷰에서 보안 체크리스트를 자동으로 점검**한다
- **커밋 메시지, 이슈, PR 작성 전 위 작성 보안 규칙을 반드시 점검**한다
- 보안 이슈 발견 시 🔴로 표시하고 반드시 수정 후 진행
- "나중에 고치자"는 보안 항목에 적용하지 않는다 — 보안은 항상 즉시 수정
- 새 API 엔드포인트 추가 시 인증 없는 상태로 커밋하지 않는다
- 의심스러운 보안 설정 발견 시 작업을 멈추고 사용자에게 알린다

## 문서 작성 규칙

- 마크다운 문서에서 `~`(틸드)를 범위(`3~5개`)나 근사값(`~1초`)으로 사용할 때 반드시 `\~`로 이스케이프한다. GitHub Flavored Markdown이 `~`를 취소선으로 렌더링하는 것을 방지.
  - 범위: `3\~5회`, `7\~11초`
  - 근사값: `\~1초`, `\~500줄`
  - 코드 블록(``` 또는 백틱) 안의 `~`는 이스케이프 불필요

## 코드 컨벤션 (요약)

- 파일명: kebab-case / 변수·함수: camelCase / 타입·클래스: PascalCase / 상수: UPPER_SNAKE_CASE
- named export 사용 (default export 지양)
- any 금지 → unknown + 타입 가드
- 외부 API 경계에서만 try-catch
- 커밋: Conventional Commits (feat:, fix:, refactor:, test:, chore:)
- 상세 컨벤션 → docs/conventions.md 참조

## 개발 진행 관리

- GitHub Issues에 단계별 개발 계획 정리
- 브랜치: feature/xxx, fix/xxx → main PR
- PR 단위: Issue 1개 = PR 1개
- 프로젝트 히스토리: docs/project-history.md

## Claude 작업 규칙

- 커밋이 3\~5개 쌓이거나, 주제가 바뀌는 시점에 "여기서 커밋 끊자", "새 브랜치 파자", "PR 만들자" 등을 먼저 제안할 것
- 하나의 브랜치에서 서로 다른 기능이 섞이기 시작하면 PR 머지 → 새 브랜치 전환을 권유할 것
- `docs/developer-profile.md` (gitignore 대상)에 개발자 작업 스타일, 의사결정 패턴, 성향 분석을 기록 중. 협업 중 눈에 띄는 포인트(강점, 개선점, 새로운 패턴)가 발견되면 해당 문서의 "관찰 메모" 섹션에 날짜와 함께 추가할 것
