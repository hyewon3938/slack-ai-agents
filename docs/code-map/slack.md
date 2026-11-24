# Slack 진입점

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

## 채널별 에이전트

`registerAgent` 호출에서 뽑았다. 채널 칸은 호출에 넘긴 식 그대로이고 실제 채널 ID는 환경변수에 있다.

| 채널 | 에이전트 | 에이전트 파일 | 등록 파일 |
| --- | --- | --- | --- |
| `CONFIG.channels.life` | `createLifeAgent` | `src/agents/life/index.ts` | `src/app.ts` |
| `CONFIG.channels.insight` | `createInsightAgent` | `src/agents/insight/index.ts` | `src/app.ts` |

## 리스너

`app.action`, `app.view`, `app.event`, `app.message`처럼 Bolt 앱에 등록한 리스너다. 종류가 action인 줄의 ID가 `action_id`다.

| 종류 | ID | 상수 | 등록 파일 | 등록 함수 |
| --- | --- | --- | --- | --- |
| action | `discovery_approve` | `DISCOVERY_APPROVE_ACTION_ID` | `src/agents/insight/actions.ts` | `registerInsightActions` |
| action | `discovery_dismiss` | `DISCOVERY_DISMISS_ACTION_ID` | `src/agents/insight/actions.ts` | `registerInsightActions` |
| action | `llm_signal_approve` | `LLM_SIGNAL_APPROVE_ACTION_ID` | `src/agents/insight/actions.ts` | `registerInsightActions` |
| action | `llm_signal_reject` | `LLM_SIGNAL_REJECT_ACTION_ID` | `src/agents/insight/actions.ts` | `registerInsightActions` |
| action | `diary_edit_open` | `DIARY_EDIT_ACTION_ID` | `src/agents/insight/diary-edit-actions.ts` | `registerDiaryEditActions` |
| view | `diary_edit_submit` | `DIARY_EDIT_VIEW_ID` | `src/agents/insight/diary-edit-actions.ts` | `registerDiaryEditActions` |
| action | `life_routine_complete` | `ROUTINE_ACTION_ID` | `src/agents/life/actions.ts` | `registerLifeActions` |
| action | `life_schedule_status` | `SCHEDULE_ACTION_ID` | `src/agents/life/actions.ts` | `registerLifeActions` |
| action | `life_confirm_modify_execute` | `CONFIRM_MODIFY_EXECUTE_ACTION_ID` | `src/agents/life/actions.ts` | `registerLifeActions` |
| action | `life_confirm_modify_cancel` | `CONFIRM_MODIFY_CANCEL_ACTION_ID` | `src/agents/life/actions.ts` | `registerLifeActions` |
| event | `app_home_opened` |  | `src/agents/life/home.ts` | `registerHomeTab` |
| message |  |  | `src/router.ts` | `registerMessageHandler` |

## fast path 정규식

`agents/` 아래 파일에서 최상위 상수로 선언한 정규식이다. 메시지가 정해진 명령인지 판별해 LLM을 거치지 않고 처리하는 데 쓰는 정규식이 대부분이고 입력값 검사용도 함께 나온다. 쓰는 곳에는 같은 파일 안에서 이 상수를 참조하는 함수를 적었다.

### `src/agents/insight/diary-edit-actions.ts`

- `ISO_DATE_RE`: `/^\d{4}-\d{2}-\d{2}$/`
  - 쓰는 곳: `validateDiaryEditDate`

### `src/agents/insight/diary-edit.ts`

- `DIARY_LOOKUP_RE`: `/^(\d{1,2})\/(\d{1,2})\s*일기$/`
  - 쓰는 곳: `parseDiaryLookup`
  - 주석: 메시지 전체가 "M/D 일기"일 때만 조회 명령

### `src/agents/insight/diary-fast-path.ts`

- `DATED_PREFIX_RE`: `/^(\d{1,2})\/(\d{1,2})(?:\s+([\s\S]*))?$/`
  - 쓰는 곳: `parseDatedDiary`
  - 주석: 맨 앞 "M/D" + 공백·줄바꿈 + 본문. 예: "10/21 산책했다"

### `src/agents/insight/fortune-fast-path.ts`

- `DAILY_FORTUNE_RE`: `/^(오늘\s*)?일운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/`
  - 쓰는 곳: `tryFortuneFastPath`
  - 주석: 일운 조회: "일운", "오늘 일운", "일운 보여줘" 등
- `MONTHLY_FORTUNE_RE`: `/^(이번\s*달?\s*)?월운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/`
  - 쓰는 곳: `tryPeriodInterpretationFastPath`
  - 주석: 월운 조회
- `YEARLY_FORTUNE_RE`: `/^(올해\s*)?세운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/`
  - 쓰는 곳: `tryPeriodInterpretationFastPath`
  - 주석: 세운 조회
- `TOMORROW_FORTUNE_RE`: `/^내일\s*일운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/`
  - 쓰는 곳: `tryFortuneFastPath`
  - 주석: 내일 일운 조회: "내일 일운", "내일 일운 보여줘" 등
- `MAJOR_FORTUNE_RE`: `/^(내\s*)?대운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/`
  - 쓰는 곳: `tryPeriodInterpretationFastPath`
  - 주석: 대운 조회

### `src/agents/insight/index.ts`

- `TODAY_DIARY_RE`: `/^오늘\s*일기/`
  - 쓰는 곳: `createInsightAgent`
  - 주석: 오늘 일기 조회
- `METRIC_LIST_RE`: `/^\/?insight\s+metric-list[.?!]?$/`
  - 쓰는 곳: `createInsightAgent`
  - 주석: LLM 매트릭 pending 목록 조회 (ADR-0030 디버깅·놓친 카드 재확인용)

### `src/agents/insight/pattern-seed-fast-path.ts`

- `SAJU_SEED_LIST_RE`: `/^사주\s*시드\s*보기[.?!]?$/`
  - 쓰는 곳: `tryPatternSeedFastPath`
- `SAJU_SEED_LIST_ALL_RE`: `/^사주\s*시드\s*모두\s*보기[.?!]?$/`
  - 쓰는 곳: `tryPatternSeedFastPath`
- `SAJU_SEED_OFF_RE`: `/^사주\s*시드\s*끄기\s*#?(\d+)[.?!]?$/`
  - 쓰는 곳: `tryPatternSeedFastPath`
- `SAJU_SEED_ON_RE`: `/^사주\s*시드\s*켜기\s*#?(\d+)[.?!]?$/`
  - 쓰는 곳: `tryPatternSeedFastPath`

### `src/agents/life/index.ts`

- `SCHEDULE_QUERY_RE`: `/^(오늘\s*)?일정(\s*(보여줘|보여|알려줘|뭐야|확인|뭐\s*있어))?[.?!]?$/`
  - 쓰는 곳: `createLifeAgent`
  - 주석: 일정 조회 패턴 (오늘 일정 fast path)
- `TOMORROW_SCHEDULE_RE`: `/^내일\s*일정(\s*(보여줘|보여|알려줘|뭐야|확인|뭐\s*있어))?[.?!]?$/`
  - 쓰는 곳: `createLifeAgent`
  - 주석: 내일 일정 조회 패턴
- `BACKLOG_QUERY_RE`: `/^백로그(\s*(보여줘|보여|알려줘|확인|뭐야|뭐\s*있어))?[.?!]?$/`
  - 쓰는 곳: `createLifeAgent`
  - 주석: 백로그 조회 패턴

## 에이전트 도구

| 도구 | 설명 | 파일 |
| --- | --- | --- |
| `query_db` | Execute a read-only SQL query. | `src/shared/sql-tools/definitions.ts` |
| `modify_db` | Execute INSERT, UPDATE, or DELETE. | `src/shared/sql-tools/definitions.ts` |
| `get_schema` | Get database schema: tables, columns, types, constraints. | `src/shared/sql-tools/definitions.ts` |
