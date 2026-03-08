# slack-ai-agents

개인 라이프 데이터 AI 에이전트 시스템.
자연어(Slack) → AI(Claude Sonnet + SQL 도구) → PostgreSQL → Slack 응답.

## 아키텍처

```
[Slack] ──메시지──→ [Node.js 서버] → [Claude Sonnet API (tool use)]
                                          │
                                     ┌────┴────┐
                                     ▼         ▼
                                [PostgreSQL]  [외부 API]
                                (라이프 데이터) (명리학: Gemini)
                                     │
                                [Cron] → [SQL 조회] → [Slack 알림]
```

## 기술 스택

- Runtime: Node.js + TypeScript (strict)
- Slack: @slack/bolt (Socket Mode)
- LLM: Claude Sonnet (메인) — 명리학 분석 전용: Gemini
- DB: PostgreSQL (Oracle Cloud VM)
- Cron: node-cron (timezone: Asia/Seoul)
- Test: vitest

## 핵심 설계 원칙

- **단일 에이전트**: 채널별 분리 없이 하나의 에이전트가 모든 도메인 처리 (LLM이 자율 판단)
- **SQL 도구 기반**: LLM이 직접 SQL을 작성하여 데이터 조회/변경/분석
- **최소 프롬프트**: DB 스키마 + 캐릭터 규칙만. 150줄 규칙 대신 모델 자율성 활용
- **크로스 분석**: 모든 라이프 데이터가 한 DB에 → SQL JOIN으로 패턴 분석
- **환경변수 기반 설정**: API 키, DB 접속 정보 등 모두 .env로 관리

## Slack 채널 구조

| 채널 | 용도 |
|------|------|
| #life | 메인. 모든 자연어 대화, 기록, 분석 |
| #daily | 크론 알림 전용 (아침 브리핑, 밤 리뷰) |

## DB 스키마 (PostgreSQL)

```sql
-- 일정
schedules: id, title, date, end_date, status, category, memo, created_at

-- 루틴 템플릿
routine_templates: id, name, time_slot, frequency, active, created_at

-- 루틴 일별 기록
routine_records: id, template_id(FK), date, completed, created_at

-- 확장 예정: diary, sleep, expenses, fortune
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

## 보안 규칙

- API 키/개인정보 → .env (gitignore 필수)
- .env.example에는 키 이름만
- 시스템 프롬프트에 개인정보 하드코딩 금지
- DB 접속 정보 노출 금지
- Public 저장소 — 커밋 히스토리 민감정보 주의

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

- 커밋이 3~5개 쌓이거나, 주제가 바뀌는 시점에 "여기서 커밋 끊자", "새 브랜치 파자", "PR 만들자" 등을 먼저 제안할 것
- 하나의 브랜치에서 서로 다른 기능이 섞이기 시작하면 PR 머지 → 새 브랜치 전환을 권유할 것

## v1 → v2 전환

현재 v1(Notion + Gemini Flash) → v2(PostgreSQL + Claude Sonnet) 전환 중.
v1 히스토리와 회고는 `docs/project-history.md` 참조.
