# 일정 관리 (Schedule)

## DB 스키마

```sql
-- 일정
schedules:
  id SERIAL PK,
  user_id INTEGER,
  title TEXT,
  date DATE,           -- NULL이면 백로그
  end_date DATE,       -- 기간 일정용
  status TEXT,         -- 'todo' | 'in-progress' | 'done' | 'cancelled'
  category TEXT,       -- categories.name 참조
  subcategory TEXT,    -- 하위 카테고리
  memo TEXT,
  important BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ

-- 카테고리
categories:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT UNIQUE,
  color TEXT,          -- 프리셋명('violet','amber'...) 또는 hex('#ddd6fe')
  type TEXT,           -- 'task' (할일) | 'event' (일정/약속)
  sort_order INTEGER,
  parent_id INTEGER    -- 하위 카테고리 시 상위 카테고리 id
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/schedules?from=&to=` | 날짜 범위 일정 조회 (캘린더용) |
| POST | `/api/schedules` | 일정 생성 |
| PATCH | `/api/schedules/[id]` | 일정 수정 (부분 업데이트) |
| DELETE | `/api/schedules/[id]` | 일정 삭제 |
| GET | `/api/categories` | 카테고리 목록 조회 |
| POST | `/api/categories` | 카테고리 생성 |
| PATCH | `/api/categories/[id]` | 카테고리 수정 |
| DELETE | `/api/categories/[id]` | 카테고리 삭제 |
| PUT | `/api/categories/reorder` | 카테고리 순서 일괄 변경 |

## 웹 컴포넌트 구조

```
features/schedule/
├── components/
│   ├── calendar-header.tsx     # 뷰 전환(월/주/일) + 날짜 네비게이션
│   ├── month-view.tsx          # 월간 캘린더 뷰
│   ├── week-view.tsx           # 주간 캘린더 뷰
│   ├── day-view.tsx            # 일간 상세 뷰
│   ├── day-detail-panel.tsx    # 날짜 선택 시 상세 패널
│   ├── dnd-calendar.tsx        # @dnd-kit 기반 드래그앤드롭 캘린더
│   ├── draggable-card.tsx      # 드래그 가능한 일정 카드
│   ├── droppable-day.tsx       # 드롭 영역 (날짜 셀)
│   ├── schedule-card.tsx       # 일정 카드 UI
│   ├── schedule-form.tsx       # 일정 생성/수정 폼 (모달)
│   ├── status-badge.tsx        # 상태 뱃지 컴포넌트
│   └── action-menu.tsx         # 일정 컨텍스트 메뉴 (수정/삭제/미루기 등)
├── hooks/
│   ├── use-schedules.ts        # 메인 일정 상태 관리 + CRUD + 필터링 + 폴링
│   └── use-backlog.ts          # 백로그(날짜 미지정) 일정 관리
└── lib/
    ├── types.ts                # ScheduleRow, ScheduleStatus, 정렬 함수
    ├── queries.ts              # 서버 사이드 DB 쿼리 (query, queryOne)
    ├── calendar-utils.ts       # 캘린더 유틸 (WEEK_START 등)
    └── __tests__/              # 테스트
```

## 핵심 로직

### 상태 머신
`todo` -> `in-progress` -> `done` / `cancelled`

정렬 순서: `in-progress`(0) > `todo`(1) > `done`(2) > `cancelled`(3)

### 카테고리 색상 시스템
- 프리셋: `PRESET_COLORS` (violet, amber, rose, emerald, sky, blue, orange, pink, teal, indigo, gray)
- 커스텀 hex 지원
- `hexToStyles()`: hex -> `{ bg, border, text }` 인라인 스타일 (밝기 기반 텍스트 색상 자동 결정)
- `getCategoryStyle()`: 프리셋명 또는 hex를 받아 스타일 반환

### 정렬 우선순위 (compareSchedulePriority)
1. event 타입 최상위 (categories.type = 'event')
2. 기간 일정 (end_date 있음) 우선
3. 활성 상태 (in-progress/todo) > 완료/취소
4. 중요 일정 (important=true) 우선
5. 상태 순서 (in-progress > todo > done > cancelled)
6. 카테고리 sort_order

### 드래그앤드롭
- `@dnd-kit` 기반
- 일정 카드를 다른 날짜로 드래그하면 `date` 업데이트
- `draggable-card.tsx` + `droppable-day.tsx` 조합

### 캘린더 뷰
- 3가지 뷰: month / week / day
- 초기 뷰: 모바일(< 768px) = day, 데스크톱 = week
- 15초 폴링 (탭 활성 시), 탭 복귀 시 날짜 갱신

### 필터링
- 카테고리 필터 (상위 + 하위 카테고리)
- 상태 필터 (todo/in-progress/done/cancelled)
- Optimistic update: 상태 변경, 중요 토글 시 즉시 UI 반영

### 백로그
- `date IS NULL`인 일정
- 별도 `use-backlog.ts` 훅으로 관리
- 백로그에서 날짜 지정으로 이동 가능, 반대도 가능 (`handleMoveToBacklog`)

## 관련 Slack 에이전트

- **채널**: #life
- **에이전트**: life 에이전트가 일정 CRUD 처리 (SQL 도구 기반)
- **크론**: 09:05 오늘 일정 알림 + 어제 리뷰
- **일정 표시 포맷** (Slack mrkdwn):
  - 카테고리별 그룹화, event 타입은 접두어 표시, task 타입은 상태 표시
  - 기간 일정은 날짜 범위 표시, 중요 표시는 제목 뒤 별표
- **일정 조회 3대 규칙**:
  1. 기간 일정 포함: `WHERE date = '날짜' OR (date <= '날짜' AND end_date >= '날짜')`
  2. 요일은 SQL로만: `EXTRACT(DOW FROM date)`
  3. 정렬: event 타입 상단 + 카테고리 내 상태 순
