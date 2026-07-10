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
| DELETE | `/api/schedules/[id]` | 일정 삭제 (body로 사유 전달 — 삭제 후 tombstone enrichment) |
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
│   ├── delete-reason-modal.tsx # 삭제 사유 선택 모달 (삭제 확인 단일 지점)
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
    ├── delete-reasons.ts       # 삭제 사유 고정 어휘 5종 (코드·라벨, 마이그 106 CHECK와 동기)
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

## 일정 변경 audit — 기록 경로 (#572, ADR-0054)

`schedule_changes` 테이블은 일정 날짜 변경·삭제를 남기는 **append-only 감사 로그**다. insight 도메인의 미룸/당김 신호가 outcome 메트릭으로 소비하므로(→ [insight.md](insight.md) §42) 기록의 완전성·정직성이 검증 신뢰성의 선행조건이다. 기록 주체·보존 정책·소비 관계를 [ADR-0054](../adr/0054-audit-net-displacement-and-trigger-writer.md)에서 결정. 마이그레이션 [100](../../db/migrations/100_audit_net_displacement.sql).

### 기록 주체 = DB 트리거 2종 (전 경로 단일 계기)

기록은 앱 코드가 아니라 `schedules` 테이블의 트리거가 한다 — 웹 PATCH·Slack 카드 버튼(내일로 미루기·오늘로 옮기기)·에이전트 `modify_db`(LLM 자유 SQL)·수동 psql까지 **모든 날짜 변경 경로가 단일 계기로 수렴**한다. 앱 레벨 writer로는 LLM 자유 SQL 경로를 구조적으로 커버할 수 없어(대화로 옮기면 구멍 재발) 트리거로 단일화했다. 027의 `updated_at` 자동 갱신 트리거와 같은 패턴의 두 번째 적용.

| 트리거 | 계기 | 기록 |
|--------|------|------|
| `record_schedule_date_change` | `AFTER UPDATE OF date` + `WHEN (OLD.date IS DISTINCT FROM NEW.date AND NEW.user_id IS NOT NULL)` | `change_type='date_changed'`, `before/after_value = {date}`, 생성시각 스냅샷 |
| `record_schedule_deletion` | `AFTER DELETE` + `WHEN (OLD.user_id IS NOT NULL)` | `change_type='deleted'` tombstone, `before_value = {date, status, category_id}` |

- `NEW.user_id IS NOT NULL` 가드: `schedules.user_id`가 nullable(016)이라 NOT NULL 컬럼 INSERT 실패로 본 UPDATE·DELETE까지 중단되는 사고 방지.
- `AFTER UPDATE OF date` 한정 — date 외 컬럼 UPDATE에는 트리거가 안 걸린다(`updated_at` 트리거와 공존, 실행 순서 무관).
- **웹 앱 수동 기록 제거**: `updateSchedule`의 `recordScheduleChanges`와 audit 전용 before 선조회를 삭제([web/.../queries.ts](../../web/src/features/schedule/lib/queries.ts)). 기록 주체가 트리거로 이관됐음을 코드 주석으로 명시. 배포 원자성 — 마이그레이션(트리거 생성)과 웹 코드 제거가 같은 배포로 도착, 이중 기록 구간은 순변위 계산에서 `(first, last)` 동일값 반복이라 결과 불변(무해).

### 보존 정책 — FK 제거(로그화) + tombstone

- `schedule_id`의 FK를 **제거**해 삭제 후에도 변경 이력이 `schedule_id` 그대로 남는다. "미루다 포기하고 지운 일정"이 미룸 데이터의 핵심 케이스인데 기존 `ON DELETE CASCADE`는 그걸 통째로 소멸시켰다. 무결성은 writer가 트리거뿐이라 유지.
- `ON DELETE SET NULL`은 기각([ADR-0054](../adr/0054-audit-net-displacement-and-trigger-writer.md) G) — 삭제 시 그 일정의 모든 audit 행이 NULL 한 그룹으로 뭉개져 (일정×하루) 순변위 그룹핑과 생성일 코호트 추적이 둘 다 붕괴.
- `schedule_created_at` 스냅샷 컬럼 — 30분 유예 판정이 `schedules` JOIN 없이 자립(삭제 후에도 유효).
- **원문 비저장**: 스냅샷·tombstone 모두 날짜·시각·id·상태·카테고리뿐, 일정 제목 등 원문은 저장하지 않는다(v2 헌장 ①). 삭제 시점 status로 "done 후 정리 삭제"와 "todo 채 포기 삭제"를 구분할 수 있다.

### `schedule_fate` view — 생성일 코호트 추적 기반 (#574 선행)

살아있는 일정 + 삭제 일정(tombstone) 합집합으로 일정 단위 궤적(생성일 코호트·카테고리·순미룸 일수·최종 상태/삭제)을 낸다. 한 번도 안 옮긴 채 완료된 일정도 포함해 생존 편향을 막는다. 가설·검증 레이어는 [#574](https://github.com/hyewon3938/slack-ai-agents/issues/574)에서 설계하고, 그 전에도 ad-hoc·주간 리뷰에서 소비 가능. 순변위 의미론·측정 정밀화 상세는 insight 도메인 [§42](insight.md) 참조. 마이그레이션 106부터 view 말미에 `delete_reason_category` 노출(살아있는 일정은 NULL) — 아래 삭제 사유 섹션 참조.

### 삭제 사유 수집 (#590, ADR-0060)

삭제 tombstone에 "왜 지웠는지"를 담는다. 마이그레이션 [106](../../db/migrations/106_schedule_delete_reason.sql), 설계 근거 [ADR-0060](../adr/0060-schedule-delete-reason-capture.md).

**컬럼 2개** (둘 다 `change_type='deleted'` 행에서만 허용, CHECK 강제):

- `delete_reason_category TEXT` — 고정 어휘 5종 CHECK. 웹 상수 [delete-reasons.ts](../../web/src/features/schedule/lib/delete-reasons.ts)와 동기.
- `delete_reason_text TEXT` — 자유 텍스트. `other`면 필수, 그 외 선택(수집 규약). **사용자 원문이라 검증·발굴·제안 LLM 입력 금지**(v2 헌장 ①) — 신호화는 category만 (insight [§46](insight.md)).

**사유 어휘 5종**:

| 코드 | 라벨 | 의미 |
|------|------|------|
| `mistake` | 실수로 만든 일정 | 오기입·중복 생성 교정 (통계에선 노이즈로 취급) |
| `changed_mind` | 하기 싫어졌거나 마음이 바뀜 | 내적 취소 — `audit_cancel_changed_mind` 신호의 대상 |
| `external` | 상대방·외부 사정으로 취소됨 | 외생 취소 |
| `rescheduled` | 다른 날짜·일정으로 대체함 | 삭제 후 재생성·대체 |
| `other` | 기타 | 자유 텍스트 필수 |

**기록 규약** — 행 생성은 트리거 단일 계기 그대로(ADR-0054 불변), 사유는 삭제 직후 앱이 **fill-NULL-only UPDATE 1회 enrichment** (`WHERE ... AND delete_reason_category IS NULL`, 최신 tombstone 대상). append-only 로그에 허용하는 유일한 예외이며 트리거가 쓴 필드는 불변.

**경로별 커버리지**:

| 경로 | 수집 방식 |
|------|----------|
| 웹 삭제 (액션 메뉴·수정 폼) | `DeleteReasonModal`(라디오 5종 + 텍스트)이 **유일한 삭제 확인 지점** — 기존 중복 confirm 제거. DELETE API body(`reason_category`/`reason_text`)로 전달 → API가 삭제 후 `recordDeleteReason` enrichment |
| Slack 에이전트 자연어 | 프롬프트 지침([prompt.ts](../../src/agents/life/prompt.ts) 일정/백로그 규칙)으로 대화에서 사유 수집 후 동일 UPDATE. 사용자가 안 주면 미기록 진행 |
| Slack 오버플로우 버튼 | 미기록(NULL) — 빠른 액션 특성상 수용, 한계로 명시 |
