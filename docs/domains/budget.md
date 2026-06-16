# 지출/예산 관리 (Budget)

> **상태**: v2 아키텍처 운영 중. 모델 단순화 (#539, ADR 0051) 반영.

## 모델 단순화 (#539, ADR 0051)

묶인 돈(할부) 반영이 4경로(등록시점 차감 / 건별 토글 / 현재월 락 / exclude 정산-전용)로 분산돼, 자산 수기 갱신이 등록시점 차감을 덮어쓰면 자유·일 예산이 과대 계상되던 것을 **목표 기간 창 기준 일괄 reservation 1경로**로 수렴했다.

### 자금 단일화
- 비상금을 제외한 자산을 단일 **자금** 필드로 통합 (마이그레이션 092).
- 입력 의미 = **현금 유동자금** (통장 잔액 − 지난 결제 대금) 하나. 미래 할부를 사용자가 직접 빼서 넣지 않는다.
- 비상금(`is_emergency=true`)은 예산 분배 밖 '최후의 보루'로 분리 보존.

### 묶인 돈 = 목표 기간 창 일괄 (reservation)
- 창 = `[현재 결제월, target_date]`. 창 안의 [할부 회차 + 고정비 + 예정 지출]이 묶인 돈.
- 할부 락은 `billing_month`별 합으로 조회(`readInstallmentLockByMonth`) — 건별 토글·`exclude_from_budget` 무관, 할부면 전부.
- 창 밖(target 이후) 회차는 조회되지 않아 예산에서 자동 제외 ("그 이후는 별도 처리" 전제).
- **할부 1회차도 묶인 돈** — 현재월 락에 귀속되어 현재 주기 자유 예산을 깎되, `flexibleSpent`에서 제외돼 "오늘 예산"엔 안 몰린다.

### reservation vs depletion 분리
- **reservation** = 미래 의무를 자유 예산에서 미리 빼두는 **라이브 계산**(자금값 불변). allocator의 월별 락.
- **depletion** = 실제 결제 시 자금이 줄어드는 것. 결제주기 정산 1곳에서 **그 주기 전체 결제분**(`readTotalCycleSpent`)을 차감하고, 장부(`available_at_end`)도 같은 기준으로 연쇄.
- 한 할부 회차는 "결제 전 reservation → 결제(주기 종료) 후 depletion + 창 이탈"의 생애를 가지며 이중 카운트되지 않는다.
- 사용자 입력이 자동값과 충돌하면 **사용자 수기 보정이 승** — reservation을 자금값에 의존하지 않게(라이브 계산) 설계해 충돌해도 안 깨진다.

### 제거된 것
- 건별 토글 `distribute_to_runway`(데드 컬럼으로 보존, 드롭 안 함), 할부 `exclude` 토글
- 할부 등록 시점 자산 차감, `target_date` 변경 시 자산 보정·영향 분석 모달
- ADR [0015](../adr/0015-asset-auto-deduction-policy.md)·[0018](../adr/0018-installment-runway-scope-toggle.md)을 ADR 0051이 supersede

### 변경 파일 요약
- 락 조회 `installments-repo.ts`(`readInstallmentLockByMonth`), 정산 `expenses-repo.ts`(`readTotalCycleSpent`)
- allocator `month-allocator.ts`·`runway-projection.ts`(락 맵 입력), `facade.ts`(주입·정산)
- 제거 `queries.ts`(등록시점 차감), `settings-repo.ts`(보정 4함수), API `?preview` 분기, UI 토글/모달
- 마이그레이션 `092_consolidate_funds_asset.sql` — 적용 후 자금 값 1회 재입력(수기 보정)

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

### 가용자금 (Total Available) = 자금
- 비상금 제외 자산의 `available_amount` 합계 = 단일 **자금**(현금 유동자금, #539)
- 결제주기 종료 cron이 이전 사이클의 **전체 결제분**(`readTotalCycleSpent`)을 자금에서 자동 차감하고 수입을 증액 (depletion 일원화). 자잘한 차이는 사용자가 수기로 보정(사용자 입력 승)
- 할부 회차는 등록 시점에 차감하지 않는다 — 묶인 돈으로 라이브 계산(reservation)되다가 결제되는 주기의 정산에서 한 번만 차감(depletion)
- 구현: [facade.ts `runSettlementIfDue`](../../web/src/features/budget/lib/facade.ts), [assets-repo.ts](../../web/src/features/budget/lib/repository/assets-repo.ts)
- 판단 근거: [ADR 0051](../adr/0051-budget-model-simplification-runway-locked.md) (ADR 0015·0018 supersede)

### 자유 예산 (Free Budget)
- 월 자유 예산 = 월 가용자금 − (월 고정비 + **그 달 묶인 돈** + 예정 지출)
- 묶인 돈 = 목표 기간 창 안 그 `billing_month`의 할부 락(`readInstallmentLockByMonth`). 현재월/미래월 동일 규칙
- 목표 기간이 설정되면 남은 모든 월에 **일수 비례로 균등** 분배
- 현재 월은 결제주기 잔여일 기준으로 `allocatedDays` 비례 축소

### 일일 예산 (Daily Budget) — 이중 모델

ADR 0008 도입 후 일 예산은 두 값으로 분리된다:

- **기준 일 예산 (`todayBudget`)**: `round((monthBudget − currentMonthIncome) / cycleTotalDays)`. 사이클 시작 시점의 약속, 사이클 동안 사실상 불변. UI에선 회색 보조 텍스트로 노출.
- **오늘 예산 (`todayRecommended`)**: `max(0, round((monthBudgetRemaining + todayFlexSpent) / daysFromToday))`. 매일 갱신되는 동적 권장값. 잔여 음수 시 0으로 클램프되어 회복 모드 진입 신호. UI 메인 표시.
- **오늘 남음 (`todayRemaining`)**: `todayRecommended − todayFlexSpent`. 음수 가능 (UI에서 초과 표시).
- **산식은 #539 이후에도 불변** — 입력만 바뀌었다. `flexibleSpent`/`todayFlexSpent`가 할부를 전부 제외(1회차 포함)하므로, 할부 1회차가 "오늘 예산"에 몰리지 않고 현재월 묶인 돈으로만 작용한다.
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
| `exclude_from_budget` | expenses | 지출을 자유 예산 계산에서 제외 (일반 지출만 — 할부는 항상 묶인 돈이라 무관, #539) |
| `distribute_to_budget` | expenses | 수입을 목표 기간 전체에 분배 |
| ~~`distribute_to_runway`~~ | expenses | **데드 컬럼** (#539, ADR 0051). 건별 토글 폐지 — 더 이상 읽지 않으며 드롭하지 않고 보존 |
| `is_emergency` | assets | 비상금을 가용자금에서 제외 (예산 분배 밖 '최후의 보루') |
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
  distribute_to_runway BOOLEAN DEFAULT true,  -- #539: 데드 컬럼(건별 토글 폐지). 드롭하지 않고 보존
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
-- #539: 비상금 제외 자산은 단일 '자금'(현금 유동자금)으로 통합 (마이그 092). balance=available_amount로 저장.
assets:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,                           -- 비상금 제외 default 자산 = '자금'
  type TEXT,
  balance INTEGER,
  available_amount INTEGER,            -- 자금: 가용자금 합산 기준 (is_emergency=false)
  is_emergency BOOLEAN,
  is_default BOOLEAN,                  -- user당 1개. 자동 차감/증액 우선순위 (마이그 046)
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
| 7 | 예산 설정 (목표 기간) | budget-settings-page | `/api/budget/settings` | settings-repo.ts | `target_date` 단순 저장 + 만료/임박 경고 배너 (#539). 변경 시 자산 보정 없음 |
| 8 | 월 예산 배분 | month-summary | `/api/budget/monthly` | month-allocator.ts | 일수 비례 균등 분배 |
| 9 | 일 예산 배분 | month-summary 오늘 예산 | `/api/budget/today` | day-allocator.ts | 초과 클램프 |
| 10 | 장기 예산 시뮬레이션 | runway-card | `/api/budget/runway` | runway-projection.ts | 월별 burn 시뮬 |
| 11 | 일별 예산 로그 | daily-budget-log | `/api/budget/daily-logs` + cron | `saveDailyBudgetLog` | UNIQUE(user, date) |
| 12 | 월별 예산 스냅샷 | — (내부) | 정산 cron 진입점 | `buildSettlementSnapshot` | 14일 종료 → 15일 새벽 cron, idempotent |
| 13 | 결제주기 유틸 | — | — | billing/cycle.ts, billing/card-billing.ts | 전월 15일\~당월 14일, 카드별 startDay |
| 14 | 내역 type 필터 (수입/지출 세그먼트) | [expense-list.tsx](../../web/src/features/budget/components/expense-list.tsx) 세그먼트 + [manage/page.tsx](../../web/src/app/budget/manage/page.tsx) 상태 | — (클라이언트 필터) | `expense-list.tsx` 의 `filtered` (type AND 카테고리), `categoryPool` type별 분기 | 세그먼트(전체/지출/수입). type 변경 시 카테고리 자동 해제. 일별 합계는 `type === 'income'` 기준 차감으로 변경 (환불 특수처리 제거 — 환불은 migration 032에 의해 income으로 저장됨) |

> **#539로 은퇴**: "할부 자산 차감 범위 토글"(`distribute_to_runway`)·"할부 exclude 그룹 동기화"는 폐지. 묶인 돈을 목표 기간 창 일괄 reservation으로 단순화하면서 건별 토글·등록시점 차감·그룹 자산 보정이 모두 사라졌다.

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
| B | ~~할부 `isNew` 경계 판정~~ | **#539로 해소** — 묶인 돈을 `billing_month`별 락으로 일괄 처리하면서 `isNew` 특례(1회차 자유지출 귀속)가 사라짐 |
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
  → readFlexibleSpent/Excluded/Income/TotalCycleSpent (범위: 정산 대상 월)
  → available_at_end = available_at_start + income − totalSpent (전체 결제분, depletion 일원화)
  → buildSettlementSnapshot() 로 monthly_budget_snapshots 저장 (idempotent)
     · snapshot 분해 필드(flexible_spent/excluded_spent)는 별도 기록
  → applyAssetDeduction(totalSpent) + applyAssetIncrease(income) — 자산 자동 반영
  → 다음 월의 available_at_start 로 연쇄
```

### 일별 예산 로그 저장 (매일 자정 cron)
```
/api/cron/daily-budget-log
  → getTodayAllocation() (정산된 시각 기준)
  → saveDailyBudgetLog() (UNIQUE(user, date))
  → daily-budget-log 컴포넌트가 차트로 렌더
```

### 묶인 돈 reservation → depletion (#539, ADR 0051)
```
[INSERT] expense-form 할부 옵션
  → POST /api/expenses { installment_months }
  → createInstallmentExpenses: 회차별 INSERT만 (그룹 UUID, billing_month 귀속, 끝전 보정)
     · 등록 시점 자산 차감 없음 — 건별 토글·target 조회 없음

[월 예산 조회 = reservation] getMonthlyAllocation
  → readInstallmentLockByMonth(userId, 현재월, target) → Map<billing_month, 합>
  → allocateMonthlyBudgets: 각 월 installments = 락맵.get(month) ?? 0 (현재월/미래월 동일)
  → 창 밖(target 이후) 회차는 락맵에 없어 자동 제외. 라이브 계산이라 자금값 불변

[결제 = depletion] 결제주기 정산 cron
  → readTotalCycleSpent(정산월) = 그 billing_month 전체 결제분(할부 회차 포함)
  → applyAssetDeduction(totalSpent) — 회차가 결제될 때 자금에서 한 번만 차감(창 이탈)

[target_date 변경] budget-settings-page
  → PUT /api/budget/settings { target_date } → upsertTargetDate (단순 저장)
  → 자산 보정·영향 분석 없음. 창이 바뀌면 다음 조회에서 락맵이 자동 반영
```

## 주요 계산 규칙

### 묶인 돈 = 목표 기간 창 일괄 (reservation/depletion 분리, #539)
- 묶인 돈 = `[현재 결제월, target_date]` 창 안 [할부 회차 + 고정비 + 예정]. 할부 락은 `billing_month`별 합
- reservation(월별 락)은 자금값을 안 건드리는 라이브 계산. depletion(자금 차감)은 정산 1곳에서 전체 결제분
- 한 할부 회차: 결제 전 reservation → 결제 후 depletion + 창 이탈. 이중 카운트 없음
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
- `assets.is_emergency=true` → `readDistributableAssetBalance` 에서 제외 (예산 분배 밖 '최후의 보루')
- `expenses.exclude_from_budget=true` → 자유 예산 계산 대상 아님 (별도 `excluded_spent`로 집계). 할부는 `is_installment` 필터로 이미 flex에서 빠지므로 exclude와 무관 (#539)
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
- [ ] 목표 기간 만료/임박 경고 UI 디테일 (현재 배너만 — 자동 연장 없이 수동 연장 정책, #539)
- [ ] 개요 홈(장기 시뮬레이션 + 오늘 예산 + 자산) 대시보드
- [ ] `/budget/analysis` 페이지 콘텐츠 확인/보강

## 비공개 참고

> **Claude 필수 행동**: 지출/예산 기능 작업 시 `docs/_personal/budget-internal.md` (gitignored)를 반드시 읽을 것.
> 실제 기능 의도, 공개 표현 치환표, 런웨이 계산 상세 로직이 기록되어 있다.
> 이 문서에는 포트폴리오용 기능 설명만 기록하며, 개인 재정 데이터는 포함하지 않는다.

## 주요 PR

- #292 (v2 전환), #293 (정합성 수정), #295 (projectFromAllocator 도입), #411 (할부 자산 차감 범위 토글 + 세금 카테고리), #539 (모델 단순화 — 자금 단일화 + 묶인 돈 목표기간 창 일괄, ADR 0051)
