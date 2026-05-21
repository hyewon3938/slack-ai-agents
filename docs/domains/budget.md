# 지출/예산 관리 (Budget)

> **상태**: v2 아키텍처 운영 중 (Phase 5 완료).

## 목적

- 월 결제주기 단위로 가용자금을 분배해 **자유 예산**을 계산한다
- 고정비 / 할부 / 예정 지출을 차감한 뒤 남는 예산을 남은 일수로 나눠 **일일 예산**을 제시한다
- 목표 기간까지 월별 장기 예산 시뮬레이션을 제공한다
- 매일/매월 스냅샷으로 과거 예산 상태를 불변 기록한다

## 핵심 개념

### 결제주기 (Billing Cycle)
- 1개 결제월 = **전월 15일 \~ 당월 14일**
- 예: `2026-04` → `2026-03-15 \~ 2026-04-14`
- 모든 예산/정산/고정비 계산의 기준 단위
- 구현: [billing/cycle.ts](../../web/src/features/budget/lib/billing/cycle.ts)

### 가용자금 (Total Available)
- `assets.available_amount` 합계 (`is_emergency=false`)
- 결제주기 종료 cron이 이전 사이클의 자유+제외 지출을 default 자산에서 자동 차감하고 수입을 default 자산에 증액 — 자산 테이블이 곧 가용자금이 되도록 유지
- 할부 2+회차는 INSERT 즉시 자산에서 차감 (allocator의 monthBudget 락에서는 제외해 수학적 동등). 단, `distribute_to_runway=false`면 target_date 이후 회차는 자산 무영향 — 결제주기 cron에서 자유지출로 정산
- 구현: [facade.ts `runSettlementIfDue`](../../web/src/features/budget/lib/facade.ts), [assets-repo.ts](../../web/src/features/budget/lib/repository/assets-repo.ts)
- 판단 근거: [ADR 0015](../adr/0015-asset-auto-deduction-policy.md) — 즉시 차감 default 정책 / [ADR 0018](../adr/0018-installment-runway-scope-toggle.md) — 사용자 명시 OFF 분기

### 자유 예산 (Free Budget)
- 월 자유 예산 = 월 가용자금 − (월 고정비 + 할부 월분 + 예정 지출)
- 목표 기간이 설정되면 남은 모든 월에 **일수 비례로 균등** 분배
- 현재 월은 결제주기 잔여일 기준으로 `allocatedDays` 비례 축소

### 일일 예산 (Daily Budget) — 이중 모델

ADR 0008 도입 후 일 예산은 두 값으로 분리된다:

- **기준 일 예산 (`todayBudget`)**: `round((monthBudget − currentMonthIncome) / cycleTotalDays)`. 사이클 시작 시점의 약속, 사이클 동안 사실상 불변. UI에선 회색 보조 텍스트로 노출.
- **오늘 예산 (`todayRecommended`)**: `max(0, round((monthBudgetRemaining + todayFlexSpent) / daysFromToday))`. 매일 갱신되는 동적 권장값. 잔여 음수 시 0으로 클램프되어 회복 모드 진입 신호. UI 메인 표시.
- **오늘 남음 (`todayRemaining`)**: `todayRecommended − todayFlexSpent`. 음수 가능 (UI에서 초과 표시).
- 일별 예산 로그(`daily_budget_logs.budget`)는 `todayBudget`(기준 일 예산)을 저장 — 약속된 기준선 대비 평가가 누적 분석(세이브 합계, 일평균, 런웨이 환산)에 정합 (ADR 0009).
- 구현: [day-allocator.ts](../../web/src/features/budget/lib/allocator/day-allocator.ts), 판단 근거: [ADR 0008](../adr/0008-daily-budget-base-vs-recommended.md), [ADR 0009](../adr/0009-daily-log-baseline-anchor.md)

### 수입 처리의 두 축 ⚠️

| 옵션 | `distribute_to_budget` | 반영 경로 | 상태 |
|------|----------------------|----------|------|
| 이번 달 | `false` (기본) | 정산 시 월 스냅샷에만 기록 | ⚠️ 예산 계산에 미반영 |
| 전체 분배 | `true` | 가용자금에 합산 → 목표 기간 전체 균등 분배 | ✅ 완전 구현 |

> **의도 확인 필요**: UI 레이블 "이번 달"은 현재 달에만 반영되어야 할 것 같지만, 실제 구현에서는 `false`일 때 예산 계산 어느 경로에도 반영되지 않는다. "이번 달" 옵션의 실제 의도(= 현재 달 가용자금만 증가) 구현이 필요하다.

### 제외 플래그 모음

| 필드 | 테이블 | 용도 |
|------|--------|------|
| `exclude_from_budget` | expenses | 지출을 자유 예산 계산에서 제외 |
| `distribute_to_budget` | expenses | 수입을 목표 기간 전체에 분배 |
| `distribute_to_runway` | expenses | 할부 미래 회차를 INSERT 즉시 자산 차감(true, default) vs target_date 이내만 차감(false). ADR 0018 |
| `is_emergency` | assets | 비상금을 가용자금에서 제외 |
| `is_variable` | fixed_costs | 변동 고정비 표시 |

## DB 스키마

```sql
-- 지출 기록
expenses:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  amount INTEGER,
  category TEXT,
  description TEXT,
  payment_method TEXT,
  is_installment BOOLEAN,
  installment_num INTEGER,
  installment_total INTEGER,
  installment_group TEXT,
  source TEXT,
  memo TEXT,
  type TEXT DEFAULT 'expense',         -- 'expense' | 'income'
  planned_expense_id INTEGER FK,
  exclude_from_budget BOOLEAN,
  distribute_to_budget BOOLEAN,
  distribute_to_runway BOOLEAN DEFAULT true,  -- ADR 0018: false면 target_date 이후 할부 회차는 자산 무영향
  billing_month VARCHAR(7),            -- 카드별 결제주기 귀속 (전월 15일~당월 14일)
  created_at TIMESTAMPTZ

-- 고정비 템플릿
fixed_costs:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  amount INTEGER,
  category TEXT,
  is_variable BOOLEAN,
  day_of_month INTEGER,
  active BOOLEAN,
  memo TEXT,
  created_at TIMESTAMPTZ

-- 자산
assets:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  type TEXT,
  balance INTEGER,
  available_amount INTEGER,
  is_emergency BOOLEAN,
  memo TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ

-- 예산 설정 (목표 기간, 시작일)
budget_settings:
  id SERIAL PK,
  user_id INTEGER UNIQUE,
  target_date VARCHAR(7),              -- 'YYYY-MM'
  updated_at TIMESTAMPTZ

-- 예정 지출 (계획된 큰 지출)
planned_expenses:
  id SERIAL PK,
  user_id INTEGER,
  year_month VARCHAR(7),
  amount INTEGER,
  category TEXT,
  description TEXT,
  is_recurring BOOLEAN,
  created_at TIMESTAMPTZ

-- 일별 예산 로그 (cron 스냅샷)
daily_budget_logs:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  billing_month VARCHAR(7),
  budget INTEGER,
  spent INTEGER,
  saved INTEGER,
  created_at TIMESTAMPTZ,
  UNIQUE(user_id, date)

-- 월별 예산 스냅샷 (과거 월 정산)
monthly_budget_snapshots:
  id SERIAL PK,
  user_id INTEGER,
  year_month VARCHAR(7),
  allocated_budget INTEGER,
  fixed_total INTEGER,
  installment_total INTEGER,
  planned_total INTEGER,
  flexible_spent INTEGER,
  excluded_spent INTEGER,
  income_total INTEGER,
  available_at_start INTEGER,
  available_at_end INTEGER,
  sealed_at TIMESTAMPTZ,
  UNIQUE(user_id, year_month)
```

## 코드 구조

```
features/budget/
├── components/
│   ├── budget-tab.tsx              # 탭 진입점
│   ├── budget-overview.tsx         # 월 개요 (달력 + 요약)
│   ├── expense-list.tsx            # 지출 목록
│   ├── expense-form.tsx            # 지출 등록/수정 폼
│   ├── month-summary.tsx           # 월간 요약 카드
│   ├── runway-card.tsx             # 런웨이 시뮬레이션 카드
│   ├── budget-settings-page.tsx    # 예산 설정 탭
│   └── ...
├── hooks/
│   └── use-budget.ts               # 상태 관리 + CRUD
└── lib/
    ├── types.ts                    # 타입 정의
    ├── queries.ts                  # DB 쿼리 (지출 CRUD, 요약, 로그)
    ├── facade.ts                   # v2 통합 인터페이스
    ├── allocator/                  # 순수 계산 함수
    │   ├── day-allocator.ts        # 일일 예산 배분
    │   ├── month-allocator.ts      # 월별 예산 배분
    │   ├── runway-projection.ts    # 런웨이 시뮬레이션
    │   ├── runway-warn.ts          # 런웨이 단축 경고
    │   └── proration.ts            # 당월 잔여 일수 계산
    ├── billing/                    # 결제주기 유틸리티
    │   ├── cycle.ts                # 빌링 월/범위/일수 계산
    │   └── snapshot-date.ts        # cron 드리프트 보정
    └── repository/                 # DB 읽기/쓰기 레이어
        ├── expenses-repo.ts
        ├── assets-repo.ts
        ├── fixed-costs-repo.ts
        ├── planned-repo.ts
        └── settings-repo.ts
```

## 기능 구현 상태

### ✅ 완전 구현 (14)

| # | 기능 | UI | API | 계산/쿼리 | 비고 |
|---|------|----|----|---------|------|
| 1 | 지출 CRUD | [expense-form.tsx](../../web/src/features/budget/components/expense-form.tsx), expense-edit-modal | `/api/expenses` + `/[id]` | queries.ts | 카테고리/결제수단/메모. 세금 카테고리 포함(예산 제외 default) |
| 2 | 수입 기록 (전체 분배) | [expense-form.tsx:275](../../web/src/features/budget/components/expense-form.tsx#L275) | `/api/expenses` POST | incomes-repo.ts | `type='income'` + `distribute_to_budget=true` |
| 3 | 할부 처리 (2\~12개월) | expense-form 할부 옵션 | POST `installment_months` | createInstallmentExpenses | 그룹 UUID, 끝전 보정 |
| 4 | 예정 지출 | planned-expense-list | `/api/budget/planned-expenses` | planned-repo.ts | 지출 시 `planned_expense_id` 연결 |
| 5 | 고정비 템플릿 | 고정비 UI + 자동 기록 | `/api/budget/fixed-costs` | `ensureFixedCostExpenses` | 결제일 기준 자동 생성 |
| 6 | 자산 관리 | 자산 목록/수정 | `/api/budget/assets` + `/[id]` | assets-repo.ts | 비상금 분리 |
| 7 | 예산 설정 (목표 기간) | budget-settings-page | `/api/budget/settings` | settings-repo.ts | `target_date` 변경 시 OFF 할부 영향 분석 모달 (ADR 0018) |
| 8 | 월 예산 배분 | month-summary | `/api/budget/monthly` | month-allocator.ts | 일수 비례 균등 분배 |
| 9 | 일 예산 배분 | month-summary 오늘 예산 | `/api/budget/today` | day-allocator.ts | 초과 클램프 |
| 10 | 장기 예산 시뮬레이션 | runway-card | `/api/budget/runway` | runway-projection.ts | 월별 burn 시뮬 |
| 11 | 일별 예산 로그 | daily-budget-log | `/api/budget/daily-logs` + cron | `saveDailyBudgetLog` | UNIQUE(user, date) |
| 12 | 월별 예산 스냅샷 | — (내부) | 정산 cron 진입점 | `buildSettlementSnapshot` | 14일 종료 → 15일 새벽 cron, idempotent |
| 13 | 결제주기 유틸 | — | — | billing/cycle.ts, billing/card-billing.ts | 전월 15일\~당월 14일, 카드별 startDay |
| 14 | 할부 자산 차감 범위 토글 | expense-form / expense-edit-modal 조건부 라디오 | `/api/expenses` POST/PATCH + `/api/budget/settings` `?preview=true` | createInstallmentExpenses, updateExpense, settings-repo (analyzeTargetDateChange / applyTargetDateChange / computeInstallmentToggleAdjustment) | ADR 0018. 마지막 회차 > target_date 일 때만 노출. 그룹 단위 적용 |
| 15 | 할부 exclude_from_budget 그룹 동기화 | expense-edit-modal 예산 토글 + 할부 그룹 안내 | `/api/expenses/[id]` PATCH | updateExpense, settings-repo `computeExcludeToggleAdjustment` / `applyExcludeToggleAdjustment` | 할부 행 토글 시 같은 installment_group 전체 UPDATE + 자산 보정 (delta 계산) |

### 🟡 부분 구현 (4)

| # | 기능 | 구현된 부분 | 누락/미완 | 위치 |
|---|------|-----------|----------|------|
| 14 | 자유 예산 단축 경고 | 순수 계산 함수 완성 | UI 통합 (임계값, 시각화) | [runway-warn.ts](../../web/src/features/budget/lib/allocator/runway-warn.ts) |
| 15 | 3개월 평균 변동 지출 | 쿼리 + 런웨이 기본값으로 사용 | 독립 UI 노출 없음 | `readAvgVariableMonthly` |
| 16 | 예산 제외 플래그 자동화 | 카테고리 기반 자동 체크 | 수동/자동 일관성, 제외 카테고리 목록 명확화 | `expense-form.tsx` 카테고리 변경 훅 |
| 17 | 대시보드 뷰 구조 | `/budget/manage`, `/budget/settings` | `/budget/analysis` 페이지 콘텐츠 확인 필요, 개요 홈 없음 | features/budget/components |

### ⚠️ 의심 / 확인 필요 (3)

| # | 항목 | 설명 |
|---|------|------|
| A | 수입 "이번 달" 옵션 | `distribute_to_budget=false` 시 예산 계산에 미반영. UI 레이블과 동작 불일치 — 의도 확인 + 구현 필요 |
| B | 할부 `isNew` 경계 판정 | 빌링 시작일(당월 15일) 전후로 선택된 할부의 신규 여부 판정이 의도대로 동작하는지 경계 테스트 필요 |
| C | 고정비 자동 기록 강제 `exclude_from_budget=true` | [queries.ts `ensureFixedCostExpenses`](../../web/src/features/budget/lib/queries.ts)에서 강제. 사용자 정책 재검토 필요 |

## 데이터 흐름

### 수입 기록 → 일일 예산 반영
```
expense-form (type=income, distribute_to_budget=true)
  → POST /api/expenses
  → createExpense() INSERT
  → [다음 조회 시]
  → facade.computeTotalAvailable()
     └─ readDistributableIncomeTotal() 로 합산
  → allocateMonthlyBudgets() 가 목표 기간 전체에 분배
  → allocateTodayBudget() 가 이번 달 free/남은일수로 나눔
  → /api/budget/today 응답
```

### 지출 기록 → 오늘 남은 예산 반영
```
expense-form (type=expense)
  → POST /api/expenses
  → exclude_from_budget 자동 판정 + createExpense() INSERT
  → [다음 조회 시]
  → readFlexibleSpent() / readTodayFlexSpent() 증가
  → allocateTodayBudget() 의 todayRemaining 감소
```

### 월 경계 정산 (14일 종료 → 15일 새벽 cron)
```
detectSettlementTrigger() → 어제가 14일(주기 마지막)인지 판정
  → getMonthlyAllocation() 재실행
  → readFlexibleSpent/Excluded/Income (범위: 정산 대상 월)
  → buildSettlementSnapshot() 로 monthly_budget_snapshots 저장 (idempotent)
  → applyAssetDeduction(flex + excluded) + applyAssetIncrease(income) — 자산 자동 반영
  → 다음 월의 available_at_start 로 연쇄
```

### 일별 예산 로그 저장 (매일 자정 cron)
```
/api/cron/daily-budget-log
  → getTodayAllocation() (정산된 시각 기준)
  → saveDailyBudgetLog() (UNIQUE(user, date))
  → daily-budget-log 컴포넌트가 차트로 렌더
```

### 할부 자산 차감 범위 토글 (ADR 0018)
```
[INSERT] expense-form 할부 옵션 + (마지막 회차 billing_month > target_date 일 때만) 라디오
  → POST /api/expenses { installment_months, distribute_to_runway }
  → createInstallmentExpenses
     ├─ distribute_to_runway=true (default): 2~N회차 amount 합 = futureSum
     └─ distribute_to_runway=false: 2~N회차 중 billing_month ≤ target_date 만 futureSum
  → applyAssetDeduction(futureSum) — wasDeductedFromAssetAtInsert 기준 idempotent

[사후 토글] expense-edit-modal 라디오 변경
  → PATCH /api/expenses/[id] { distribute_to_runway }
  → updateExpense 토글 분기
     ├─ computeInstallmentToggleAdjustment(group, newValue): 그룹 미래 회차 중 billing_month > target_date 인 amount 합 = boundarySum
     │  ├─ true (OFF→ON): +boundarySum → applyAssetDeduction
     │  └─ false (ON→OFF): -boundarySum → applyAssetIncrease
     └─ UPDATE expenses SET distribute_to_runway WHERE installment_group = ? (그룹 전체 동기화)

[target_date 변경] budget-settings-page 목표 기간 변경 → 영향 분석 모달
  → PUT /api/budget/settings?preview=true { target_date }
  → analyzeTargetDateChange: OFF 할부의 미래 회차를 old/new boundary 로 비교, 그룹별 deltaAmount 산출
  → 모달에서 사용자가 확인 → PUT (preview 없이) → applyTargetDateChange
     ├─ totalDelta > 0: applyAssetDeduction
     ├─ totalDelta < 0: applyAssetIncrease
     └─ upsertTargetDate
```

### 할부 exclude_from_budget 토글 (ADR 0015 보강)
```
[모달에서 사용자가 "예산 미포함" 토글]
  → PATCH /api/expenses/[id] { exclude_from_budget }
    → updateExpense
       ├─ computeExcludeToggleAdjustment(그룹 미래 회차 자산 차감 delta)
       │   ├─ 현재 차감 합 = exclude=false AND (distribute_to_runway OR billing_month ≤ target_date)
       │   ├─ 변경 후 차감 합 = newValue=true ? 0 : (차감 대상 회차 전부)
       │   └─ delta = newDeducted - currentDeducted
       ├─ delta > 0: applyAssetDeduction
       ├─ delta < 0: applyAssetIncrease
       └─ UPDATE expenses SET exclude_from_budget WHERE installment_group = ? (그룹 전체 동기화)

비할부/그룹 없는 행은 단일 행 UPDATE만 — 결제주기 cron이 자유지출/제외지출로 처리.
```

## 주요 계산 규칙

### 결제주기 이월
- 할부 분할이 다음 결제월로 넘어가면 자동으로 다음 월 `installments`에 귀속
- `installment_group` UUID 로 원본 거래 추적

### 현재 월 allocatedDays
- 결제주기 잔여일 = `cycle.to - today + 1`
- 현재 월 자유 예산은 **잔여일 / 결제주기 총 일수** 비율로 축소
- 다음 달부터는 결제주기 전체 일수 사용

### 균등 분배 원칙
- `totalFree = totalAvailable − totalLocked`
- `dailyFree = totalFree / Σ(월별 allocatedDays)`
- 각 월의 `free = round(dailyFree × allocatedDays)`

### 비상금 / 제외 규칙
- `assets.is_emergency=true` → `readDistributableAssetBalance` 에서 제외
- `expenses.exclude_from_budget=true` → 자유 예산 계산 대상 아님 (별도 `excluded_spent`로 집계)
- 고정비 자동 기록은 현재 **항상** `exclude_from_budget=true`로 저장 (정책 재검토 대상)
- Vercel cron 드리프트 보정: 발화 시각에서 1시간 버퍼 차감 후 KST 날짜 결정

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET/POST | `/api/expenses` | 지출/수입 조회 · 등록 |
| PATCH/DELETE | `/api/expenses/[id]` | 지출 수정 / 삭제 |
| GET | `/api/expenses/summary` | 월간 요약 |
| GET | `/api/budget/today` | 오늘 예산 할당 |
| GET | `/api/budget/monthly` | 월 예산 할당 |
| GET | `/api/budget/runway` | 런웨이 프로젝션 (장기 시뮬레이션) |
| GET/PUT | `/api/budget/settings` | 목표 기간 조회/설정 |
| GET | `/api/budget/assets` | 자산 현황 |
| PATCH | `/api/budget/assets/[id]` | 자산 잔액 수정 |
| GET | `/api/budget/fixed-costs` | 고정비 목록 |
| GET | `/api/budget/daily-logs` | 일별 예산 로그 |
| GET/POST | `/api/budget/planned-expenses` | 예정 지출 목록 / 등록 |
| DELETE | `/api/budget/planned-expenses/[id]` | 예정 지출 삭제 |
| GET | `/api/cron/daily-budget-log` | 일별 스냅샷 cron (내부용) |

## 관련 Slack 에이전트

- **채널**: #money
- **에이전트**: money 에이전트 (SQL 도구 기반, 지출 기록 + 분석)

## 향후 개선 과제

- [ ] 수입 "이번 달" 옵션의 현재 달 반영 로직 설계/구현
- [ ] 자유 예산 단축 경고(runway-warn)의 UI 통합 — 임계값, 카드 표시
- [ ] 3개월 평균 변동 지출 대시보드 카드 추가
- [ ] 고정비 자동 기록 `exclude_from_budget` 기본값 재검토 (토글 제공 가능?)
- [ ] 할부 `isNew` 경계값 단위 테스트 보강
- [ ] 개요 홈(장기 시뮬레이션 + 오늘 예산 + 자산) 대시보드
- [ ] `/budget/analysis` 페이지 콘텐츠 확인/보강

## 비공개 참고

> **Claude 필수 행동**: 지출/예산 기능 작업 시 `docs/_personal/budget-internal.md` (gitignored)를 반드시 읽을 것.
> 실제 기능 의도, 공개 표현 치환표, 런웨이 계산 상세 로직이 기록되어 있다.
> 이 문서에는 포트폴리오용 기능 설명만 기록하며, 개인 재정 데이터는 포함하지 않는다.

## 주요 PR

- #292 (v2 전환), #293 (정합성 수정), #295 (projectFromAllocator 도입), #411 (할부 자산 차감 범위 토글 + 세금 카테고리)
