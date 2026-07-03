# 일정 관리 (Schedule)

## DB 스키마

```sql
-- 일정
schedules:
  id SERIAL PK,
  user_id INTEGER,
  title TEXT,
  date DATE,                -- NULL이면 백로그
  end_date DATE,            -- 기간 일정용
  status TEXT,              -- 'todo' | 'in-progress' | 'done' | 'cancelled'
  category_id INTEGER       -- FK → categories.id, ON DELETE RESTRICT (NULL 가능)
                            --   하위 카테고리에 직접 매핑되며, 부모는 categories.parent_id로 추적
  memo TEXT,
  important BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ

-- 카테고리 (계층은 parent_id로 표현)
categories:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT UNIQUE,
  color TEXT,          -- 프리셋명('violet','amber'...) 또는 hex('#ddd6fe')
  type TEXT,           -- 'task' (할일) | 'event' (일정/약속). 하위는 NULL이면 상위 type 상속
  sort_order INTEGER,
  parent_id INTEGER    -- FK → categories.id. 최상위면 NULL
```

### FK 마이그레이션 (2026-05-13, #394)

- 이전 스키마: `schedules.category TEXT` + `schedules.subcategory TEXT` (rename 시 데이터 연결 끊김)
- 신규 스키마: `schedules.category_id INTEGER FK` (단일 컬럼, `parent_id`로 계층화)
- 설계 판단: [ADR-0013](../adr/0013-schedule-category-fk-migration.md)

### 카테고리 JOIN 패턴 (필수)

일정 표시·그룹화·필터링은 모두 아래 JOIN을 통해 카테고리 이름/타입을 얻는다:

```sql
SELECT s.*,
       s.category_id,
       c.name AS category_name,
       COALESCE(c.type, p.type) AS category_type,   -- 하위에 type 없으면 상위 상속
       COALESCE(p.name, c.name) AS top_category_name -- 그룹화 기준은 항상 최상위
FROM schedules s
LEFT JOIN categories c ON c.id = s.category_id
LEFT JOIN categories p ON p.id = c.parent_id
WHERE s.user_id = $1 AND ...
ORDER BY
  CASE WHEN COALESCE(c.type, p.type) = 'event' THEN 0 ELSE 1 END,
  COALESCE(p.name, c.name) NULLS LAST,
  c.name NULLS LAST,
  CASE s.status WHEN 'done' THEN 1 WHEN 'in-progress' THEN 2 WHEN 'todo' THEN 3 END,
  s.title;
```

### 카테고리 ID 결정 (INSERT 시)

- 이름이 아닌 ID 사용: `INSERT INTO schedules (..., category_id) SELECT ..., id FROM categories WHERE name = ? AND user_id = ? LIMIT 1`
- 사용자가 하위 카테고리 이름을 말하면 그 하위 ID 사용. 매칭 안 되면 상위 카테고리 ID로 fallback.
- 카테고리가 애매하면 `category_id NULL`로 INSERT 가능.

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
│   ├── saju-pillar-label.tsx   # 사주 일주 라벨 (월/주 뷰 공용)
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
- 사주 일주 표시 (2026-05-26 #427, 월간 뷰 확장 2026-07-03): 월·주·일 모든 뷰 날짜 셀에 일주(천간+지지) 한자+한글 병기
  - 계산: `web/src/lib/saju.ts` `getDayPillar(dateStr)` — 봇 `src/shared/saju-calendar.ts`의 복제본 (순수 함수, \~50줄). 동기화 책임은 [ADR-0021](../adr/0021-web-shared-saju-code-duplication.md)
  - 표시 형식: `庚子 경자` (한자 `font-medium` + 한글)
    - 주·일 뷰: `text-[11px]` + `flex-wrap`(좁아지면 두 줄 자동 분리)
    - 월간 뷰: `compact` 모드 — `text-[9px] sm:text-[10px]` + `whitespace-nowrap`(한 줄 고정). 좁은 모바일 셀에서 헤더 높이를 예측 가능하게 유지해 스패닝 바와 겹치지 않게
  - 적용 위치: `month-view.tsx` 날짜 셀(숫자 아래) + `week-view.tsx` 데스크탑 grid 셀·모바일 리스트 카드 + `day-view.tsx` 헤더 옆(자체 배지)
  - 색상: 오늘 `text-blue-600`, 이번 달 아님(월간 뷰) `text-gray-300`, 그 외 `text-gray-500` (day-view 헤더는 항상 `text-blue-600`)
  - 컴포넌트: `SajuPillarLabel` (`saju-pillar-label.tsx`) — 월·주 뷰 공용. `today`/`dimmed`/`compact`/`align` prop으로 뷰별 변형. day-view는 헤더용 자체 배지 사용
  - 월간 뷰는 일주 라벨 한 줄만큼 `DATE_ROW_HEIGHT`를 34→44로 올려 스패닝 바 시작 위치를 라벨 아래로 내림

### 필터링
- 카테고리 필터 (상위 + 하위 카테고리)
- 상태 필터 (todo/in-progress/done/cancelled)
- Optimistic update: 상태 변경, 중요 토글 시 즉시 UI 반영

### 백로그
- `date IS NULL`인 일정
- 별도 `use-backlog.ts` 훅으로 관리
- 백로그에서 날짜 지정으로 이동 가능, 반대도 가능 (`handleMoveToBacklog`)

### 밀린 일정 (overdue)
- 정의: `status='todo'` + 과거 날짜(`date < today`, `date IS NULL` 제외) + **task 타입만**
- event 타입(약속·여행·정보 등)은 완료 체크 대상이 아니라 `status='todo'`로 영구 잔존 → 날짜만 과거로 밀려 무한 카운트됨. 따라서 밀린 일정 집계에서 제외
- `category_type`은 child 우선(`c.type`), 없으면 parent(`p.type`), 둘 다 없으면 `'task'` (`COALESCE(c.type, p.type, 'task') = 'task'`)
- **단일 소스**: `src/shared/life-queries.ts`의 `countOverdueTasks(today, userId)` — 아침 크론 잔소리(insights `detectOverdue`)와 일정 맥락(`queryScheduleContext`)이 공유. 정의가 두 곳에 갈라져 event 타입이 오집계되던 문제를 헬퍼 단일화로 해소

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
