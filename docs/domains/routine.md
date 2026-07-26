# 루틴 관리 (Routine)

## DB 스키마

```sql
-- 루틴 템플릿
routine_templates:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  time_slot TEXT,        -- '낮' | '밤'
  frequency TEXT,        -- '매일' | '격일' | '3일마다' | '주1회' (주기형에서만 의미)
  active BOOLEAN,
  tracking_mode TEXT,    -- 'scheduled'(주기형) | 'free'(자율). NOT NULL DEFAULT 'scheduled'. 변경 가능

  category TEXT,         -- 시드 신호용 분류 (운동·건강·자기관리 등). nullable. '운동'은 신호 SQL 고정 참조값
  start_date DATE,       -- 통계 기산 시작일 (기본값: 생성일)
  deleted_at TIMESTAMPTZ,  -- soft delete
  created_at TIMESTAMPTZ

-- 루틴 일별 기록
routine_records:
  id SERIAL PK,
  user_id INTEGER,
  template_id INTEGER FK -> routine_templates.id,
  date DATE,
  completed BOOLEAN,
  completed_at TIMESTAMPTZ,  -- 완료 시점
  memo TEXT,
  entry_type TEXT,           -- 'scheduled'(기대된 발생) | 'free'(자발적 기록).
                             -- NOT NULL DEFAULT 'scheduled'. 생성 시점에 확정, 소급 변경 안 함
  created_at TIMESTAMPTZ

  -- 주기형만 하루 1건 (자율은 하루 여러 건 허용)
  UNIQUE INDEX routine_records_scheduled_daily_uniq
    ON (user_id, template_id, date) WHERE entry_type = 'scheduled'

-- 루틴 비활성 기간
routine_inactive_periods:
  id SERIAL PK,
  template_id INTEGER FK -> routine_templates.id,
  user_id INTEGER,
  start_date DATE,
  end_date DATE,             -- NULL = 현재 비활성 중
  created_at TIMESTAMPTZ
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/routines` | 템플릿 목록 조회 (deleted_at IS NULL) |
| POST | `/api/routines` | 템플릿 생성 (tracking_mode 포함) |
| PATCH | `/api/routines/[id]` | 템플릿 수정 (name, time_slot, frequency, active, start_date, tracking_mode) |
| DELETE | `/api/routines/[id]` | 템플릿 삭제 (soft delete: active=false + deleted_at=NOW()) |
| GET | `/api/routines/records?date=` | 날짜별 기록 조회 (템플릿 JOIN, 주기형만) |
| POST | `/api/routines/records` | 자율 기록 생성 (template_id, date, memo) — 자율 루틴만, 미래 날짜 거부 |
| PATCH | `/api/routines/records/[id]` | 기록 토글 (completed) 또는 메모 수정 |
| DELETE | `/api/routines/records/[id]` | 자율 기록 삭제 (주기형 기록은 삭제 불가) |
| GET | `/api/routines/stats?from=&to=` | 기간별 달성률 통계 |
| GET | `/api/routines/[id]/inactive-periods` | 비활성 기간 목록 조회 |
| POST | `/api/routines/[id]/inactive-periods` | 비활성 기간 생성 |
| PATCH | `/api/routines/[id]/inactive-periods/[periodId]` | 비활성 기간 수정 |
| DELETE | `/api/routines/[id]/inactive-periods/[periodId]` | 비활성 기간 삭제 |
| GET | `/api/routines/[id]/heatmap?year=&month=` | 루틴별 월간 히트맵 데이터 |

## 웹 컴포넌트 구조

```
features/routine/
├── components/
│   ├── routine-page.tsx          # 메인 페이지 (뷰 전환)
│   ├── routine-checklist.tsx     # 일별 체크리스트 (메인 뷰)
│   ├── routine-stats.tsx         # 통계 뷰 (기간별 + 루틴별 달성률)
│   ├── routine-list.tsx          # 템플릿 관리 뷰
│   ├── routine-card.tsx          # 루틴 카드 UI
│   ├── routine-form.tsx          # 템플릿 생성/수정 폼 (시작일 + 비활성 기간 포함)
│   ├── free-routine-section.tsx  # 체크리스트 하단 자율 루틴 섹션 (오늘 기록 수 + 기록하기 버튼)
│   ├── free-record-modal.tsx     # 자율 기록 모달 (날짜·메모 입력, 오늘 기록 목록·삭제)
│   ├── routine-record-detail.tsx # 기록 상세 (메모 편집)
│   ├── routine-heatmap.tsx       # 루틴별 월간 히트맵 (동그라미 캘린더)
│   ├── inactive-period-list.tsx  # 비활성 기간 관리 UI
│   ├── date-nav.tsx              # 날짜 네비게이션 (이전/오늘/다음)
│   ├── view-toggle.tsx           # 뷰 전환 (checklist/stats/manage)
│   ├── monthly-heatmap.tsx       # 월간 히트맵
│   └── yearly-heatmap.tsx        # 연간 히트맵 (GitHub 스타일)
├── hooks/
│   └── use-routines.ts           # 상태 관리 + CRUD + 폴링
└── lib/
    ├── types.ts                  # RoutineTemplateRow, RoutineInactivePeriod, 통계 타입
    └── queries.ts                # 서버 사이드 DB 쿼리
```

## 핵심 로직

### 추적 모드 (주기형 / 자율) — 자율 루틴 Phase 1

루틴에는 두 종류가 있다. **주기형**(`scheduled`)은 빈도대로 그날 해야 하는 것이고, **자율**(`free`)은
주기 없이 수행할 때마다 남기는 것이다. 자전거 타기처럼 "이번 달에 몇 번 했나"만 알면 되는 운동이 후자다.

#### 두 축 — 정의는 템플릿에, 성격은 기록에 (ADR-0061)

| 컬럼 | 위치 | 성질 |
|------|------|------|
| `tracking_mode` | `routine_templates` | **정의**. 사용자가 언제든 바꾼다 |
| `entry_type` | `routine_records` | **사실**. 그 행이 만들어진 성격. 생성 시 확정, 소급 변경 없음 |

모드를 바꿀 때 과거 기록의 `entry_type`을 같이 바꾸지 않는 것이 핵심이다. 3월엔 매일 하기로 했다가
6월부터 자율로 바꿨다면, 3월 기록은 그때 정말 "기대된 발생"이었으므로 그 시절 달성률은 그대로 남아야 한다.
소급 변경하면 이미 계산·발송된 과거 수치가 조용히 달라진다.

여기서 세 규칙이 따라 나온다.

1. **사전 생성은 주기형만** — 자율 루틴엔 기대된 발생이 없으므로 미리 행을 만들지 않는다
2. **기록의 성격은 소급 변경하지 않는다**
3. **"기대된 발생"을 세는 집계는 전부 `entry_type = 'scheduled'`로 범위를 좁힌다**

#### 자동 생성 차단 지점

| 경로 | 차단 방식 |
|------|-----------|
| 봇 크론 (`createTodayRecords`) | 후보 필터에 `tracking_mode === 'scheduled'` |
| 웹 오늘 기록 보장 (`ensureTodayRecords`) | 템플릿 조회 WHERE에 `tracking_mode = 'scheduled'` |
| 템플릿 생성 (POST) | `tracking_mode='free'`면 오늘 기록 INSERT를 건너뜀 |

생성 경로에서는 `entry_type`을 DEFAULT에 맡기지 않고 항상 명시한다 — 기본값에 의존하면 나중에 기본값이
바뀔 때 성격이 조용히 뒤집힌다.

#### 측정 격리

| 계층 | 지점 |
|------|------|
| DB 신호 정의 | `signal_defs` 중 `routine_completion_rate`·`routine_rate_운동` (마이그레이션 108이 교정) |
| 봇 집계 | 감지기 7종(`insights.ts`)·주간 리포트·생활 컨텍스트·기간 해석·임계 평가 |
| 패턴 검증 | 데이터 존재 윈도우 계산 (자율 기록이 시작점을 앞당기면 그 구간이 `0 = fail`로 세진다 — ADR-0044) |
| 웹 통계 | 기간별·루틴별 달성률, 오늘 기록 조회 |
| LLM 프롬프트 | 달성률·연속 달성을 셀 때 조건을 넣도록 데이터 규칙에 명시 |

**표시 경로는 필드로 분기하고, 집계 경로는 SQL로 격리한다.** 활성 템플릿 목록 조회에는 모드 필터를
넣지 않는다 — 자율 루틴도 활성 루틴이므로 걸러내면 "활성 루틴 N개" 표시가 거짓이 된다.

격리하지 않은 곳도 의도된 판단이다. 히트맵은 자율 기록이 섞여도 날짜 단위로 접히도록 `GROUP BY date` +
`bool_or(completed)` 방어만 두었고, 오늘 목록을 이미 격리된 값으로 받는 순수 계산 함수는 그대로 둔다.

#### 하루 몇 건까지

주기형은 하루 1건이 계약이다 (조건부 유니크 인덱스 `routine_records_scheduled_daily_uniq`).
자율은 하루에 여러 번 기록할 수 있어야 하므로 인덱스 대상에서 빠진다 — 아침·저녁에 두 번 자전거를 탔으면
두 건이다.

#### 모드 전환

사용자 입장에서는 같은 루틴이다. 템플릿 하나를 그대로 두고 `tracking_mode`만 바꾼다.

- **주기형 → 자율**: 오늘 자동 생성된 **미완료** 기록만 정리한다. 완료된 기록과 과거 기록은 손대지 않는다
- **자율 → 주기형**: 다음 자동 생성 주기부터 주기형으로 동작한다. 과거 자율 기록은 `free`로 남는다
- 빈도·시작일·비활성 기간은 주기형 전용 개념이다. 자율 모드에서는 폼에서 숨기고, 값 자체는 지운다기보다
  놔둬서 되돌릴 때 그대로 살아나게 한다

#### 웹 기록 경로

체크리스트 하단에 자율 루틴 섹션이 따로 뜨고, `[기록하기]` 버튼으로 모달을 연다. 오늘 목록에 섞어
체크박스로 두지 않은 이유는 자율 루틴엔 "오늘 해야 함"이 없어서다 — 한 단계 더 거치게 하는 쪽이
달성률 UI와 성격이 섞이지 않는다. 달성률 분모도 주기형 기록 수만 센다.

### 빈도(Frequency) 시스템
- `매일`: 매일 기록 생성
- `격일`: 2일 간격
- `3일마다`: 3일 간격
- `주1회`: 7일 간격
- 빈도 판별: `shouldCreateToday()` — 마지막 기록 날짜와 비교하여 오늘 생성 여부 결정
- 간격 파싱: `parseIntervalDays()` — '격일' -> 2, 'N일마다' -> N

### 자동 기록 생성 (ensureTodayRecords)
- 웹 접속 시 또는 API 호출 시, 해당 날짜에 아직 기록이 없는 active 템플릿에 대해 자동 생성
- 빈도에 따라 생성 여부 결정 (매일이 아닌 루틴은 간격 확인)
- soft delete된 템플릿(deleted_at IS NOT NULL)은 제외
- **주기형(`tracking_mode='scheduled'`)만 대상** — 자율 루틴은 기대된 발생이 없어 사전 생성하지 않는다

### 히트맵
- **월간 히트맵**: 달성률 기반 색상 표시 (전체 달성률 집계)
- **연간 히트맵**: GitHub contribution 스타일, 최근 365일 데이터
- **루틴별 월간 히트맵**: 동그라미 캘린더 — 완료(초록)/미완료(빨간 테두리)/비활성(회색) 구분

### 통계
- **일별 달성률**: `RoutineDayStat` — date별 total/completed/rate
- **루틴별 달성률**: `RoutinePerStat` — 템플릿별 total/completed/rate/days_active
  - 전체 기간: active 루틴만 표시
  - 기간 선택: 비활성 포함 (해당 기간에 기록이 있으면)
  - `days_active`: `start_date` 이후 경과 일수 (비활성 기간 일수 차감)

### 시작일 (start_date)
- `start_date` 기준으로 통계 계산 (이전 기록은 제외)
- 관리 탭 루틴 수정 모달에서 직접 수정 가능
- 기본값: 루틴 생성일 (created_at::date)

### 비활성 기간
- 루틴별로 여러 비활성 기간 설정 가능 (`routine_inactive_periods` 테이블)
- 비활성 기간 내 기록은 달성률/일수 카운트에서 제외 (NOT EXISTS 서브쿼리)
- **자동 연동**: 관리 탭에서 ⏸ 비활성화 클릭 → 오늘부터 비활성 기간 자동 생성
- **자동 연동**: 관리 탭에서 ▶ 재개 클릭 → 어제까지로 비활성 기간 자동 종료
- 수동 추가/수정/삭제 가능 (루틴 수정 모달 내 `InactivePeriodList`)

### 뷰 모드
- `checklist`: 일별 체크리스트 (기본 뷰)
- `stats`: 달성률 통계 + 히트맵 (루틴 클릭 시 개별 히트맵 인라인 표시)
- `manage`: 템플릿 생성/수정/삭제 (시작일 + 비활성 기간 관리 포함)

### Optimistic Update
- 체크리스트 토글 시 즉시 UI 반영 (`mutatingRef`로 폴링 충돌 방지)
- 실패 시 원복

### 폴링
- 15초 간격 (탭 활성 시)
- `mutatingRef`: 진행 중인 mutation이 있으면 폴링 응답 무시

### Soft Delete
- 템플릿 삭제 시 `active = false`, `deleted_at = NOW()`
- `deleted_at IS NULL` 조건으로 조회에서 제외
- 기존 기록은 보존 (통계에서 확인 가능)

### 카테고리 (category)
- 인사이트 시드가 분류별 완료율(예: 운동 루틴 완료율)을 분석할 때 참조하는 분류 컬럼 (마이그레이션 053에서 추가)
- nullable — 미분류 루틴은 분류 기반 신호에서 제외
- `운동` 값은 시드 신호 SQL이 문자열로 고정 참조 → 이 라벨은 변경 불가
- 현재 생성/수정 폼에 입력란 없음. 기존 루틴은 이름 기준으로 분류 적용, 신규 루틴 자동 분류는 후속 과제 ([#519](https://github.com/hyewon3938/slack-ai-agents/issues/519))

## 관련 Slack 에이전트

- **채널**: #life
- **에이전트**: life 에이전트가 루틴 CRUD + 완료 처리
- **크론** (체크리스트 블록킷 미발송 — 루틴 체크/관리는 웹 대시보드 전용):
  - 09:05 — 어제 루틴 최종 달성률 한 줄 텍스트
  - 23:55 — 밤 종합 잔소리에 오늘 루틴 달성률 반영
- **달성률 분석 규칙**:
  - `routine_templates.start_date` 확인 필수: 시작일 이전 기간은 달성률 계산에서 제외
  - SQL 조건: `AND r.date >= t.start_date`
- **루틴 메모**: `routine_records.memo` — Slack에서 메모 추가/수정 가능
