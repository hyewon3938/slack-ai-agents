# 0007. 자유지출 정의 통일 — directFlex + plannedOverflow

- Status: Accepted
- Date: 2026-05-06
- Related: #374
- Tags: data, budget

## Context

v2 예산 시스템에서 자유지출 정의가 코드 4곳에 분산되어 있었다.

- `repository/expenses-repo.ts` — `readFlexibleSpent`, `readTodayFlexSpent`
- `lib/queries.ts` — `queryMonthSummary` 인라인 SQL, `saveDailyBudgetLog` 인라인 SQL

그 중 예산 계산/정산 경로(`readFlexibleSpent`, `readTodayFlexSpent`)는 예정지출 연결 건(`planned_expense_id IS NOT NULL`)을 통째로 제외하는 반면, 월간 요약 카드 경로(`queryMonthSummary`)는 예정지출 예산 초과분만 별도로 가산하고 있었다.

결과:

- 같은 화면에서 "이번달 자유 지출"(요약 카드)과 "오늘/이번달 남은 예산"(allocator)이 어긋남
- 정산 스냅샷의 `flexible_spent` 가 초과분을 누락
- 일별 예산 로그(`daily_budget_logs.spent`) 도 옛 정의 사용

PR #371(자유지출과 사이클 락 정합화) / #373(고정비 자동 등록 누수 차단) 에서 자유지출 정의를 일부 정합화한 흐름의 후속이다.

## Decision

자유지출을 다음 단일 정의로 통일한다:

```
flexibleSpent(billingMonth, upToDate)
  = directFlex(billingMonth, upToDate) + plannedOverflow(billingMonth, upToDate)
```

- `directFlex`: 비할부 + 신규 할부 1회차, `planned_expense_id IS NULL`, `exclude_from_budget = false`
- `plannedOverflow(upToDate) = Σ_p max(0, used(p, upToDate) − p.amount)`
  - `used(p, upToDate)` = `expenses` 중 `e.planned_expense_id = p.id` AND `billing_month` 일치 AND `e.date <= upToDate` 의 합

일 단위 plannedOverflow 산식은 **누적 차이**를 사용한다:

```
dailyOverflow(today) = max(0, plannedOverflow(today) − plannedOverflow(yesterday))
```

모든 사용처는 `readFlexibleSpent` / `readTodayFlexSpent` 두 함수만 호출한다 (인라인 SQL 금지).

## Alternatives considered

### A. `planned_expense_id` 를 자유지출에 통째로 포함

- 장점: 산식 단순. `planned_expense_id` 필터 자체를 제거.
- 단점: 예정지출 락의 의미가 사라짐. 매월 N만원 예정지출을 잡아두는 의도가 무력화되어, 예정지출 풀 자체가 자유지출과 구분되지 않음.
- 기각 이유: 예정지출 기능 자체의 설계 목적과 충돌.

### B. 초과분 발생 시 사용자에게 묻고 수동으로 자산 차감

- 장점: 사용자 의사 명확히 반영.
- 단점: UX 부담. 이미 결제한 지출을 사후 분류하는 데 매번 확인 단계가 들어감. 자동화 가치 손실.
- 기각 이유: 라이프 데이터 봇의 자동 정산 기조와 어긋남.

### C. 일 단위 산식으로 `min(today_used, max(0, cum_overflow))` 사용

- 장점: 단일 SQL로 일별 오버플로우 산출 가능.
- 단점: 누적 차이 방식과 같은 결과를 산출하지만 SQL 표현이 더 복잡하고, `readPlannedOverflow` 함수를 그대로 재사용할 수 없어 별도 함수가 필요함.
- 기각 이유: 동일 결과인데 함수 재사용성이 더 낮음.

### D. 누적 차이 방식 (선택, Decision 섹션에 상세)

- 장점: `readPlannedOverflow` 단일 함수로 일/월 단위 모두 커버. 의미 명확. 환불·조정 케이스에서도 `Math.max(0, ...)` 한 줄로 안전.
- 단점: `readTodayFlexSpent` 호출당 SQL 3회로 증가 (직접 자유지출 1 + today overflow 1 + yesterday overflow 1). 인덱스 있으면 무시 가능 수준.

## Consequences

### 장점

- SSOT 1개 함수 (`readFlexibleSpent` / `readTodayFlexSpent`).
- 화면 요약 / 정산 스냅샷 / 일별 로그 자동 정합. 예정지출 예산 초과 시 그 초과분이 자유지출에 즉시 반영되어 월/일 남은 예산이 자동 갱신됨.
- 향후 자유지출 의미가 변경되어도 1개 함수만 수정하면 모든 사용처에 반영.

### 단점 / 제약

- `readTodayFlexSpent` 가 SQL 3회 호출 (기존 1회). `Promise.all` 로 병렬화했고 인덱스(`expenses(planned_expense_id, billing_month, date)`)가 있어 실측 영향은 무시 가능 수준이지만, 데이터 규모가 커지면 재검토 필요.
- 기존 `daily_budget_logs.spent` 와 `monthly_budget_snapshots.flexible_spent` 의 과거 값은 옛 정의로 저장되어 있다. 신규 데이터부터 새 정의가 적용되며, 과거 백필은 하지 않는다.

### 후속 작업

- [ ] 예정지출 미달분(언더플로우)을 자유 예산 풀에 환원할지 — 별도 ADR 대상.
- [ ] 정산 스냅샷 재계산 도구 필요 여부 검토 (과거 월에 대해 새 정의 적용한 값을 보고 싶은 경우).
