# feat(web): 루틴 관리 대시보드 페이지

## 이슈
- 번호: #150
- 브랜치: `feature/150-routine-dashboard`

## 개요
웹 대시보드에 루틴 전용 페이지(`/routines`) 추가. 루틴 CRUD, 일별 체크리스트, 달성률 시각화(주간 차트 + 월간 히트맵), 루틴 일시정지/비활성화 기능.

## DB 스키마 (기존 — 변경 없음)

```sql
-- routine_templates: id, name, time_slot('낮'/'밤'), frequency('매일'/'격일'/'주1회'/etc), active, user_id, created_at
-- routine_records: id, template_id(FK), date, completed, completed_at, memo, user_id, created_at
```

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `web/src/lib/types.ts` | 수정 | RoutineTemplateRow, RoutineRecordRow 타입 추가 |
| `web/src/features/routine/lib/queries.ts` | 신규 | DB 쿼리 함수 (CRUD + 통계) |
| `web/src/lib/cache.ts` | 수정 | 루틴 캐시 함수 추가 |
| `web/src/app/api/routines/route.ts` | 신규 | GET(목록) / POST(생성) |
| `web/src/app/api/routines/[id]/route.ts` | 신규 | PATCH(수정) / DELETE(삭제) |
| `web/src/app/api/routines/records/route.ts` | 신규 | GET(기록 조회) / POST(기록 생성) |
| `web/src/app/api/routines/records/[id]/route.ts` | 신규 | PATCH(완료 토글, 메모 수정) |
| `web/src/app/api/routines/stats/route.ts` | 신규 | GET(달성률 통계) |
| `web/src/features/routine/hooks/use-routines.ts` | 신규 | 메인 훅 (데이터 페칭, CRUD, 폴링) |
| `web/src/features/routine/components/routine-page.tsx` | 신규 | 페이지 메인 컴포넌트 |
| `web/src/features/routine/components/routine-list.tsx` | 신규 | 루틴 목록 (시간대별 그룹) |
| `web/src/features/routine/components/routine-card.tsx` | 신규 | 개별 루틴 카드 |
| `web/src/features/routine/components/routine-form.tsx` | 신규 | 루틴 추가/수정 폼 |
| `web/src/features/routine/components/routine-checklist.tsx` | 신규 | 일별 체크리스트 |
| `web/src/features/routine/components/routine-stats.tsx` | 신규 | 달성률 차트 + 히트맵 |
| `web/src/features/routine/components/routine-record-detail.tsx` | 신규 | 기록 상세 (메모 확인/편집) |
| `web/src/app/(pages)/routines/page.tsx` | 신규 | Next.js 페이지 파일 |
| `web/src/components/ui/app-shell.tsx` | 수정 | 네비게이션에 '루틴' 탭 추가 |

## 구현 상세

### 1. 타입 정의 (`web/src/lib/types.ts`)

```typescript
/** 루틴 템플릿 */
export interface RoutineTemplateRow {
  id: number;
  name: string;
  time_slot: string | null;  // '낮' | '밤'
  frequency: string | null;  // '매일' | '격일' | '주1회' | 'N일마다'
  active: boolean;
  created_at?: string;
}

/** 루틴 기록 (JOIN 결과) */
export interface RoutineRecordRow {
  id: number;
  template_id: number;
  date: string;
  completed: boolean;
  completed_at: string | null;
  memo: string | null;
  // JOIN fields
  name: string;
  time_slot: string | null;
  frequency: string | null;
}

/** 루틴 일별 통계 */
export interface RoutineDayStat {
  date: string;
  total: number;
  completed: number;
  rate: number;  // 0~100
}

/** 빈도 옵션 */
export const ROUTINE_FREQUENCIES = [
  { value: '매일', label: '매일' },
  { value: '격일', label: '격일' },
  { value: '주1회', label: '주 1회' },
  { value: '3일마다', label: '3일마다' },
] as const;

/** 시간대 옵션 */
export const ROUTINE_TIME_SLOTS = [
  { value: '낮', label: '낮' },
  { value: '밤', label: '밤' },
] as const;
```

### 2. DB 쿼리 (`web/src/features/routine/lib/queries.ts`)

기존 `schedule/lib/queries.ts` 패턴을 따름.

```typescript
import { pool } from '@/lib/db';
import type { RoutineTemplateRow, RoutineRecordRow, RoutineDayStat } from '@/lib/types';

// === 템플릿 CRUD ===

/** 모든 템플릿 조회 (active/inactive 모두, active 먼저 정렬) */
export async function queryRoutineTemplates(userId: number): Promise<RoutineTemplateRow[]> {
  const { rows } = await pool.query<RoutineTemplateRow>(
    `SELECT id, name, time_slot, frequency, active, created_at::text
     FROM routine_templates
     WHERE user_id = $1
     ORDER BY active DESC, time_slot, name`,
    [userId]
  );
  return rows;
}

/** 템플릿 생성 */
export async function createRoutineTemplate(
  userId: number,
  data: { name: string; time_slot: string | null; frequency: string | null }
): Promise<RoutineTemplateRow> {
  const { rows } = await pool.query<RoutineTemplateRow>(
    `INSERT INTO routine_templates (user_id, name, time_slot, frequency, active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, name, time_slot, frequency, active, created_at::text`,
    [userId, data.name, data.time_slot, data.frequency]
  );
  return rows[0];
}

/** 템플릿 수정 (이름, 시간대, 빈도, active) */
const TEMPLATE_COLUMNS = new Set(['name', 'time_slot', 'frequency', 'active']);

export async function updateRoutineTemplate(
  userId: number,
  id: number,
  updates: Record<string, unknown>
): Promise<RoutineTemplateRow | null> {
  const entries = Object.entries(updates).filter(([k]) => TEMPLATE_COLUMNS.has(k));
  if (entries.length === 0) return null;

  const setClauses = entries.map(([k], i) => `${k} = $${i + 3}`);
  const values = entries.map(([, v]) => v);

  const { rows } = await pool.query<RoutineTemplateRow>(
    `UPDATE routine_templates
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, time_slot, frequency, active, created_at::text`,
    [id, userId, ...values]
  );
  return rows[0] ?? null;
}

/** 템플릿 삭제 (soft delete) */
export async function deleteRoutineTemplate(userId: number, id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE routine_templates SET active = false WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

// === 기록 ===

/** 날짜별 기록 조회 (템플릿 JOIN) */
export async function queryRoutineRecords(
  userId: number,
  date: string
): Promise<RoutineRecordRow[]> {
  const { rows } = await pool.query<RoutineRecordRow>(
    `SELECT r.id, r.template_id, r.date::text, r.completed,
            r.completed_at::text, r.memo,
            t.name, t.time_slot, t.frequency
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1 AND r.user_id = $2
     ORDER BY t.time_slot, t.name`,
    [date, userId]
  );
  return rows;
}

/** 기록 완료 토글 */
export async function toggleRoutineRecord(
  userId: number,
  id: number,
  completed: boolean
): Promise<void> {
  await pool.query(
    `UPDATE routine_records
     SET completed = $3, completed_at = ${completed ? 'NOW()' : 'NULL'}
     WHERE id = $1 AND user_id = $2`,
    [id, userId, completed]
  );
}

/** 기록 메모 수정 */
export async function updateRoutineRecordMemo(
  userId: number,
  id: number,
  memo: string | null
): Promise<void> {
  await pool.query(
    `UPDATE routine_records SET memo = $3 WHERE id = $1 AND user_id = $2`,
    [id, userId, memo]
  );
}

/** 오늘 기록 자동 생성 (아직 없는 템플릿만) */
export async function ensureTodayRecords(userId: number, date: string): Promise<number> {
  // shouldCreateToday 로직은 서버사이드에서 frequency 기반으로 판단
  const { rows: templates } = await pool.query<{ id: number; frequency: string | null }>(
    `SELECT id, frequency FROM routine_templates WHERE active = true AND user_id = $1`,
    [userId]
  );

  const { rows: existing } = await pool.query<{ template_id: number }>(
    `SELECT template_id FROM routine_records WHERE date = $1 AND user_id = $2`,
    [date, userId]
  );

  const existingIds = new Set(existing.map(r => r.template_id));
  let created = 0;

  for (const t of templates) {
    if (existingIds.has(t.id)) continue;
    // frequency 체크: shouldCreateToday 로직 복제
    if (await shouldCreateToday(userId, t.id, t.frequency, date)) {
      await pool.query(
        `INSERT INTO routine_records (user_id, template_id, date, completed) VALUES ($1, $2, $3, false)`,
        [userId, t.id, date]
      );
      created++;
    }
  }
  return created;
}

// === 통계 ===

/** 기간별 달성률 통계 */
export async function queryRoutineStats(
  userId: number,
  from: string,
  to: string
): Promise<RoutineDayStat[]> {
  const { rows } = await pool.query<RoutineDayStat>(
    `SELECT r.date::text,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.completed)::int AS completed,
            CASE WHEN COUNT(*) > 0
              THEN ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric / COUNT(*) * 100)::int
              ELSE 0
            END AS rate
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.user_id = $1 AND r.date BETWEEN $2 AND $3
     GROUP BY r.date
     ORDER BY r.date`,
    [userId, from, to]
  );
  return rows;
}
```

### 3. 캐시 (`web/src/lib/cache.ts`에 추가)

```typescript
// 기존 코드 아래에 추가:
export const getCachedRoutineTemplates = (userId: number) =>
  unstable_cache(
    () => queryRoutineTemplates(userId),
    ['routines', String(userId)],
    { revalidate: 30, tags: ['routines'] }
  )();

export const getCachedRoutineRecords = (userId: number, date: string) =>
  unstable_cache(
    () => queryRoutineRecords(userId, date),
    ['routine-records', String(userId), date],
    { revalidate: 30, tags: ['routine-records'] }
  )();

export const getCachedRoutineStats = (userId: number, from: string, to: string) =>
  unstable_cache(
    () => queryRoutineStats(userId, from, to),
    ['routine-stats', String(userId), from, to],
    { revalidate: 30, tags: ['routine-stats'] }
  )();
```

### 4. API 라우트

#### `/api/routines/route.ts` (GET/POST)

```typescript
// GET: 모든 템플릿 조회
// POST: 새 루틴 생성 { name, time_slot?, frequency? }
// 패턴: schedule API와 동일 (requireAuth → validate → query → revalidateTag)
```

#### `/api/routines/[id]/route.ts` (PATCH/DELETE)

```typescript
// PATCH: 루틴 수정 { name?, time_slot?, frequency?, active? }
//   - active: false → 일시정지/비활성화
//   - active: true → 재활성화
// DELETE: soft delete (active=false)
```

#### `/api/routines/records/route.ts` (GET/POST)

```typescript
// GET: ?date=YYYY-MM-DD → 해당 날짜 기록 조회
//   - 자동으로 ensureTodayRecords() 호출 (오늘 날짜인 경우)
// POST: { template_id, date } → 수동 기록 생성
```

#### `/api/routines/records/[id]/route.ts` (PATCH)

```typescript
// PATCH: { completed?, memo? } → 완료 토글 또는 메모 수정
```

#### `/api/routines/stats/route.ts` (GET)

```typescript
// GET: ?from=YYYY-MM-DD&to=YYYY-MM-DD → 기간별 달성률 통계
```

### 5. 메인 훅 (`use-routines.ts`)

useSchedules 패턴 따름:
- 15초 폴링 + visibility 기반 새로고침
- 상태: templates[], records[], stats[], selectedDate, view('checklist'|'stats')
- CRUD: createTemplate, updateTemplate, deleteTemplate, toggleRecord, updateMemo
- 날짜 네비게이션: prev/next/today

### 6. UI 구성

#### 페이지 레이아웃 (routine-page.tsx)

```
┌──────────────────────────────────────┐
│ 루틴        [+ 추가]   [체크리스트|통계] │  ← 헤더 + 뷰 토글
├──────────────────────────────────────┤
│                                      │
│  [체크리스트 뷰]                       │
│  ┌─ 낮 ───────────────────────────┐  │
│  │ ☐ 운동        매일    [⋯]      │  │
│  │ ☑ 영양제      매일    [⋯]      │  │
│  │ ☐ 독서        격일    [⋯]      │  │
│  └────────────────────────────────┘  │
│  ┌─ 밤 ───────────────────────────┐  │
│  │ ☐ 스트레칭    매일    [⋯]      │  │
│  │ ☐ 일기        매일    [⋯]      │  │
│  └────────────────────────────────┘  │
│                                      │
│  오늘 달성률: 1/5 (20%)              │
│  ◀  2026-04-03 (목)  ▶              │  ← 날짜 네비게이션
│                                      │
│  [통계 뷰]                            │
│  ┌─ 주간 달성률 (최근 7일) ──────┐   │
│  │  월 화 수 목 금 토 일          │   │
│  │  ██ ██ ██ ▒▒ ░░ ░░ ░░         │   │  ← 바 차트 (SVG)
│  │  80 90 70 40  -  -  -          │   │
│  └────────────────────────────────┘  │
│                                      │
│  ┌─ 월간 히트맵 ─────────────────┐   │
│  │  ◀  2026년 4월  ▶              │   │
│  │  일 월 화 수 목 금 토          │   │
│  │     ■  ■  ■  □                 │   │  ← GitHub 잔디 스타일
│  │  □  □  □  □  □  □  □          │   │
│  │  ...                           │   │
│  └────────────────────────────────┘  │
│                                      │
│  ┌─ 기간 선택 ───────────────────┐   │
│  │  [시작일] ~ [종료일]  [조회]    │   │
│  └────────────────────────────────┘  │
│                                      │
├──────────────────────────────────────┤
│  [루틴 관리]                          │
│  활성 루틴 (5)                        │
│  ├ 운동 (낮/매일) ····· [수정][⏸]    │
│  ├ 영양제 (낮/매일) ··· [수정][⏸]    │
│  └ ...                               │
│  비활성 루틴 (2)                      │
│  ├ 명상 (낮/매일) ····· [수정][▶]    │
│  └ ...                               │
└──────────────────────────────────────┘
```

#### 모바일 (md 미만)

- 뷰 토글: 탭 형태로 전환
- 루틴 카드: 전체 너비
- 기록 상세: BottomSheet로 표시
- 폼: BottomSheet 또는 전체화면 모달
- 히트맵: 가로 스크롤 또는 축소 표시

#### 루틴 카드 상세 (routine-card.tsx)

- 체크박스 (완료 토글)
- 이름
- 빈도 배지 (격일, 주1회 등 — 매일은 생략)
- 메모 아이콘 (메모가 있으면 표시)
- [⋯] 메뉴: 수정, 메모 추가/편집, 기록 보기, 일시정지

#### 루틴 폼 (routine-form.tsx)

- 이름 (필수, text input)
- 시간대 (낮/밤, 라디오 또는 세그먼트 버튼)
- 빈도 (매일/격일/주1회/N일마다, select)
- 생성/수정/삭제 버튼
- isDirty 체크 (schedule-form 패턴)

#### 기록 상세 (routine-record-detail.tsx)

- 완료 상태 + 완료 시각
- 메모 (텍스트 에디터, 수정 가능)
- 루틴 히스토리 (최근 7일 완료 현황)

#### 달성률 차트 (routine-stats.tsx)

**주간 차트 (SVG 직접 구현):**
- 최근 7일 일별 바 차트
- 색상: 달성률 기반 (0\~30% 빨강, 30\~70% 노랑, 70\~100% 초록)
- 각 바 위에 퍼센트 표시

**월간 히트맵 (SVG 직접 구현):**
- GitHub contribution graph 스타일
- 7열(일\~토) × 4\~5행 격자
- 색상 강도: 달성률에 비례 (0%=회색, 100%=진한 초록)
- 월 네비게이션 (◀ ▶)
- 날짜 클릭 → 해당 날짜 기록 보기

**기간 선택:**
- 시작일, 종료일 date input
- 조회 버튼 → stats API 호출
- 기간 내 평균 달성률 표시

### 7. 네비게이션 수정 (`app-shell.tsx`)

```typescript
// NAV_ITEMS에 추가:
{ href: '/routines', label: '루틴', icon: '🔄' },

// MOBILE_MORE_ITEMS에서 제거 (탭에 직접 노출)
// 모바일 하단 탭: 일정 | 루틴 | 백로그 | 더보기
```

### 8. 차트 라이브러리

외부 라이브러리 없이 SVG 직접 구현:
- 바 차트: `<rect>` + `<text>` 조합
- 히트맵: `<rect>` 격자 + 색상 보간
- 이유: Tailwind 기반 프로젝트에 차트 라이브러리 의존성 추가 불필요, 히트맵/바차트 정도는 SVG로 충분

## 커밋 계획

1. `feat(web): 루틴 타입 정의 + DB 쿼리 함수` — types.ts, queries.ts, cache.ts
2. `feat(web): 루틴 API 라우트 추가` — api/routines/\*\*
3. `feat(web): 루틴 체크리스트 UI` — hooks, routine-page, routine-list, routine-card, routine-checklist
4. `feat(web): 루틴 추가/수정/삭제 폼` — routine-form, CRUD 연동
5. `feat(web): 루틴 달성률 차트 + 히트맵` — routine-stats (SVG)
6. `feat(web): 루틴 기록 상세 + 메모` — routine-record-detail
7. `feat(web): 네비게이션에 루틴 탭 추가` — app-shell.tsx
8. `feat(web): 루틴 일시정지/비활성화 기능` — active 토글 UI

## 테스트 계획

- [ ] 루틴 CRUD API 동작 확인 (생성, 수정, 삭제, 조회)
- [ ] 기록 완료 토글 동작
- [ ] 메모 저장/수정
- [ ] 날짜 네비게이션 (이전/다음/오늘)
- [ ] 달성률 통계 정확성 (수동 계산과 비교)
- [ ] 히트맵 렌더링 (빈 날짜, 100% 달성 날짜)
- [ ] 루틴 비활성화 후 기록 생성 안 됨 확인
- [ ] 모바일 레이아웃 확인
- [ ] 인증 없이 API 접근 시 401

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수 (kebab-case 파일, camelCase 변수, 200줄 이하)
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (any 금지)
- [ ] 에러 핸들링 포함 (API 경계 try-catch)
- [ ] SQL 인젝션 방지 (파라미터 바인딩 + 컬럼 화이트리스트)
- [ ] 모든 API 라우트 인증 검증 (requireAuth)

## Figma 디자인 (재시작 후)

Claude Code 재시작 후 Figma MCP 인증 → 아래 화면들을 Figma에 생성:
1. 체크리스트 뷰 (데스크탑 + 모바일)
2. 통계 뷰 — 주간 차트 + 월간 히트맵
3. 루틴 추가/수정 모달
4. 기록 상세 (메모)
5. 루틴 관리 (활성/비활성 목록)

## project-history.md 업데이트 내용

```markdown
### 루틴 관리 대시보드 (Issue #150)
- 웹 대시보드에 `/routines` 페이지 추가
- 루틴 CRUD + 일별 체크리스트 + 달성률 시각화 (주간 바차트 + 월간 히트맵)
- 루틴 일시정지/비활성화 기능
- SVG 직접 구현 (외부 차트 라이브러리 미사용)
- Figma 디자인 포함
```
