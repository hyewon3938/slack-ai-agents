# feat(web): 하위 카테고리(서브카테고리) 기능 추가

## 이슈
- 번호: #146
- 브랜치: feature/146-subcategories

## 개요
카테고리 2단계 계층 구조 도입. 상위 카테고리 안에 하위 카테고리를 생성/관리할 수 있도록 한다.
하위 카테고리는 대시보드에서만 태그로 표시하고, 필터링/Slack은 상위 카테고리 기준으로 동작.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `db/migrations/026_subcategories.sql` | 신규 | categories에 parent_id, schedules에 subcategory 추가 |
| `web/src/lib/types.ts` | 수정 | CategoryRow에 parent_id, ScheduleRow에 subcategory 추가 |
| `web/src/features/schedule/lib/queries.ts` | 수정 | 쿼리에 parent_id, subcategory 반영 |
| `web/src/app/api/categories/route.ts` | 수정 | POST에 parent_id 파라미터 추가 |
| `web/src/app/api/schedules/route.ts` | 수정 | POST에 subcategory 파라미터 추가 |
| `web/src/app/api/schedules/[id]/route.ts` | 수정 | PATCH에 subcategory 파라미터 추가 |
| `web/src/app/categories/page.tsx` | 수정 | 하위 카테고리 관리 UI (아코디언) |
| `web/src/features/schedule/components/schedule-form.tsx` | 수정 | 하위 카테고리 선택 UX |
| `web/src/features/schedule/components/schedule-card.tsx` | 수정 | 하위 카테고리 태그 표시 |
| `web/src/components/ui/filter-bar.tsx` | 수정 | 상위 카테고리만 필터에 표시 |

## 구현 상세

### 1. DB 마이그레이션 (`db/migrations/026_subcategories.sql`)

```sql
-- 하위 카테고리: categories 자기 참조 FK
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE;

-- 일정에 하위 카테고리 저장
ALTER TABLE schedules ADD COLUMN subcategory TEXT;

-- 유니크 제약 변경: 기존 (user_id, name) -> 부모별 유니크
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_user_name_unique;

-- 상위 카테고리: (user_id, name) 유니크 (parent_id IS NULL)
CREATE UNIQUE INDEX categories_parent_unique ON categories (user_id, name) WHERE parent_id IS NULL;

-- 하위 카테고리: (user_id, parent_id, name) 유니크
CREATE UNIQUE INDEX categories_child_unique ON categories (user_id, parent_id, name) WHERE parent_id IS NOT NULL;

-- 하위 카테고리 조회용 인덱스
CREATE INDEX idx_categories_parent_id ON categories (parent_id);
```

**설명:**
- `parent_id IS NULL` = 상위 카테고리, `parent_id IS NOT NULL` = 하위 카테고리
- ON DELETE CASCADE: 상위 삭제 시 하위도 자동 삭제
- 같은 상위 안에서만 이름 유니크, 다른 상위의 하위는 같은 이름 허용
- `schedules.subcategory`는 하위 카테고리 이름 저장 (TEXT, nullable)

### 2. 타입 정의 (`web/src/lib/types.ts`)

**Before:**
```typescript
export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  type: CategoryType;
  sort_order: number;
}

export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category: string | null;
  memo: string | null;
  important: boolean;
  created_at?: string;
}
```

**After:**
```typescript
export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  type: CategoryType;
  sort_order: number;
  parent_id: number | null;
}

export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category: string | null;
  subcategory: string | null;
  memo: string | null;
  important: boolean;
  created_at?: string;
}
```

### 3. 쿼리 레이어 (`web/src/features/schedule/lib/queries.ts`)

#### 3-1. queryCategories -- parent_id 추가

**Before:**
```typescript
"SELECT id, name, color, COALESCE(type, 'task') as type, sort_order FROM categories WHERE user_id = $1 ORDER BY sort_order, name"
```

**After:**
```typescript
"SELECT id, name, color, COALESCE(type, 'task') as type, sort_order, parent_id FROM categories WHERE user_id = $1 ORDER BY parent_id NULLS FIRST, sort_order, name"
```

#### 3-2. createCategory -- parent_id 지원

**Before:**
```typescript
export const createCategory = async (
  userId: number,
  data: { name: string; color?: string; type?: string },
): Promise<CategoryRow> => {
  const maxOrder = await queryOne<{ max: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) as max FROM categories WHERE user_id = $1',
    [userId],
  );
```

**After:**
```typescript
export const createCategory = async (
  userId: number,
  data: { name: string; color?: string; type?: string; parent_id?: number | null },
): Promise<CategoryRow> => {
  const parentId = data.parent_id ?? null;
  const maxOrder = await queryOne<{ max: number }>(
    parentId
      ? 'SELECT COALESCE(MAX(sort_order), 0) as max FROM categories WHERE user_id = $1 AND parent_id = $2'
      : 'SELECT COALESCE(MAX(sort_order), 0) as max FROM categories WHERE user_id = $1 AND parent_id IS NULL',
    parentId ? [userId, parentId] : [userId],
  );
  const result = await query<CategoryRow>(
    `INSERT INTO categories (user_id, name, color, type, sort_order, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, color, COALESCE(type, 'task') as type, sort_order, parent_id`,
    [userId, data.name, data.color ?? 'gray', data.type ?? 'task', (maxOrder?.max ?? 0) + 1, parentId],
  );
```

#### 3-3. updateCategory -- RETURNING에 parent_id 추가

```typescript
RETURNING id, name, color, COALESCE(type, 'task') as type, sort_order, parent_id
```

#### 3-4. 일정 쿼리 -- subcategory 추가

querySchedulesByRange, queryBacklogSchedules, queryScheduleById 모두:
```typescript
`SELECT id, title, date::text, end_date::text, status, category, subcategory, memo, important`
```

#### 3-5. createSchedule -- subcategory 파라미터

```typescript
// data 타입에 subcategory?: string | null 추가
// INSERT에 subcategory 컬럼 추가
`INSERT INTO schedules (user_id, title, date, end_date, status, category, subcategory, memo, important)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
 RETURNING id, title, date::text, end_date::text, status, category, subcategory, memo, important`
```

#### 3-6. updateSchedule -- subcategory 허용

```typescript
const SCHEDULE_COLUMNS = new Set([
  'title', 'date', 'end_date', 'status', 'category', 'subcategory', 'memo', 'important',
]);
// RETURNING에도 subcategory 추가
```

### 4. API 라우트 수정

#### 4-1. `POST /api/categories` -- parent_id 수용

```typescript
const body = (await request.json()) as { name?: string; color?: string; type?: string; parent_id?: number };

const data = await createCategory(userId, {
  name: body.name.trim(),
  color: body.color,
  type: body.type,
  parent_id: body.parent_id ?? null,
});
```

#### 4-2. `POST /api/schedules` + `PATCH /api/schedules/[id]` -- subcategory 수용

```typescript
// body 타입에 subcategory?: string | null 추가
// createSchedule / updateSchedule 호출 시 subcategory 포함
```

### 5. 카테고리 관리 페이지 (`web/src/app/categories/page.tsx`)

#### 변경 후 구조
```
[카테고리 추가 폼] (기존과 동일 -- 상위 카테고리만 추가)

[상위 카테고리 1] [뱃지] [타입] [수정] [삭제] [> 펼치기]
  (접힌 상태: 하위 N개)

[상위 카테고리 1] [뱃지] [타입] [수정] [삭제] [v 접기]
  [하위 카테고리 추가 폼: 이름 + 색상 + 추가 버튼]
  [하위1] [뱃지] [수정] [삭제] [up] [down]
  [하위2] [뱃지] [수정] [삭제] [up] [down]
```

#### 구현 디테일

**상태 추가:**
```typescript
const [expandedId, setExpandedId] = useState<number | null>(null);
const [newSubName, setNewSubName] = useState('');
const [newSubColor, setNewSubColor] = useState('gray');
```

**렌더링 로직:**
```typescript
const parentCategories = categories.filter(c => c.parent_id === null);
const getChildren = (parentId: number) =>
  categories.filter(c => c.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);
```

**아코디언 영역:**
- 상위 카테고리 행에 펼침/접기 버튼 추가
- 펼치면: 하위 추가 폼 + 하위 목록 (이름 + ColorPicker만, TypeSelector 없음)
- 하위 순서 변경: 화살표 버튼 (DnD 없이, 수가 적으므로)
- 하위 수정: 인라인 (이름 + 색상)
- 하위 삭제: confirm 후 DELETE

**하위 카테고리 CRUD:**
```typescript
const handleCreateSub = async (parentId: number) => {
  if (!newSubName.trim()) return;
  await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newSubName.trim(), color: newSubColor, parent_id: parentId }),
  });
  setNewSubName('');
  setNewSubColor('gray');
  await fetchCategories();
};
// 수정/삭제/순서변경: 기존 핸들러 재사용 (id 기반)
```

### 6. 일정 폼 -- 하위 카테고리 선택 (`schedule-form.tsx`)

#### UX 흐름

**초기 상태:**
```
카테고리: [없음] [개인] [사업] [약속] [건강] [공부]
```

**"개인" 클릭 (하위 있을 때):**
```
카테고리: [개인 v]                    <- 선택된 상위만 표시
         [운동] [독서] [취미]          <- 하위 목록
```

**"운동" 클릭 (선택):**
```
카테고리: [개인 v]
         [운동 (선택됨)] [독서] [취미]
```

**"운동" 다시 클릭 (해제):**
```
카테고리: [개인 v]
         [운동] [독서] [취미]
```

**"개인" 다시 클릭 (접기):**
```
카테고리: [없음] [개인 (선택됨)] [사업] [약속] [건강] [공부]
```

**하위 없는 "사업" 클릭: 기존과 동일하게 즉시 선택**

#### 구현 디테일

**상태 추가:**
```typescript
const [subcategory, setSubcategory] = useState(schedule?.subcategory ?? '');
const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
```

**헬퍼:**
```typescript
const parentCategories = categories.filter(c => c.parent_id === null);
const getChildren = (parentName: string) => {
  const parent = categories.find(c => c.name === parentName && c.parent_id === null);
  return parent ? categories.filter(c => c.parent_id === parent.id) : [];
};
```

**클릭 핸들러:**
```typescript
const handleCategoryClick = (catName: string) => {
  const children = getChildren(catName);
  if (expandedCategory === catName) {
    // 펼쳐진 상위 다시 클릭 -> 접기
    setExpandedCategory(null);
    return;
  }
  if (children.length > 0) {
    // 하위 있는 상위 클릭 -> 펼치기
    setCategory(catName);
    setSubcategory('');
    setExpandedCategory(catName);
  } else {
    // 하위 없는 상위 -> 즉시 선택
    setCategory(catName);
    setSubcategory('');
    setExpandedCategory(null);
  }
};

const handleSubcategoryClick = (subName: string) => {
  setSubcategory(subName === subcategory ? '' : subName);
};
```

**렌더링:**
- `expandedCategory` 있으면: 선택된 상위 버튼 1개 + 하위 버튼 목록
- `expandedCategory` 없으면: 없음 + 전체 상위 버튼 (기존과 동일)

**onSubmit에 subcategory 포함:**
```typescript
await onSubmit({ ...기존필드, subcategory: subcategory || null });
```

**편집 모드 초기화:**
```typescript
// schedule에 subcategory가 있으면 해당 상위를 펼친 상태로 시작
// useState 초기값으로 처리
const [expandedCategory, setExpandedCategory] = useState<string | null>(
  schedule?.subcategory && schedule?.category ? schedule.category : null
);
```

### 7. 스케줄 카드 -- 하위 카테고리 태그 (`schedule-card.tsx`)

**Before (line 104):**
```tsx
{schedule.category && <CategoryBadge colorKey={colorKey} label={schedule.category} />}
```

**After:**
```tsx
{schedule.category && <CategoryBadge colorKey={colorKey} label={schedule.category} />}
{schedule.subcategory && (() => {
  const sub = categories.find(c => c.name === schedule.subcategory && c.parent_id !== null);
  const subColor = sub?.color ?? 'gray';
  return <CategoryBadge colorKey={subColor} label={schedule.subcategory} />;
})()}
```

### 8. 필터 바 -- 상위만 표시 (`filter-bar.tsx`)

**Before (line 56):**
```tsx
{categories.map((cat) => {
```

**After:**
```tsx
{categories.filter(c => c.parent_id === null).map((cat) => {
```

### 9. 변경하지 않는 파일들

- `src/agents/life/blocks.ts` -- Slack 카테고리 그룹핑은 `schedules.category`만 사용. 변경 불필요.
- `src/shared/life-queries.ts` -- Slack 쿼리에서 subcategory SELECT 안 함. 변경 불필요.
- `src/shared/sql-tools.ts` -- `get_schema`가 DB에서 동적으로 읽으므로 변경 불필요.
- `web/src/features/schedule/hooks/use-schedules.ts` -- 필터링은 `s.category` 기준. 변경 불필요.

## 커밋 계획

1. `feat(db): 하위 카테고리 마이그레이션 추가` - 026_subcategories.sql
2. `feat(web): 카테고리/일정 타입 및 쿼리에 하위 카테고리 반영` - types.ts, queries.ts, API routes
3. `feat(web): 카테고리 관리 페이지에 하위 카테고리 UI 추가` - categories/page.tsx
4. `feat(web): 일정 폼 하위 카테고리 선택 UX` - schedule-form.tsx
5. `feat(web): 스케줄 카드 하위 카테고리 태그 + 필터 상위만 표시` - schedule-card.tsx, filter-bar.tsx

## 테스트 계획

- [ ] 마이그레이션 실행 후 기존 카테고리 정상 동작 확인
- [ ] 상위 카테고리 CRUD 기존 동작 유지
- [ ] 하위 카테고리 생성/수정/삭제/순서변경 정상 동작
- [ ] 같은 상위 안에서 중복 이름 방지 (409 응답)
- [ ] 다른 상위의 하위에서 같은 이름 허용
- [ ] 상위 카테고리 삭제 시 하위 자동 삭제 (CASCADE)
- [ ] 일정 폼: 하위 있는 상위 클릭 -> 하위 목록 펼침
- [ ] 일정 폼: 상위 다시 클릭 -> 접기 -> 상위 리스트 복귀
- [ ] 일정 폼: 하위 선택/해제 토글 동작
- [ ] 일정 폼: 하위 없는 상위는 기존처럼 즉시 선택
- [ ] 일정 카드: 하위 카테고리 태그 표시
- [ ] 필터 바: 상위 카테고리만 표시
- [ ] Slack 일정 메시지: 상위 카테고리만 표시 (기존 유지)

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수 (kebab-case 파일명, camelCase 변수, named export)
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (any 금지)
- [ ] SQL 파라미터 바인딩 사용
- [ ] API 인증 검증 유지 (requireAuth)
