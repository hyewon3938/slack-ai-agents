# slack-ai-agents

개인 라이프 데이터 AI 에이전트 시스템.
자연어(Slack) → AI(Claude Sonnet + SQL 도구) → Neon PostgreSQL → Slack 응답.

## 아키텍처 (v3)

```
[Slack] ──메시지──→ [Oracle VM: Node.js 서버 (Docker)]
                        │
                        ▼
                  [Claude Sonnet API (tool use)]
                        │
                   ┌────┴────┐
                   ▼         ▼
              [Neon DB]    [외부 API]
              (managed     (명리학: Gemini)
               PostgreSQL)
                   ↑
              [Vercel]
              (Next.js 웹 대시보드)
```

## 기술 스택

- Runtime: Node.js + TypeScript (strict)
- Slack: @slack/bolt (Socket Mode)
- LLM: Claude Sonnet (메인) — 명리학 분석 전용: Gemini
- DB: Neon (managed PostgreSQL)
- Web: Next.js 16 (Vercel 배포)
- Cron: node-cron (timezone: Asia/Seoul)
- Test: vitest

## 프로젝트 구조

```
src/
├── app.ts                    # 서버 진입점
├── router.ts                 # 채널별 에이전트 라우팅
├── agents/
│   ├── life/                 # 통합 라이프 에이전트
│   └── insight/              # 명리학 일운 + 일기/고민 에이전트
│       ├── index.ts          # 에이전트 생성 (SQL 도구 기반)
│       ├── prompt.ts         # 시스템 프롬프트 (DB 스키마 + 캐릭터)
│       ├── actions.ts        # 인터랙티브 버튼 핸들러 (루틴 완료 등)
│       └── blocks.ts         # Slack Block Kit 메시지 빌더
├── cron/
│   └── life-cron.ts          # 통합 크론 알림 (아침/점심/저녁/밤)
└── shared/
    ├── config.ts             # 환경변수 검증 + 설정
    ├── llm.ts                # LLM 추상화 (Anthropic/Gemini/Groq)
    ├── agent-loop.ts         # 에이전트 루프 (LLM ↔ 도구 반복)
    ├── db.ts                 # Neon PostgreSQL 연결 + 쿼리
    ├── migrate.ts            # DB 마이그레이션 실행
    ├── sql-tools.ts          # SQL 도구 정의 (query_db, modify_db, get_schema)
    ├── life-queries.ts       # 크론용 SQL 조회 헬퍼
    ├── life-context.ts       # 생활 맥락 빌더 (잔소리 시스템)
    ├── chat-history.ts       # 대화 히스토리 관리
    ├── kst.ts                # KST 타임존 유틸리티
    ├── personality.ts        # 캐릭터 프롬프트 정의
    └── slack.ts              # Slack API 유틸리티
db/
├── migrations/               # SQL 마이그레이션 파일
│   ├── 001_init.sql          # 일정, 루틴 테이블
│   ├── 002_sleep_records.sql # 수면 기록 테이블
│   ├── 003_schedule_important.sql # 일정 중요 표시
│   ├── 004_custom_instructions.sql # 커스텀 지시사항
│   ├── 005_sleep_type.sql    # 수면 유형 (밤잠/낮잠)
│   └── 006_smart_memory.sql  # 스마트 메모리 (카테고리/source/active)
├── migrate.ts                # 마이그레이션 실행 스크립트
├── migrate-from-notion.ts    # Notion → PostgreSQL 1회성 마이그레이션
└── test-connection.ts        # DB 연결 테스트
```

## 핵심 설계 원칙

- **단일 에이전트**: 채널별 분리 없이 하나의 에이전트가 모든 도메인 처리 (LLM이 자율 판단)
- **SQL 도구 기반**: LLM이 직접 SQL을 작성하여 데이터 조회/변경/분석
- **최소 프롬프트**: DB 스키마 + 캐릭터 규칙만. 모델 자율성 활용
- **크로스 분석**: 모든 라이프 데이터가 한 DB에 → SQL JOIN으로 패턴 분석
- **환경변수 기반 설정**: API 키, DB 접속 정보 등 모두 .env로 관리

## Slack 채널

| 채널 | 용도 |
|------|------|
| #life | 메인. 모든 자연어 대화, 기록, 분석 |
| #insight | 명리학 일운 분석 + 일기/고민 기록 |

## DB 스키마 (PostgreSQL)

```sql
-- 일정
schedules: id, title, date, end_date, status, category, memo, important, created_at

-- 루틴 템플릿
routine_templates: id, name, time_slot, frequency, active, created_at

-- 루틴 일별 기록
routine_records: id, template_id(FK), date, completed, created_at

-- 수면 기록
sleep_records: id, date, bedtime, wake_time, duration_minutes, sleep_type(night/nap), memo, created_at

-- 커스텀 지시사항 (스마트 메모리: 카테고리 분류 + 자동 감지 + soft-delete)
custom_instructions: id, instruction, category, source(user/auto), active, created_at

-- 리마인더
reminders: id, title, time_value('HH:MM'), date(일회성), frequency('매일'/'평일'/'주말'/'매주'/'매월'), days_of_week(INTEGER[]), days_of_month(INTEGER[]), repeat_interval(기본1, 격주/격월=2), reference_date, active

-- 사주 프로필
saju_profiles: id, user_id, year/month/day/hour_pillar, gender, daewun_start_age, daewun_direction, daewun_list(JSONB), gyeokguk, yongshin, strength(신강/중화/신약), heeshin(희신), gishin(기신), hanshin(한신), profile_summary, birth_date, birth_time

-- 운세 분석 (일운/월운/세운/대운)
fortune_analyses: id, user_id, date, period(daily/monthly/yearly/major), day/month/year_pillar, analysis, summary, warnings(JSONB), recommendations(JSONB), advice, model — UNIQUE(user_id, date, period)

-- 일기 (날짜별 누적)
diary_entries: id, user_id, date(UNIQUE), content, updated_at

-- 삶의 테마/고민
life_themes: id, user_id, theme, category, detail, active, source(user/auto), first_mentioned, mention_count
```

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
| 09:00 | 오늘 일정 + 루틴 체크리스트 + 어제 리뷰 |
| 13:00 | 미완료 리마인더 + 점심 루틴 |
| 18:00 | 미완료 리마인더 + 저녁 루틴 |
| 22:00 | 하루 종합 리뷰 + 마무리 잔소리 |

## ⛔ 보안 규칙 (CRITICAL — 모든 코드 변경 시 반드시 준수)

> **이 프로젝트는 Public 저장소이며, 개인 일정·수면·루틴 등 민감한 라이프 데이터를 다룬다.**
> **코드 구조, 배포 설정, API 엔드포인트가 모두 공개되어 있으므로 "코드가 보여도 안전한" 설계를 해야 한다.**

### 절대 금지
- API 키, 비밀번호, 토큰, DB 접속 정보 → 코드/커밋에 절대 포함 금지
- .env 값은 .env.example에 키 이름만 기재
- 시스템 프롬프트에 개인정보(이름, IP, 도메인 등) 하드코딩 금지
- 커밋 히스토리에 민감정보 유입 시 즉시 알림

### 인프라/배포 변경 시 필수 보안 체크
코드가 인프라에 영향을 주는 변경(docker-compose, Dockerfile, Vercel 설정, 환경변수, 포트, 인증 등)이 있을 때 **반드시** 아래를 점검:

1. **환경변수**: VM .env / Vercel 환경변수 / .env.example 동기화 확인
2. **인증/세션**: 쿠키 설정(Secure, HttpOnly, SameSite), 세션 만료, 비밀번호 해싱은 적절한가?
3. **HTTPS**: 통신 암호화가 적용되어 있는가? HTTP 평문 전송 구간은 없는가?
4. **CORS/헤더**: API 엔드포인트의 CORS 정책, 보안 헤더(CSP, X-Frame-Options 등)
5. **DB 접근**: Neon 연결은 SSL(sslmode=require) 적용되어 있는가?

### API/웹 엔드포인트 변경 시 필수 보안 체크
1. **인증 확인**: 모든 API 라우트에 세션/인증 검증이 있는가?
2. **입력 검증**: 사용자 입력(body, query, params)이 서버에서 검증되는가?
3. **SQL 인젝션**: 동적 쿼리에 파라미터 바인딩 사용하는가? 컬럼명 화이트리스트 적용했는가?
4. **에러 응답**: 에러 메시지에 내부 구현(스택 트레이스, DB 구조)이 노출되지 않는가?

### Claude 보안 행동 규칙
- **모든 PR/코드 리뷰에서 위 체크리스트를 자동으로 점검**한다
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
