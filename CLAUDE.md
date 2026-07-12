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
              [PostgreSQL]
              (Oracle VM)
                   ↑
              [Vercel]
              (Next.js 웹 대시보드)
```

## 기술 스택

- Runtime: Node.js + TypeScript (strict)
- Slack: @slack/bolt (Socket Mode)
- LLM: Claude Sonnet
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
| 수면 | [docs/domains/sleep.md](docs/domains/sleep.md) | #life |
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
| 09:01 | 오늘 일정 + 어제 리뷰 |
| 23:55 | 하루 종합 리뷰 + 마무리 잔소리 |

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
- IP 주소, 비밀번호, 토큰, 내부 파일 경로 등 인프라 정보 절대 포함 금지
- 사후 대응 사실 자체(과거 유출 정황을 시사할 수 있는 표현 일체) 노출 금지
- 개인 상황(재정·고용·생활)을 유추할 수 있는 단어 사용 금지
- 순화/정리 작업 자체를 기록하지 않는다 — 정리 사실이 또 다른 정보 유출
- 보안 관련 이슈/PR은 **선제적 보안 강화** 관점으로만 작성:
  - Bad: 구체 취약점 + 발견 경위 + 사후 조치
  - Good: "입력 검증 강화", "보안 헤더 추가", "접근 제어 강화"

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

## 개발 진행 관리 (5문서 아키텍처)

- GitHub Issues에 단계별 개발 계획 정리
- 브랜치: feature/xxx, fix/xxx → main PR
- PR 단위: Issue 1개 = PR 1개

| 문서 | 역할 | 갱신 주체 |
|------|------|----------|
| `.claude/plans/<이슈>-*.md` | 구현 직전 메모 (휘발) | /design 생성 · /build 머지 후 `_archive/` 이동 |
| `docs/design-notebook/<master>.md` | 마스터 단위 서사 (Phase 별 누적) | /design + /build |
| `docs/adr/NNNN-*.md` | 되돌리기 어려운 결정 (불변) | /design |
| `docs/features.md` | 현재 기능 카탈로그 | /build |
| `docs/domains/<domain>.md` | 도메인 상세 (스키마·API·로직) | /design (phase 섹션 골격) + /build (본문 채우기) |
| `docs/project-history.md` | 포트폴리오 timeline (마일스톤급만) | /build |

- 2026-04-07 이전 초기 마일스톤 archive: docs/history/archive-v1-v2.md
- 도메인 문서 owner 명시 (2026-05-17~): phase 작업이 도메인 기능에 영향을 주면 `/design`이 도메인 문서 phase 섹션 골격(TODO 마커)을 미리 작성, `/build`가 구현 후 본문 채우기. 누락 방지 의무.

## 운영 가이드 (사고 대응)

평소엔 안 보지만 사고 발생 시 즉시 참조:

- `docs/ops/db-backup.md` — DB 백업·복원 (Cloudflare R2)
- `docs/ops/health-monitoring.md` — 업타임 모니터링 (GitHub Actions 5분 폴링)

DB·백업·모니터링 관련 변경/사고 작업 시 해당 문서 먼저 읽고 시작. 실제 운영 상태와 어긋난 게 발견되면 PR 범위에 문서 갱신 포함.

## 비공개 문서 (gitignored)

`docs/_personal/` — Public 영역에 들어가면 안 되는 정보의 단일 저장소:

- `budget-internal.md` — 실제 금액·월 고정비 (Claude가 대화에서 자동 갱신)
- `credentials-internal.md` — 토큰·키 만료일·갱신 절차 (Claude가 자동 갱신)
- `portfolio-candidates.md` — 이력서·면접·README 어필 포인트 (/design phase 마무리에서 후보 제안)
- `design-drafts/` — 비공개 회고 (실수·감정·솔직 분석)

## Claude 작업 규칙

- 커밋이 3\~5개 쌓이거나, 주제가 바뀌는 시점에 "여기서 커밋 끊자", "새 브랜치 파자", "PR 만들자" 등을 먼저 제안할 것
- 하나의 브랜치에서 서로 다른 기능이 섞이기 시작하면 PR 머지 → 새 브랜치 전환을 권유할 것
- 협업 중 눈에 띄는 어필 가능 포인트(기술 결정·작업 방식의 비자명한 패턴) 발견 시, /design phase 마무리에서 portfolio-candidates 후보로 제안
