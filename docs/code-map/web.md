# 웹 코드

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

`web/src/` 아래 소스 파일 208개, 22006줄이고 테스트 파일은 60개다. 줄 수는 테스트를 뺀 값이다.
역할 칸에는 파일 맨 위 주석의 첫 문장을 옮겼고, 주석이 없는 파일은 비워 뒀다. export 칸의 function에는 화살표 함수로 선언한 const도 들어간다.
API 라우트의 URL과 인증은 `web-api.md`에 따로 정리했다.

## 페이지

`page.tsx` 파일 19개의 URL이다. 대괄호로 감싼 부분은 동적 경로다.

| URL | 파일 |
| --- | --- |
| `/` | `web/src/app/page.tsx` |
| `/backlog` | `web/src/app/backlog/page.tsx` |
| `/budget` | `web/src/app/budget/page.tsx` |
| `/budget/analysis` | `web/src/app/budget/analysis/page.tsx` |
| `/budget/manage` | `web/src/app/budget/manage/page.tsx` |
| `/budget/settings` | `web/src/app/budget/settings/page.tsx` |
| `/categories` | `web/src/app/categories/page.tsx` |
| `/life` | `web/src/app/life/page.tsx` |
| `/life/routine` | `web/src/app/life/routine/page.tsx` |
| `/life/routine/checklist` | `web/src/app/life/routine/checklist/page.tsx` |
| `/life/routine/manage` | `web/src/app/life/routine/manage/page.tsx` |
| `/life/routine/stats` | `web/src/app/life/routine/stats/page.tsx` |
| `/life/sleep` | `web/src/app/life/sleep/page.tsx` |
| `/login` | `web/src/app/login/page.tsx` |
| `/routines` | `web/src/app/routines/page.tsx` |
| `/schedules` | `web/src/app/schedules/page.tsx` |
| `/schedules/backlog` | `web/src/app/schedules/backlog/page.tsx` |
| `/schedules/calendar` | `web/src/app/schedules/calendar/page.tsx` |
| `/schedules/categories` | `web/src/app/schedules/categories/page.tsx` |

## `web/src`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `proxy.ts` | 78 |  | function: `proxy`<br>const: `config` |

테스트 파일 1개

## `web/src/app`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `layout.tsx` | 27 |  | function: `default RootLayout`<br>const: `metadata`, `viewport` |
| `manifest.ts` | 16 |  | function: `default manifest` |
| `page.tsx` | 5 |  | function: `default Home` |

그 밖의 파일: `globals.css`

## `web/src/app/api`

테스트 파일 1개

## `web/src/app/api/auth`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 28 |  | function: `GET`, `DELETE` |

## `web/src/app/api/auth/kakao`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 23 |  | function: `GET` |

## `web/src/app/api/auth/kakao/callback`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 55 |  | function: `GET` |

테스트 파일 1개

## `web/src/app/api/budget/assets`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 16 |  | function: `GET` |

## `web/src/app/api/budget/assets/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 90 |  | function: `PATCH` |

테스트 파일 1개

## `web/src/app/api/budget/category-limits`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 54 |  | function: `GET`, `POST`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/budget/category-limits/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 47 |  | function: `PATCH`, `DELETE` |

## `web/src/app/api/budget/daily-logs`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 24 |  | function: `GET`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/budget/fixed-costs`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 34 |  | function: `GET`, `POST` |

테스트 파일 1개

## `web/src/app/api/budget/fixed-costs/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 46 |  | function: `PATCH`, `DELETE` |

테스트 파일 1개

## `web/src/app/api/budget/monthly`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 18 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/budget/planned-expenses`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 99 |  | function: `GET`, `POST`, `PATCH`, `DELETE`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/budget/runway`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 18 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/budget/settings`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 57 |  | function: `GET`, `PUT`<br>const: `dynamic` |

## `web/src/app/api/budget/today`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 18 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/categories`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 87 |  | function: `GET`, `POST`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/categories/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 89 |  | function: `PATCH`, `DELETE` |

테스트 파일 1개

## `web/src/app/api/categories/reorder`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 31 |  | function: `POST` |

## `web/src/app/api/cron/daily-budget-log`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 43 |  | function: `GET`<br>const: `dynamic`, `maxDuration` |

테스트 파일 1개

## `web/src/app/api/cron/monthly-settlement`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 42 |  | function: `GET`<br>const: `dynamic`, `maxDuration` |

테스트 파일 1개

## `web/src/app/api/expenses`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 151 |  | function: `GET`, `POST` |

테스트 파일 1개

## `web/src/app/api/expenses/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 69 |  | function: `PATCH`, `DELETE` |

테스트 파일 1개

## `web/src/app/api/expenses/summary`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 27 |  | function: `GET` |

## `web/src/app/api/health`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 10 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/routines`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 84 |  | function: `GET`, `POST`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/routines/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 116 |  | function: `PATCH`, `DELETE` |

테스트 파일 1개

## `web/src/app/api/routines/[id]/heatmap`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 37 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/routines/[id]/inactive-periods`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 59 |  | function: `GET`, `POST`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/routines/[id]/inactive-periods/[periodId]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 51 |  | function: `PATCH`, `DELETE` |

## `web/src/app/api/routines/[id]/records`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 29 |  | function: `DELETE` |

## `web/src/app/api/routines/records`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 66 |  | function: `GET`, `POST`<br>const: `dynamic` |

## `web/src/app/api/routines/records/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 57 |  | function: `PATCH`, `DELETE` |

테스트 파일 1개

## `web/src/app/api/routines/stats`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 40 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/schedules`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 99 |  | function: `GET`, `POST`<br>const: `dynamic` |

## `web/src/app/api/schedules/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 135 |  | function: `GET`, `PATCH`, `DELETE`<br>const: `dynamic` |

테스트 파일 1개

## `web/src/app/api/sleep/dashboard`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 37 |  | function: `GET`<br>const: `dynamic` |

## `web/src/app/api/sleep/events`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 22 |  | function: `POST` |

## `web/src/app/api/sleep/events/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 22 |  | function: `DELETE` |

## `web/src/app/api/sleep/records`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 22 |  | function: `POST` |

## `web/src/app/api/sleep/records/[id]`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `route.ts` | 45 |  | function: `PATCH`, `DELETE` |

## `web/src/app/backlog`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 5 |  | function: `default BacklogPage` |

## `web/src/app/budget`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `layout.tsx` | 21 |  | function: `default BudgetLayout` |
| `page.tsx` | 5 |  | function: `default Page` |

## `web/src/app/budget/analysis`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 11 |  | function: `default AnalysisPage` |

## `web/src/app/budget/manage`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 136 |  | function: `default ManagePage` |

## `web/src/app/budget/settings`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 11 |  | function: `default SettingsPage` |

## `web/src/app/categories`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 5 |  | function: `default CategoriesPage` |

## `web/src/app/life`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `layout.tsx` | 20 |  | function: `default LifeLayout` |
| `page.tsx` | 5 |  | function: `default Page` |

## `web/src/app/life/routine`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `layout.tsx` | 20 |  | function: `default RoutineLayout` |
| `page.tsx` | 5 |  | function: `default Page` |

## `web/src/app/life/routine/checklist`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 172 |  | function: `default ChecklistPage` |

## `web/src/app/life/routine/manage`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 78 |  | function: `default ManagePage` |

## `web/src/app/life/routine/stats`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 30 |  | function: `default StatsPage` |

## `web/src/app/life/sleep`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 143 |  | function: `default SleepPage` |

## `web/src/app/login`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 55 |  | function: `default LoginPage` |

## `web/src/app/routines`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 5 |  | function: `default RoutinesPageRoute` |

## `web/src/app/schedules`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `layout.tsx` | 21 |  | function: `default SchedulesLayout` |
| `page.tsx` | 5 |  | function: `default Page` |

## `web/src/app/schedules/backlog`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 7 |  | function: `default BacklogPage` |

## `web/src/app/schedules/calendar`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 288 |  | function: `default CalendarPage` |

## `web/src/app/schedules/categories`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `page.tsx` | 7 |  | function: `default CategoriesPage` |

## `web/src/components/ui`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `app-shell.tsx` | 157 |  | function: `AppShell` |
| `bottom-sheet.tsx` | 52 |  | function: `BottomSheet` |
| `button.tsx` | 37 |  | const: `Button` |
| `color-picker.tsx` | 253 |  | function: `ColorPicker` |
| `filter-bar.tsx` | 133 |  | function: `FilterBar` |
| `icons.tsx` | 193 | SVG 아이콘 컴포넌트 모음. | function: `CalendarIcon`, `WalletIcon`, `ArrowRightStartOnRectangleIcon`, `PlusIcon`, `TrashIcon`, `PencilIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `ChevronDownIcon`, `FunnelIcon`, `XMarkIcon`, `BanknotesIcon`, `ArrowTrendingDownIcon`, `ClockIcon`, `CheckCircleIcon`, `Bars3Icon`, `SunIcon` |
| `input.tsx` | 39 |  | const: `Input`, `Select` |
| `modal.tsx` | 82 |  | function: `Modal` |
| `skeleton.tsx` | 37 |  | function: `Skeleton`, `TabsSkeleton`, `CardSkeleton`, `ListSkeleton` |
| `tabs.tsx` | 92 |  | function: `LinkTopTabs`, `LinkPillTabs`, `PillTabs` |

## `web/src/features/budget/components`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `asset-item.tsx` | 150 |  | function: `AssetItem` |
| `budget-settings-page.tsx` | 267 |  | function: `BudgetSettingsPage` |
| `category-chart.tsx` | 108 |  | function: `CategoryChart` |
| `category-limit-add-form.tsx` | 89 |  | function: `CategoryLimitAddForm` |
| `category-limit-item.tsx` | 96 |  | function: `CategoryLimitItem` |
| `category-limit-tracker.tsx` | 94 |  | function: `CategoryLimitTracker` |
| `daily-budget-log.tsx` | 156 |  | function: `DailyBudgetLogView` |
| `expense-edit-modal.tsx` | 280 |  | function: `ExpenseEditModal` |
| `expense-form.tsx` | 408 |  | function: `ExpenseForm` |
| `expense-list.tsx` | 275 |  | function: `ExpenseList`<br>type: `TypeFilter` |
| `fixed-cost-add-form.tsx` | 139 |  | function: `FixedCostAddForm` |
| `fixed-cost-item.tsx` | 154 |  | function: `FixedCostItem` |
| `income-edit-modal.tsx` | 181 |  | function: `IncomeEditModal` |
| `month-navigator.tsx` | 59 |  | function: `MonthNavigator` |
| `month-summary.tsx` | 294 |  | function: `MonthSummaryCard` |
| `planned-expense-edit-modal.tsx` | 198 |  | function: `PlannedExpenseEditModal` |
| `planned-expense-list.tsx` | 222 |  | function: `PlannedExpenseList` |
| `runway-card.tsx` | 243 |  | function: `RunwayCard` |
| `target-date-card.tsx` | 196 |  | function: `TargetDateCard` |

## `web/src/features/budget/hooks`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `use-budget.ts` | 304 |  | function: `useBudget` |

## `web/src/features/budget/lib`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `facade-allocation.ts` | 81 |  | function: `formatKSTDate`, `computeFundsBaseline`, `getMonthlyAllocation`<br>type: `FundsBaseline` |
| `facade-settlement.ts` | 156 |  | function: `listUnsettledMonths`, `runSettlementIfDue` |
| `facade.ts` | 222 |  | function: `getTodayAllocation`, `getRunwayProjection`, `getBudgetPreview`<br>const: `getMonthlyAllocation`<br>type: `MonthProjection`, `TodayAllocationResult`, `RunwayProjectionResponse`, `BudgetPreviewResponse`<br>re-export: `listUnsettledMonths`, `runSettlementIfDue` |
| `fixed-cost-ensure.ts` | 73 |  | function: `queryFixedCosts`, `ensureFixedCostExpenses` |
| `queries.ts` | 14 |  | const: `queryFixedCosts`, `ensureFixedCostExpenses`<br>re-export: `* from ./queries/expenses`, `* from ./queries/month-summary`, `* from ./queries/fixed-costs`, `* from ./queries/assets`, `* from ./queries/planned`, `* from ./queries/daily-log` |
| `types-v2.ts` | 101 | ─── 빌링 ────────────────────────────────────────────────────── | type: `BillingCycle`, `PlannedInput`, `MonthAllocatorInput`, `MonthlyBudget`, `MonthAllocatorResult`, `DayAllocatorInput`, `DayAllocatorResult`, `SettlementInput`, `SettlementSnapshot` |
| `types.ts` | 199 |  | const: `BUDGET_EXCLUDED_CATEGORIES`, `MIN_DAILY_BUDGET`, `EXPENSE_CATEGORIES`, `INCOME_CATEGORIES`, `FIXED_COST_CATEGORIES`, `ALL_EXPENSE_CATEGORIES`, `VALID_CATEGORIES`<br>type: `ExpenseRow`, `PlannedExpenseRow`, `FixedCostRow`, `BudgetRow`, `AssetRow`, `CategoryStat`, `CategoryLimitRow`, `CategoryLimitWithUsage`, `MonthSummary`, `DailyBudgetLog`, `MonthProjection`, `ExpenseCategory`, `IncomeCategory` |
| `validate-input.ts` | 263 |  | function: `isPositiveInteger`, `isNonNegativeInteger`, `parseIdParam`, `parseInstallmentMonths`, `validateExpenseFields`, `parseFixedCostCreate`, `parseFixedCostUpdate`, `validatePlannedMemo`, `isValidTargetCount`, `isValidLimitCategory`<br>const: `MIN_INSTALLMENT_MONTHS`, `MAX_INSTALLMENT_MONTHS`<br>type: `ParseResult`, `FixedCostCreateInput`, `FixedCostUpdateInput` |

테스트 파일 7개

## `web/src/features/budget/lib/allocator`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `day-allocator.ts` | 34 |  | function: `allocateTodayBudget` |
| `month-allocator.ts` | 104 |  | function: `allocateMonthlyBudgets` |
| `runway-projection.ts` | 138 |  | function: `projectRunway`, `projectFromAllocator`<br>type: `ProjectionPlannedInput`, `RunwayProjectionInput`, `MonthProjection`, `RunwayProjectionResult` |
| `runway-warn.ts` | 26 |  | function: `calcRunwayShorten`<br>type: `RunwayShortenInput` |

테스트 파일 6개

## `web/src/features/budget/lib/billing`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `card-billing.ts` | 59 |  | function: `getBillingMonthForExpense`, `computeLastInstallmentBillingMonth`<br>const: `CARD_BILLING_CYCLES` |
| `cycle-config.ts` | 12 |  | const: `CYCLE_START_DAY`, `CYCLE_END_DAY` |
| `cycle.ts` | 60 |  | function: `getCurrentBillingMonth`, `getBillingRange`, `calcCycleDays`, `addBillingMonths`, `getBillingCycle`, `isLastDayOfCycle` |
| `fixed-cost-date.ts` | 31 |  | function: `resolveFixedCostExpenseDate` |
| `payment-methods.ts` | 46 |  | function: `getWithdrawalTiming`, `isKnownPaymentMethod`<br>const: `PAYMENT_METHODS`, `PAYMENT_METHOD_OPTIONS`, `DEFAULT_PAYMENT_METHOD`, `IMMEDIATE_PAYMENT_METHODS`<br>type: `WithdrawalTiming`, `PaymentMethodSpec` |
| `snapshot-date.ts` | 16 |  | function: `resolvePreviousDayDate` |

테스트 파일 5개

## `web/src/features/budget/lib/queries`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `assets.ts` | 86 |  | function: `queryAssets`, `updateAsset`, `setDefaultAsset`, `clearDefaultAsset` |
| `daily-log.ts` | 79 |  | function: `saveDailyBudgetLog`, `queryDailyBudgetLogs`<br>type: `DailyBudgetLog`, `DailyBudgetLogSummary` |
| `expenses.ts` | 276 |  | function: `queryExpenses`, `queryExpensesByBillingMonth`, `queryExpense`, `createExpense`, `createInstallmentExpenses`, `updateExpense`, `deleteExpense`<br>const: `FIXED_SOURCE_EXCLUDE_LOCKED` |
| `fixed-costs.ts` | 75 |  | function: `updateFixedCost`, `createFixedCost`, `deleteFixedCost` |
| `month-summary.ts` | 105 |  | function: `queryMonthSummary` |
| `planned.ts` | 82 |  | function: `queryPlannedExpenses`, `isPlannedExpenseOwned`, `createPlannedExpense`, `updatePlannedExpense`, `deletePlannedExpense` |

## `web/src/features/budget/lib/repository`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `assets-repo.ts` | 127 |  | function: `readDistributableAssetBalance`, `readFundsAsOf`, `advanceFundsAsOf`, `getDefaultAssetId`, `applyAssetDeduction`, `applyAssetIncrease`<br>type: `AssetMutation` |
| `category-limits-repo.ts` | 77 |  | function: `readCategoryLimitsWithUsage`, `readCategoryLimits`, `createCategoryLimit`, `updateCategoryLimit`, `deleteCategoryLimit` |
| `expenses-repo.ts` | 201 |  | function: `readFlexibleSpent`, `readTotalCycleSpent`, `readExcludedSpent`, `readReflectedBudgetOutflow`, `readReflectedOutflow`, `readTodayFlexSpent`, `readPlannedOverflow`, `readAvgVariableMonthly` |
| `fixed-costs-repo.ts` | 11 |  | function: `readFixedCostsMonthlyTotal` |
| `incomes-repo.ts` | 50 |  | function: `readIncomeTotal`, `readReflectedIncome`, `readCurrentMonthOnlyIncome` |
| `installments-repo.ts` | 28 |  | function: `readInstallmentLockByMonth` |
| `planned-repo.ts` | 17 |  | function: `readPlannedExpenses` |
| `settings-repo.ts` | 22 |  | function: `readTargetMonth`, `upsertTargetDate` |

테스트 파일 5개

## `web/src/features/budget/lib/settlement`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `settle.ts` | 27 |  | function: `buildSettlementSnapshot` |

테스트 파일 1개

## `web/src/features/budget/lib/snapshot`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `monthly-snapshot-repo.ts` | 53 |  | function: `readLatestSnapshot`, `readSnapshotByMonth`, `saveSnapshotIfAbsent`<br>type: `StoredSnapshot` |

## `web/src/features/routine/components`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `date-nav.tsx` | 43 |  | function: `DateNav` |
| `free-record-modal.tsx` | 239 |  | function: `FreeRecordModal` |
| `free-routine-section.tsx` | 65 |  | function: `isActiveFreeRoutine`, `FreeRoutineSection` |
| `inactive-period-list.tsx` | 163 |  | function: `InactivePeriodList` |
| `monthly-heatmap.tsx` | 112 |  | function: `MonthlyHeatmap` |
| `routine-card.tsx` | 87 |  | function: `RoutineCard` |
| `routine-checklist.tsx` | 122 |  | function: `RoutineChecklist` |
| `routine-form.tsx` | 211 |  | function: `RoutineForm` |
| `routine-heatmap.tsx` | 199 |  | function: `RoutineHeatmap` |
| `routine-list.tsx` | 83 |  | function: `RoutineList` |
| `routine-record-detail.tsx` | 71 |  | function: `RoutineRecordDetail` |
| `routine-stats.tsx` | 248 |  | function: `RoutineStats` |
| `yearly-heatmap.tsx` | 141 |  | function: `YearlyHeatmap` |

## `web/src/features/routine/hooks`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `use-routines.ts` | 254 |  | function: `useRoutines`<br>type: `RoutineView` |

## `web/src/features/routine/lib`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `queries.ts` | 598 |  | function: `queryRoutineTemplates`, `createRoutineTemplate`, `updateRoutineTemplate`, `queryRoutineTemplate`, `deleteRecordsBefore`, `countCompletedRecordsBefore`, `deleteRoutineTemplate`, `queryRoutineRecords`, `createFreeRecord`, `deleteFreeRecord`, `deleteIncompleteScheduledRecordOn`, `toggleRoutineRecord`, `updateRoutineRecordMemo`, `shouldCreateToday`, `ensureTodayRecords`, `queryRoutineStats`, `queryRoutinePerStats`, `queryInactivePeriods`, `createInactivePeriod`, `updateInactivePeriod`, `deleteInactivePeriod`, `closeOpenInactivePeriod`, `queryRoutineHeatmap`, `backfillRecords` |
| `types.ts` | 108 |  | function: `parseIntervalDays`, `isValidFrequency`<br>const: `TRACKING_MODES`, `ROUTINE_FREQUENCIES`, `ROUTINE_TIME_SLOTS`<br>type: `RoutineTrackingMode`, `RoutineEntryType`, `RoutineTemplateRow`, `RoutineRecordRow`, `RoutineDayStat`, `RoutinePerStat`, `RoutineInactivePeriod`, `RoutineHeatmapDay`, `RoutineHeatmapData` |

테스트 파일 1개

## `web/src/features/schedule/components`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `action-menu.tsx` | 131 |  | function: `ActionMenu` |
| `backlog-panel.tsx` | 186 |  | function: `BacklogPanel` |
| `calendar-header.tsx` | 96 |  | function: `CalendarHeader`<br>type: `CalendarView` |
| `categories-panel.tsx` | 457 |  | function: `CategoriesPanel` |
| `category-badge.tsx` | 15 |  | function: `CategoryBadge` |
| `category-panel-parts.tsx` | 59 |  | function: `CategoryBadge`, `TypeBadge`, `TypeSelector` |
| `day-detail-panel.tsx` | 69 |  | function: `DayDetailPanel` |
| `day-view.tsx` | 174 |  | function: `DayView` |
| `delete-reason-modal.tsx` | 103 |  | function: `DeleteReasonModal` |
| `dnd-calendar.tsx` | 142 |  | function: `DndCalendar` |
| `draggable-card.tsx` | 126 |  | function: `DraggableCard` |
| `droppable-day.tsx` | 24 |  | function: `DroppableDay` |
| `month-view.tsx` | 273 |  | function: `MonthView` |
| `move-toast.tsx` | 56 |  | function: `MoveToast` |
| `saju-pillar-label.tsx` | 44 |  | function: `SajuPillarLabel` |
| `schedule-card.tsx` | 156 |  | function: `ScheduleCard` |
| `schedule-form.tsx` | 366 |  | function: `ScheduleForm` |
| `sortable-category-item.tsx` | 136 |  | function: `SortableCategoryItem` |
| `status-badge.tsx` | 23 |  | function: `StatusBadge` |
| `status-bg.ts` | 6 |  | const: `STATUS_BG` |
| `subcategory-panel.tsx` | 145 |  | function: `SubcategoryPanel` |
| `week-span-bar.tsx` | 198 |  | function: `WeekSpanBar` |
| `week-view.tsx` | 271 |  | function: `WeekView` |

## `web/src/features/schedule/hooks`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `use-backlog.ts` | 149 |  | function: `useBacklog` |
| `use-calendar-navigation.ts` | 126 | 캘린더 보기 방식과 기준 날짜, 선택한 날짜를 관리하고 조회할 날짜 범위를 계산한다. | function: `getInitialView`, `getCalendarRange`, `useCalendarNavigation` |
| `use-schedule-filters.ts` | 97 | 캘린더의 카테고리·상태 필터 선택을 관리하고 필터를 적용한 일정 목록을 돌려준다. | function: `useScheduleFilters` |
| `use-schedule-moves.ts` | 129 | 일정 날짜 이동과 되돌리기, 그 결과를 알리는 토스트를 관리한다. | function: `useScheduleMoves`<br>type: `MoveToastState` |
| `use-schedules.ts` | 195 | 캘린더 화면의 일정 조회·폴링과 생성·수정·삭제를 맡고, 날짜 이동·필터·내비게이션 훅을 묶어 돌려준다. | function: `useSchedules` |
| `use-undo-shortcut.ts` | 39 |  | function: `isUndoShortcut`, `useUndoShortcut` |

테스트 파일 2개

## `web/src/features/schedule/lib`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `calendar-utils.ts` | 108 |  | function: `computeWeekLayout`<br>const: `WEEK_START`<br>type: `WeekSpan`, `WeekLayout` |
| `date-move.ts` | 75 |  | function: `isSameRange`, `computeDragResult`, `formatRangeLabel`<br>const: `UNDO_LIMIT`<br>type: `DragType`, `DateRange`, `MoveEntry` |
| `delete-reasons.ts` | 21 |  | function: `isDeleteReasonCategory`<br>const: `DELETE_REASONS`<br>type: `DeleteReasonCategory`, `DeleteReason` |
| `queries.ts` | 285 |  | function: `querySchedulesByRange`, `queryBacklogSchedules`, `queryScheduleById`, `createSchedule`, `updateSchedule`, `deleteSchedule`, `recordDeleteReason`, `queryCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `reorderCategories`, `validateCategoryOwnership` |
| `types.ts` | 129 |  | function: `isValidStatus`, `compareByStatus`, `isMultiDaySchedule`, `lookupCategory`, `getScheduleType`, `getScheduleTopCategoryName`, `compareSchedulePriority`<br>const: `SCHEDULE_STATUSES`, `STATUS_LABELS`, `NEXT_STATUS`<br>type: `ScheduleRow`, `ScheduleStatus` |

테스트 파일 4개

## `web/src/features/sleep/components`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `nap-timeline.tsx` | 208 |  | function: `NapTimeline` |
| `period-selector.tsx` | 34 |  | function: `PeriodSelector` |
| `sleep-day-pattern.tsx` | 100 |  | function: `SleepDayPattern` |
| `sleep-record-form.tsx` | 383 |  | function: `SleepRecordForm`<br>type: `SleepFormMutations` |
| `sleep-score-card.tsx` | 128 |  | function: `SleepScoreCard` |
| `sleep-summary-cards.tsx` | 124 |  | function: `scoreColor`, `InfoButton`, `SleepSummaryCards` |
| `sleep-timeline.tsx` | 361 |  | function: `SleepTimeline` |
| `sleep-trend-chart.tsx` | 395 |  | function: `SleepTrendChart` |

## `web/src/features/sleep/hooks`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `use-chart-tooltip.ts` | 27 |  | function: `useChartTooltip` |
| `use-sleep-dashboard.ts` | 140 |  | function: `useSleepDashboard` |

## `web/src/features/sleep/lib`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `chart-utils.ts` | 28 | 요일 한글 약자 (일\~토) | function: `formatDateLabel`, `getDayOfWeek`, `formatDuration` |
| `queries.ts` | 420 |  | function: `querySleepRecordsWithEvents`, `timeToMinutesFromMidnight`, `buildDailySleeps`, `calculateSleepSummary`, `calculateDayOfWeekPattern`, `computeDurationMinutes`, `createSleepRecord`, `updateSleepRecord`, `deleteSleepRecord`, `createSleepEvent`, `deleteSleepEvent` |
| `save-day.ts` | 84 |  | function: `saveSleepDay`<br>type: `SleepDayMutations`, `SleepDayDraft` |
| `scores.ts` | 100 |  | function: `calculateSleepScores`<br>re-export: `SleepScores` |
| `sleep-score-config.ts` | 8 |  | const: `SLEEP_SCORE_CONFIG` |
| `types.ts` | 133 |  | const: `SLEEP_TAGS`<br>type: `SleepTag`, `SleepRecord`, `SleepEvent`, `SleepRecordWithEvents`, `DayOfWeekPattern`, `DailySleep`, `SleepScores`, `SleepSummary`, `SleepDashboardData`, `SleepPeriod`, `SleepRecordInput`, `SleepEventInput` |
| `validate-input.ts` | 93 |  | function: `parseSleepRecordInput`, `parseSleepEventInput`<br>type: `ParseResult` |

테스트 파일 5개

## `web/src/lib`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `auth.ts` | 40 |  | function: `getSession`, `requireAuth`<br>type: `SessionData` |
| `db.ts` | 48 |  | function: `query`, `queryOne`<br>type: `QueryResult` |
| `kakao.ts` | 98 | 카카오 OAuth 설정 + 유틸리티 | function: `getKakaoAuthUrl`, `exchangeCodeForToken`, `fetchKakaoUserInfo`<br>const: `MAX_USERS`<br>type: `KakaoUserInfo` |
| `kst.ts` | 49 | KST (UTC+9) 날짜 유틸리티. | function: `getTodayISO`, `formatDateShort`, `getDayName`, `addDays`<br>const: `DAY_NAMES` |
| `parse-error.ts` | 9 |  | function: `parseError` |
| `saju.ts` | 110 | 사주 일주 계산 (web용 복제본). | function: `getDayPillar`<br>type: `Cheongan`, `Jiji`, `Pillar` |
| `send-json.ts` | 12 |  | function: `sendJson` |
| `slack.ts` | 83 | Slack Web API 클라이언트 — 웹에서 알림용 메시지 전송 | function: `postSlackMessage`, `notifyNewSignup` |
| `types.ts` | 79 | ─── 카테고리 (공통) ───────────────────────────────── | function: `hexToStyles`, `getCategoryStyle`, `colorToHex`, `formatAmount`<br>const: `CATEGORY_TYPES`, `VALID_CATEGORY_TYPES`, `PRESET_COLORS`<br>type: `CategoryType`, `CategoryRow` |
| `users.ts` | 84 |  | function: `findUserByKakaoId`, `listAllUserIds`, `getUserCount`, `findOrCreateUser`<br>type: `UserRow` |
| `validation.ts` | 58 |  | function: `validateStringLength`, `parseRouteId`, `isPositiveId`, `isISODate`, `validateFields`<br>const: `MAX_LENGTHS` |

테스트 파일 4개
