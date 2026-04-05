# refactor(web): 루틴 통계 탭 레이아웃 개선 + 루틴별 달성률 추가

## 이슈
- 번호: #155
- 브랜치: refactor/155-routine-stats-redesign

## 개요
통계 탭의 섹션 순서를 재배치하고, 체크리스트 탭의 1년 히트맵을 통계로 이동하며, 월간 히트맵을 컴팩트하게 개선하고, 루틴별 달성률 수평 바차트를 추가한다.

## 변경 파일 목록
| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `web/src/lib/types.ts` | 수정 | RoutinePerStat 타입 추가 |
| `web/src/features/routine/lib/queries.ts` | 수정 | 루틴별 통계 쿼리 함수 추가 |
| `web/src/app/api/routines/stats/route.ts` | 수정 | per-routine 통계 응답 추가 |
| `web/src/lib/cache.ts` | 수정 | 루틴별 통계 캐시 함수 추가 |
| `web/src/features/routine/hooks/use-routines.ts` | 수정 | perRoutineStats 상태 + fetch 추가 |
| `web/src/features/routine/components/routine-stats.tsx` | 수정 | 섹션 순서 변경 + YearlyHeatmap/PerRoutineChart 추가 |
| `web/src/features/routine/components/routine-page.tsx` | 수정 | 체크리스트 탭에서 YearlyHeatmap 제거 |
| `web/src/features/routine/components/monthly-heatmap.tsx` | 수정 | 셀 축소 + 날짜 숫자 제거 |

## 구현 상세

### 1. 타입 추가 (`web/src/lib/types.ts`)

**After:** RoutineDayStat 아래에 추가
```typescript
/** 루틴별 달성률 통계 */
export interface RoutinePerStat {
  template_id: number;
  name: string;
  total: number;
  completed: number;
  rate: number; // 0~100
}
```

### 2. 루틴별 통계 쿼리 추가 (`queries.ts`)

**After:** queryRoutineStats 함수 아래에 추가
```typescript
/** 기간별 루틴별 달성률 */
export async function queryRoutinePerStats(
  userId: number,
  from: string,
  to: string,
): Promise<RoutinePerStat[]> {
  const { rows } = await query<RoutinePerStat>(
    `SELECT r.template_id,
            t.name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.completed)::int AS completed,
            CASE WHEN COUNT(*) > 0
              THEN ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric / COUNT(*) * 100)::int
              ELSE 0
            END AS rate
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.user_id = $1 AND r.date BETWEEN $2 AND $3
     GROUP BY r.template_id, t.name
     ORDER BY rate DESC, t.name`,
    [userId, from, to],
  );
  return rows;
}
```

### 3. API 응답에 perRoutine 추가 (`api/routines/stats/route.ts`)

기존 stats API에 `?type=per-routine` 쿼리 파라미터 지원 추가.

**Before:**
```typescript
const data = await getCachedRoutineStats(userId, from, to);
return NextResponse.json({ data });
```

**After:**
```typescript
const type = searchParams.get('type');

if (type === 'per-routine') {
  const data = await getCachedRoutinePerStats(userId, from, to);
  return NextResponse.json({ data });
} else {
  const data = await getCachedRoutineStats(userId, from, to);
  return NextResponse.json({ data });
}
```

### 4. 캐시 함수 추가 (`web/src/lib/cache.ts`)

기존 `getCachedRoutineStats` 옆에 추가:
```typescript
export const getCachedRoutinePerStats = unstable_cache(
  queryRoutinePerStats,
  ['routine-per-stats'],
  { revalidate: 60, tags: ['routine-stats'] },
);
```

**참고**: cache.ts의 기존 패턴을 확인하고 동일한 방식으로 추가.

### 5. Hook에 perRoutineStats 추가 (`use-routines.ts`)

**추가할 상태:**
```typescript
const [perRoutineStats, setPerRoutineStats] = useState<RoutinePerStat[]>([]);
```

**추가할 fetch 함수:**
```typescript
const fetchPerRoutineStats = useCallback(async (from: string, to: string) => {
  const res = await fetch(`/api/routines/stats?from=${from}&to=${to}&type=per-routine`);
  if (res.ok) {
    const { data } = (await res.json()) as { data: RoutinePerStat[] };
    setPerRoutineStats(data);
  }
}, []);
```

**return에 추가:** `perRoutineStats`, `fetchPerRoutineStats`

### 6. 통계 탭 섹션 순서 변경 + 새 섹션 (`routine-stats.tsx`)

**Before (현재 순서):**
```typescript
<WeeklyChart stats={stats} from={weekStart} to={today} />
<MonthlyHeatmap stats={stats} selectedDate={selectedDate} />
<PeriodSelector fetchStats={fetchStats} stats={stats} />
```

**After (새 순서):**
```typescript
<PeriodSelector fetchStats={fetchStats} fetchPerRoutineStats={fetchPerRoutineStats} stats={stats} />
<YearlyHeatmap stats={yearlyStats} />
<WeeklyChart stats={stats} from={weekStart} to={today} />
<MonthlyHeatmap stats={stats} selectedDate={selectedDate} />
<PerRoutineChart stats={perRoutineStats} />
```

**Props 변경:**
- `RoutineStatsProps`에 `yearlyStats: RoutineDayStat[]`, `perRoutineStats: RoutinePerStat[]`, `fetchPerRoutineStats` 추가
- PeriodSelector가 fetchPerRoutineStats도 호출하도록 변경 (조회 버튼 시 함께 fetch)

**PeriodSelector 변경:** 조회 시 fetchPerRoutineStats도 함께 호출
```typescript
const handleSearch = async () => {
  await Promise.all([fetchStats(from, to), fetchPerRoutineStats(from, to)]);
  setQueried(true);
};
```

**초기 로드에서도 perRoutineStats를 함께 fetch:**
useEffect에서 fetchStats와 함께 fetchPerRoutineStats도 호출.

**새 컴포넌트 — PerRoutineChart (routine-stats.tsx 내부):**
```typescript
function PerRoutineChart({ stats }: { stats: RoutinePerStat[] }) {
  if (stats.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">루틴별 달성률</h3>
      <div className="space-y-3">
        {stats.map((s) => (
          <div key={s.template_id} className="flex items-center gap-3">
            <span className="w-20 shrink-0 truncate text-sm text-gray-700">{s.name}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all"
                style={{
                  width: `${s.rate}%`,
                  backgroundColor: s.rate >= 70 ? '#22c55e' : s.rate >= 30 ? '#fbbf24' : '#f87171',
                }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-sm font-medium text-gray-600">
              {s.rate}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 7. 체크리스트 탭에서 YearlyHeatmap 제거 (`routine-page.tsx`)

**Before:**
```typescript
{view === 'checklist' && (
  <div className="space-y-5">
    <YearlyHeatmap stats={yearlyStats} />
    <DateNav ... />
    <RoutineChecklist ... />
  </div>
)}
```

**After:**
```typescript
{view === 'checklist' && (
  <div className="space-y-5">
    <DateNav ... />
    <RoutineChecklist ... />
  </div>
)}
```

YearlyHeatmap import는 유지 (routine-stats.tsx에서 사용하므로 routine-page.tsx에서는 제거 가능).

### 8. 월간 히트맵 컴팩트화 (`monthly-heatmap.tsx`)

날짜 숫자를 제거하고 셀 크기를 축소하여 깃허브 잔디 스타일로 변경.

**Before (셀 렌더링):**
```typescript
<div
  className="flex aspect-square items-center justify-center rounded text-xs"
  style={{ backgroundColor: heatColor(rate) }}
  title={...}
>
  <span className={...}>{day}</span>
</div>
```

**After (컴팩트 셀):**
```typescript
<div
  className="h-4 w-4 rounded-sm"
  style={{ backgroundColor: heatColor(rate) }}
  title={...}
/>
```

**추가 변경:**
- gap을 `gap-1`에서 `gap-[2px]`로 축소
- 빈 셀도 동일하게 `h-4 w-4`로 통일
- 요일 헤더: 현행 유지 (일\~토) — 숫자가 없으면 요일은 있어야 날짜 파악 가능
- `aspect-square` 제거하고 고정 크기(`h-4 w-4`)로 변경

## 커밋 계획
1. `feat(web): 루틴별 달성률 통계 API 추가` — types.ts, queries.ts, route.ts, cache.ts
2. `refactor(web): 루틴 통계 탭 레이아웃 재배치 + 루틴별 바차트 추가` — use-routines.ts, routine-stats.tsx, routine-page.tsx
3. `style(web): 월간 히트맵 컴팩트화 — 날짜 제거, 셀 축소` — monthly-heatmap.tsx

## 테스트 계획
- [ ] 통계 탭에서 기간별 조회가 최상단에 표시되는지 확인
- [ ] 1년 히트맵이 통계 탭에 올바르게 표시되는지 확인
- [ ] 체크리스트 탭에서 히트맵이 제거되었는지 확인
- [ ] 월간 히트맵이 컴팩트하게 렌더링되는지 확인
- [ ] 루틴별 달성률이 기간 조회 결과와 연동되는지 확인
- [ ] 모바일/데스크탑 반응형 확인

## 체크리스트
- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (RoutinePerStat)
- [ ] API 인증 검증 (requireAuth 유지)
- [ ] SQL 파라미터 바인딩 사용
