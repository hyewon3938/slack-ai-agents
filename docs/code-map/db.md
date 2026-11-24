# DB 테이블

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

마이그레이션 파일 111개를 파일 이름 순서로 적용해 계산한 결과이고 테이블은 49개, 뷰는 3개다. 운영 DB를 조회한 값은 아니다.
쓰는 파일에는 SQL 문자열에서 FROM, JOIN, INTO, UPDATE, TABLE 바로 뒤에 테이블 이름이 나오는 소스 파일을 적었고 테스트 파일은 뺐다.

## 테이블

### `assets`

- 만든 마이그레이션: `030_budget_expenses.sql`
- 바꾼 마이그레이션: `046_assets_is_default.sql`, `109_payment_method_withdrawal_timing.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: `web/src/features/budget/lib/queries/assets.ts`, `web/src/features/budget/lib/repository/assets-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `name` | `VARCHAR(100)` | O |  |  |
| `balance` | `INTEGER` | O |  |  |
| `type` | `VARCHAR(20)` | O |  |  |
| `available_amount` | `INTEGER` |  |  |  |
| `is_emergency` | `BOOLEAN` |  | `false` |  |
| `memo` | `TEXT` |  |  |  |
| `updated_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `is_default` | `BOOLEAN` | O | `false` |  |
| `balance_as_of` | `DATE` |  |  |  |

### `branch_relations`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 바꾼 마이그레이션: `082_relation_hwa_seeds.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-trigger-lookups.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `branch_a_id` | `INTEGER` | O |  |  |
| `branch_b_id` | `INTEGER` | O |  |  |
| `relation_type` | `TEXT` | O |  |  |

### `branches_master`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-trigger-lookups.ts`, `src/shared/pattern/match-trigger.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `name` | `TEXT` | O |  |  |
| `element` | `TEXT` | O |  |  |
| `yinyang` | `TEXT` | O |  |  |

### `budget_settings`

- 만든 마이그레이션: `031_budget_settings.sql`
- 봇에서 쓰는 파일: `src/cron/life/target-expiry.ts`
- 웹에서 쓰는 파일: `web/src/features/budget/lib/repository/settings-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `user_id` | `INTEGER` | O |  | O |
| `target_date` | `VARCHAR(7)` |  |  |  |
| `updated_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `categories`

- 만든 마이그레이션: `011_categories.sql`
- 바꾼 마이그레이션: `012_category_type.sql`, `016_multi_user.sql`, `026_subcategories.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/cron/weekly-report/aggregate-schedule.ts`, `src/shared/insights/schedule.ts`, `src/shared/life/context-sections.ts`, `src/shared/life/queries-schedule.ts`, `src/shared/pending-current-state.ts`
- 웹에서 쓰는 파일: `web/src/features/schedule/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `name` | `TEXT` | O |  |  |
| `color` | `TEXT` |  | `'gray'` |  |
| `sort_order` | `INTEGER` |  | `0` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `type` | `TEXT` |  | `'task'` |  |
| `user_id` | `INTEGER` |  |  |  |
| `parent_id` | `INTEGER` |  |  |  |

### `category_limits`

- 만든 마이그레이션: `047_category_limits.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: `web/src/features/budget/lib/repository/category-limits-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `category` | `TEXT` | O |  |  |
| `target_count` | `INTEGER` | O |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `updated_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `custom_instructions`

- 만든 마이그레이션: `004_custom_instructions.sql`
- 바꾼 마이그레이션: `006_smart_memory.sql`, `016_multi_user.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt.ts`, `src/shared/pending-current-state.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `instruction` | `TEXT` | O |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `category` | `TEXT` | O | `'기타'` |  |
| `source` | `TEXT` | O | `'user'` |  |
| `active` | `BOOLEAN` | O | `true` |  |
| `user_id` | `INTEGER` |  |  |  |

### `daily_budget_logs`

- 만든 마이그레이션: `037_daily_budget_logs.sql`
- 봇에서 쓰는 파일: `src/cron/life/budget-backfill.ts`
- 웹에서 쓰는 파일: `web/src/features/budget/lib/queries/daily-log.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O | `1` |  |
| `date` | `DATE` | O |  |  |
| `billing_month` | `VARCHAR(7)` | O |  |  |
| `budget` | `INTEGER` | O |  |  |
| `spent` | `INTEGER` | O |  |  |
| `saved` | `INTEGER` | O |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `daily_insight_log`

- 만든 마이그레이션: `076_daily_insight.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `date` | `DATE` | O |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `diary_entries`

- 만든 마이그레이션: `018_diary_tables.sql`
- 봇에서 쓰는 파일: `src/agents/insight/diary-edit-store.ts`, `src/agents/insight/diary-fast-path.ts`, `src/cron/diary-meta-extract.ts`, `src/cron/life/insight-night-task.ts`, `src/shared/life/context-sections.ts`, `src/shared/period/interpretation-stats.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `date` | `DATE` | O |  |  |
| `content` | `TEXT` | O |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `updated_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `diary_meta_tags`

- 만든 마이그레이션: `053_saju_match_infra.sql`
- 바꾼 마이그레이션: `059_diary_meta_tags_enum_expand.sql`, `102_diary_meta_tags_enum_expand_v2.sql`
- 봇에서 쓰는 파일: `src/agents/insight/diary-edit-store.ts`, `src/cron/diary-meta-extract.ts`, `src/shared/pattern/match-metric.ts`, `src/shared/pattern/series.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `date` | `DATE` | O |  |  |
| `tag` | `TEXT` | O |  |  |
| `source` | `TEXT` | O | `'llm'` |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `expenses`

- 만든 마이그레이션: `030_budget_expenses.sql`
- 바꾼 마이그레이션: `032_budget_overhaul.sql`, `033_planned_expense_link.sql`, `034_budget_check_constraints.sql`, `036_exclude_from_budget.sql`, `038_distribute_to_budget.sql`, `043_billing_month.sql`, `057_expenses_distribute_to_runway.sql`, `095_installment_exclude_normalize.sql`
- 봇에서 쓰는 파일: `src/cron/life/budget-backfill.ts`
- 웹에서 쓰는 파일: `web/src/features/budget/lib/fixed-cost-ensure.ts`, `web/src/features/budget/lib/queries/expenses.ts`, `web/src/features/budget/lib/queries/month-summary.ts`, `web/src/features/budget/lib/queries/planned.ts`, `web/src/features/budget/lib/repository/category-limits-repo.ts`, `web/src/features/budget/lib/repository/expenses-repo.ts`, `web/src/features/budget/lib/repository/incomes-repo.ts`, `web/src/features/budget/lib/repository/installments-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `date` | `DATE` | O |  |  |
| `amount` | `INTEGER` | O |  |  |
| `category` | `VARCHAR(50)` | O |  |  |
| `description` | `TEXT` |  |  |  |
| `payment_method` | `VARCHAR(30)` |  | `'카드'` |  |
| `is_installment` | `BOOLEAN` |  | `false` |  |
| `installment_num` | `INTEGER` |  |  |  |
| `installment_total` | `INTEGER` |  |  |  |
| `installment_group` | `VARCHAR(100)` |  |  |  |
| `source` | `VARCHAR(10)` |  | `'manual'` |  |
| `memo` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `type` | `VARCHAR(10)` |  | `'expense'` |  |
| `planned_expense_id` | `INTEGER` |  |  |  |
| `exclude_from_budget` | `BOOLEAN` | O | `false` |  |
| `distribute_to_budget` | `BOOLEAN` | O | `false` |  |
| `billing_month` | `VARCHAR(7)` |  |  |  |
| `distribute_to_runway` | `BOOLEAN` | O | `true` |  |

### `fixed_cost_records`

- 만든 마이그레이션: `030_budget_expenses.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `fixed_cost_id` | `INTEGER` | O |  |  |
| `user_id` | `INTEGER` | O |  |  |
| `year_month` | `VARCHAR(7)` | O |  |  |
| `actual_amount` | `INTEGER` | O |  |  |
| `memo` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `fixed_costs`

- 만든 마이그레이션: `030_budget_expenses.sql`
- 바꾼 마이그레이션: `034_budget_check_constraints.sql`, `109_payment_method_withdrawal_timing.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: `web/src/features/budget/lib/fixed-cost-ensure.ts`, `web/src/features/budget/lib/queries/fixed-costs.ts`, `web/src/features/budget/lib/repository/fixed-costs-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `name` | `VARCHAR(100)` | O |  |  |
| `amount` | `INTEGER` | O |  |  |
| `category` | `VARCHAR(50)` |  |  |  |
| `is_variable` | `BOOLEAN` |  | `false` |  |
| `day_of_month` | `INTEGER` |  |  |  |
| `active` | `BOOLEAN` |  | `true` |  |
| `memo` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `payment_method` | `TEXT` |  |  |  |

### `fortune_analyses`

- 만든 마이그레이션: `017_insight_tables.sql`
- 바꾼 마이그레이션: `020_fortune_period.sql`
- 봇에서 쓰는 파일: `src/agents/insight/fortune-fast-path.ts`, `src/cron/life/insight-night-task.ts`, `src/shared/life/context-sections.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `date` | `DATE` | O |  |  |
| `day_pillar` | `TEXT` |  |  |  |
| `month_pillar` | `TEXT` |  |  |  |
| `year_pillar` | `TEXT` |  |  |  |
| `analysis` | `TEXT` | O |  |  |
| `summary` | `TEXT` |  |  |  |
| `warnings` | `JSONB` |  |  |  |
| `recommendations` | `JSONB` |  |  |  |
| `advice` | `TEXT` |  |  |  |
| `model` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `period` | `TEXT` |  | `'daily'` |  |

### `fortune_calls`

- 만든 마이그레이션: `103_fortune_calls.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `scope_start` | `DATE` | O |  |  |
| `scope_end` | `DATE` | O |  |  |
| `claim` | `TEXT` | O |  |  |
| `criterion` | `TEXT` | O |  |  |
| `source` | `TEXT` | O | `'weekly'` |  |
| `status` | `TEXT` | O | `'open'` |  |
| `verdict_note` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |
| `scored_at` | `TIMESTAMPTZ` |  |  |  |

### `ganji_master`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-trigger.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `stem_id` | `INTEGER` | O |  |  |
| `branch_id` | `INTEGER` | O |  |  |

### `life_themes`

- 만든 마이그레이션: `018_diary_tables.sql`
- 봇에서 쓰는 파일: `src/shared/life/context-sections.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `theme` | `TEXT` | O |  |  |
| `category` | `TEXT` |  |  |  |
| `detail` | `TEXT` |  |  |  |
| `active` | `BOOLEAN` |  | `true` |  |
| `source` | `TEXT` |  | `'user'` |  |
| `first_mentioned` | `DATE` |  |  |  |
| `mention_count` | `INTEGER` |  | `1` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `link_weekly_stats`

- 만든 마이그레이션: `080_graded_exposure_and_weekly_stats.sql`
- 봇에서 쓰는 파일: `src/cron/weekly-verification/persist-links.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `link_id` | `INTEGER` | O |  |  |
| `week_start` | `DATE` | O |  |  |
| `e_value` | `NUMERIC` |  |  |  |
| `a` | `INTEGER` |  |  |  |
| `b` | `INTEGER` |  |  |  |
| `c` | `INTEGER` |  |  |  |
| `d` | `INTEGER` |  |  |  |
| `posterior_alpha` | `NUMERIC(8, 2)` |  |  |  |
| `posterior_beta` | `NUMERIC(8, 2)` |  |  |  |
| `p_value` | `NUMERIC` |  |  |  |
| `q_value` | `NUMERIC` |  |  |  |
| `effect` | `NUMERIC` |  |  |  |
| `test_type` | `TEXT` |  |  |  |
| `computed_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `monthly_budget_snapshots`

- 만든 마이그레이션: `041_monthly_budget_snapshots.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: `web/src/features/budget/lib/snapshot/monthly-snapshot-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `year_month` | `VARCHAR(7)` | O |  |  |
| `allocated_budget` | `INTEGER` | O |  |  |
| `fixed_total` | `INTEGER` | O |  |  |
| `installment_total` | `INTEGER` | O |  |  |
| `planned_total` | `INTEGER` | O |  |  |
| `flexible_spent` | `INTEGER` | O |  |  |
| `excluded_spent` | `INTEGER` | O |  |  |
| `income_total` | `INTEGER` | O |  |  |
| `available_at_start` | `INTEGER` | O |  |  |
| `available_at_end` | `INTEGER` | O |  |  |
| `sealed_at` | `TIMESTAMPTZ` | O |  |  |

### `notification_settings`

- 만든 마이그레이션: `007_notifications.sql`
- 봇에서 쓰는 파일: `src/shared/life/queries-notification.ts`, `src/shared/pending-current-state.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `slot_name` | `TEXT` | O |  |  |
| `label` | `TEXT` | O |  |  |
| `time_value` | `TEXT` | O |  |  |
| `active` | `BOOLEAN` | O | `true` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `pattern_catalog`

- 만든 마이그레이션: `051_saju_signal_catalog.sql`
- 바꾼 마이그레이션: `063_pattern_rename.sql`, `064_pattern_trigger_target_type_and_kind.sql`, `071_pattern_signals_pillar_level.sql`, `075_pattern_cleanup.sql`, `081_strength_band_seeds.sql`, `082_relation_hwa_seeds.sql`, `086_signal_seed_precision.sql`
- 봇에서 쓰는 파일: `src/agents/insight/index.ts`, `src/agents/insight/pattern-seed-fast-path.ts`, `src/cron/weekly-report/aggregate-saju.ts`, `src/cron/weekly-verification/response-profile.ts`, `src/shared/pattern/confound-flag.ts`, `src/shared/pattern/match-seeds.ts`, `src/shared/pattern/seed-saturation.ts`, `src/shared/pattern/strength-cutpoints.ts`, `src/shared/pattern/verify-links.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `name` | `TEXT` | O |  |  |
| `sipsin` | `TEXT` |  |  |  |
| `description` | `TEXT` |  |  |  |
| `trigger_target_type` | `TEXT` | O |  |  |
| `trigger_target_id` | `INTEGER` |  |  |  |
| `trigger_aux` | `JSONB` |  |  |  |
| `active` | `BOOLEAN` | O | `true` |  |
| `source` | `TEXT` | O | `'seed'` |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |
| `pattern_kind` | `TEXT` | O | `'saju'` |  |
| `pillar_level` | `VARCHAR(20)` |  |  |  |
| `archived_reason` | `TEXT` |  |  |  |

### `pattern_links`

- 만든 마이그레이션: `077_signal_defs_and_links.sql`
- 봇에서 쓰는 파일: `src/agents/insight/action-transitions.ts`, `src/agents/insight/hypothesis-discovery-load.ts`, `src/agents/insight/hypothesis-discovery-persist.ts`, `src/agents/insight/index.ts`, `src/cron/discovery-recommend.ts`, `src/cron/weekly-verification/persist-links.ts`, `src/cron/weekly-verification/response-profile.ts`, `src/ops/rebaseline-pattern-links.ts`, `src/shared/pattern/confound-flag.ts`, `src/shared/pattern/match-seeds.ts`, `src/shared/pattern/seed-saturation.ts`, `src/shared/pattern/verify-links.ts`, `src/shared/period/forecast-generate.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `seed_id` | `INTEGER` | O |  |  |
| `signal_id` | `INTEGER` | O |  |  |
| `source` | `TEXT` | O | `'manual'` |  |
| `status` | `TEXT` | O | `'active'` |  |
| `hit_count` | `INTEGER` | O | `0` |  |
| `miss_count` | `INTEGER` | O | `0` |  |
| `inconclusive_count` | `INTEGER` | O | `0` |  |
| `last_matched_at` | `TIMESTAMPTZ` |  |  |  |
| `posterior_alpha` | `NUMERIC(8, 2)` | O | `1.0` |  |
| `posterior_beta` | `NUMERIC(8, 2)` | O | `1.0` |  |
| `posterior_p` | `NUMERIC(6, 4)` |  |  |  |
| `test_type` | `TEXT` |  |  |  |
| `effect` | `NUMERIC` |  |  |  |
| `p_value` | `NUMERIC(10, 8)` |  |  |  |
| `q_value` | `NUMERIC(10, 8)` |  |  |  |
| `e_value` | `NUMERIC` |  |  |  |
| `test_detail` | `JSONB` |  |  |  |
| `confound` | `JSONB` |  |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |
| `updated_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `pending_modify`

- 만든 마이그레이션: `044_pending_modify.sql`
- 바꾼 마이그레이션: `045_pending_modify_table_name.sql`
- 봇에서 쓰는 파일: `src/shared/pending-modify.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `token` | `VARCHAR(16)` | O |  |  |
| `user_id` | `INTEGER` | O |  |  |
| `sql_text` | `TEXT` | O |  |  |
| `dry_run_row_count` | `INTEGER` | O |  |  |
| `slack_channel` | `VARCHAR(64)` |  |  |  |
| `slack_thread_ts` | `VARCHAR(32)` |  |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |
| `expires_at` | `TIMESTAMPTZ` | O |  |  |
| `executed_at` | `TIMESTAMPTZ` |  |  |  |
| `canceled_at` | `TIMESTAMPTZ` |  |  |  |
| `table_name` | `VARCHAR(64)` |  |  |  |

### `period_forecasts`

- 만든 마이그레이션: `091_period_forecasts.sql`
- 봇에서 쓰는 파일: `src/shared/period/forecast-generate.ts`, `src/shared/period/forecast-ledger.ts`, `src/shared/period/forecast-rows.ts`, `src/shared/period/forecast-score.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `period_type` | `TEXT` | O |  |  |
| `period_start` | `DATE` | O |  |  |
| `period_end` | `DATE` | O |  |  |
| `signal_id` | `INTEGER` |  |  |  |
| `status` | `TEXT` | O | `'open'` |  |
| `predicted_direction` | `TEXT` |  |  |  |
| `baseline_rate` | `DOUBLE PRECISION` |  |  |  |
| `source_cell` | `JSONB` |  |  |  |
| `measured_rate` | `DOUBLE PRECISION` |  |  |  |
| `measured_delta` | `DOUBLE PRECISION` |  |  |  |
| `direction_hit` | `BOOLEAN` |  |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |
| `scored_at` | `TIMESTAMPTZ` |  |  |  |

### `period_interpretations`

- 만든 마이그레이션: `089_period_interpretations.sql`
- 봇에서 쓰는 파일: `src/shared/period/interpretation-store.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `period_type` | `TEXT` | O |  |  |
| `period_start` | `DATE` | O |  |  |
| `period_end` | `DATE` |  |  |  |
| `pillar` | `TEXT` | O |  |  |
| `structured` | `JSONB` | O |  |  |
| `narrative` | `TEXT` | O |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `planned_expenses`

- 만든 마이그레이션: `032_budget_overhaul.sql`
- 바꾼 마이그레이션: `034_budget_check_constraints.sql`
- 봇에서 쓰는 파일: `src/cron/life/budget-backfill.ts`
- 웹에서 쓰는 파일: `web/src/features/budget/lib/queries/planned.ts`, `web/src/features/budget/lib/repository/expenses-repo.ts`, `web/src/features/budget/lib/repository/planned-repo.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `year_month` | `VARCHAR(7)` | O |  |  |
| `amount` | `INTEGER` | O |  |  |
| `memo` | `VARCHAR(200)` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `reminders`

- 만든 마이그레이션: `007_notifications.sql`
- 바꾼 마이그레이션: `017_reminder_patterns.sql`, `028_reminder_finite.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/shared/life/queries-reminder.ts`, `src/shared/pending-current-state.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `title` | `TEXT` | O |  |  |
| `time_value` | `TEXT` | O |  |  |
| `date` | `DATE` |  |  |  |
| `frequency` | `TEXT` |  |  |  |
| `active` | `BOOLEAN` | O | `true` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `days_of_week` | `INTEGER[]` |  |  |  |
| `days_of_month` | `INTEGER[]` |  |  |  |
| `repeat_interval` | `INTEGER` |  | `1` |  |
| `reference_date` | `DATE` |  |  |  |
| `end_date` | `DATE` |  |  |  |
| `remaining_count` | `INTEGER` |  |  |  |

### `routine_inactive_periods`

- 만든 마이그레이션: `035_routine_inactive_periods.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: `web/src/features/routine/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `template_id` | `INTEGER` | O |  |  |
| `user_id` | `INTEGER` | O |  |  |
| `start_date` | `DATE` | O |  |  |
| `end_date` | `DATE` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `routine_records`

- 만든 마이그레이션: `001_initial_schema.sql`
- 바꾼 마이그레이션: `010_routine_memo_completed_at.sql`, `016_multi_user.sql`, `108_routine_tracking_modes.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/cron/weekly-report/aggregate-correlation.ts`, `src/cron/weekly-report/aggregate-routine.ts`, `src/shared/insights/routine-comparison.ts`, `src/shared/insights/routine-decline.ts`, `src/shared/insights/routine-streak.ts`, `src/shared/life-signal-evaluators/threshold.ts`, `src/shared/life/context-sections.ts`, `src/shared/life/queries-routine.ts`, `src/shared/period/interpretation-stats.ts`
- 웹에서 쓰는 파일: `web/src/features/routine/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `template_id` | `INTEGER` |  |  |  |
| `date` | `DATE` | O |  |  |
| `completed` | `BOOLEAN` |  | `false` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `memo` | `TEXT` |  |  |  |
| `completed_at` | `TIMESTAMPTZ` |  |  |  |
| `user_id` | `INTEGER` |  |  |  |
| `entry_type` | `TEXT` | O | `'scheduled'` |  |

### `routine_templates`

- 만든 마이그레이션: `001_initial_schema.sql`
- 바꾼 마이그레이션: `016_multi_user.sql`, `029_routine_soft_delete.sql`, `035_routine_inactive_periods.sql`, `053_saju_match_infra.sql`, `108_routine_tracking_modes.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/cron/weekly-report/aggregate-correlation.ts`, `src/cron/weekly-report/aggregate-routine.ts`, `src/shared/insights/routine-comparison.ts`, `src/shared/insights/routine-decline.ts`, `src/shared/insights/routine-streak.ts`, `src/shared/life-signal-evaluators/threshold.ts`, `src/shared/life/context-sections.ts`, `src/shared/life/queries-routine.ts`, `src/shared/period/interpretation-stats.ts`
- 웹에서 쓰는 파일: `web/src/features/routine/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `name` | `TEXT` | O |  |  |
| `time_slot` | `TEXT` |  |  |  |
| `frequency` | `TEXT` |  |  |  |
| `active` | `BOOLEAN` |  | `true` |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `user_id` | `INTEGER` |  |  |  |
| `deleted_at` | `TIMESTAMPTZ` |  | `` |  |
| `start_date` | `DATE` | O | `CURRENT_DATE` |  |
| `category` | `TEXT` |  |  |  |
| `tracking_mode` | `TEXT` | O | `'scheduled'` |  |

### `saju_patterns`

- 만든 마이그레이션: `021_saju_patterns.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `pattern_type` | `TEXT` | O |  |  |
| `trigger_element` | `TEXT` | O |  |  |
| `description` | `TEXT` | O |  |  |
| `evidence` | `JSONB` | O | `'[]'` |  |
| `active` | `BOOLEAN` |  | `false` |  |
| `detection_count` | `INTEGER` |  | `1` |  |
| `first_detected` | `DATE` |  |  |  |
| `last_detected` | `DATE` |  |  |  |
| `activated_at` | `TIMESTAMPTZ` |  |  |  |
| `deactivated_at` | `TIMESTAMPTZ` |  |  |  |
| `source` | `TEXT` |  | `'auto'` |  |
| `confidence` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `updated_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

### `saju_profiles`

- 만든 마이그레이션: `017_insight_tables.sql`
- 바꾼 마이그레이션: `019_saju_profile_details.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-context.ts`, `src/shared/saju/cli.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `year_pillar` | `TEXT` | O |  |  |
| `month_pillar` | `TEXT` | O |  |  |
| `day_pillar` | `TEXT` | O |  |  |
| `hour_pillar` | `TEXT` | O |  |  |
| `gender` | `TEXT` | O |  |  |
| `daewun_start_age` | `INTEGER` |  |  |  |
| `daewun_direction` | `TEXT` | O |  |  |
| `daewun_list` | `JSONB` |  |  |  |
| `gyeokguk` | `TEXT` |  |  |  |
| `yongshin` | `TEXT` |  |  |  |
| `profile_summary` | `TEXT` |  |  |  |
| `birth_date` | `DATE` |  |  |  |
| `birth_time` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `strength` | `TEXT` |  |  |  |
| `heeshin` | `TEXT` |  |  |  |
| `gishin` | `TEXT` |  |  |  |
| `hanshin` | `TEXT` |  |  |  |

### `saju_response_profile`

- 만든 마이그레이션: `088_saju_response_profile.sql`
- 봇에서 쓰는 파일: `src/cron/weekly-verification/response-profile.ts`, `src/shared/period/interpretation-store.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `axis_level` | `TEXT` | O |  |  |
| `axis_key` | `TEXT` | O |  |  |
| `element` | `TEXT` |  |  |  |
| `domain` | `TEXT` | O |  |  |
| `tier` | `TEXT` | O |  |  |
| `alpha` | `NUMERIC` | O |  |  |
| `beta` | `NUMERIC` | O |  |  |
| `shrunk_effect` | `NUMERIC` |  |  |  |
| `n_links` | `INTEGER` | O |  |  |
| `n_active_days` | `INTEGER` | O |  |  |
| `stability` | `BOOLEAN` |  |  |  |
| `source_link_ids` | `JSONB` | O |  |  |
| `computed_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `saju_weekly_reviews`

- 만든 마이그레이션: `062_saju_weekly_reviews.sql`
- 봇에서 쓰는 파일: `src/cron/weekly-verification/tasks.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `week_start` | `DATE` | O |  |  |
| `posted_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `schedule_changes`

- 만든 마이그레이션: `053_saju_match_infra.sql`
- 바꾼 마이그레이션: `100_audit_net_displacement.sql`, `106_schedule_delete_reason.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/shared/pattern/data-window.ts`
- 웹에서 쓰는 파일: `web/src/features/schedule/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `schedule_id` | `INTEGER` | O |  |  |
| `change_type` | `TEXT` | O |  |  |
| `before_value` | `JSONB` |  |  |  |
| `after_value` | `JSONB` |  |  |  |
| `changed_at` | `TIMESTAMPTZ` | O | `NOW()` |  |
| `schedule_created_at` | `TIMESTAMPTZ` |  |  |  |
| `delete_reason_category` | `TEXT` |  |  |  |
| `delete_reason_text` | `TEXT` |  |  |  |

### `schedules`

- 만든 마이그레이션: `001_initial_schema.sql`
- 바꾼 마이그레이션: `003_schedule_important.sql`, `016_multi_user.sql`, `026_subcategories.sql`, `027_schedule_updated_at.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/cron/weekly-report/aggregate-schedule.ts`, `src/shared/insights/schedule.ts`, `src/shared/life/context-sections.ts`, `src/shared/life/queries-schedule.ts`
- 웹에서 쓰는 파일: `web/src/features/schedule/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `title` | `TEXT` | O |  |  |
| `date` | `DATE` |  |  |  |
| `end_date` | `DATE` |  |  |  |
| `status` | `TEXT` |  | `'todo'` |  |
| `category` | `TEXT` |  |  |  |
| `memo` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `important` | `BOOLEAN` |  | `false` |  |
| `user_id` | `INTEGER` |  |  |  |
| `subcategory` | `TEXT` |  |  |  |
| `updated_at` | `TIMESTAMPTZ` |  | `now()` |  |

### `seed_daily_activations`

- 만든 마이그레이션: `051_saju_signal_catalog.sql`
- 바꾼 마이그레이션: `063_pattern_rename.sql`, `069_pattern_matches_no_metric.sql`, `075_pattern_cleanup.sql`, `078_seed_daily_activations.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-day.ts`, `src/shared/pattern/seed-saturation.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `date` | `DATE` | O |  |  |
| `pattern_id` | `INTEGER` | O |  |  |
| `trigger_activated` | `BOOLEAN` | O |  |  |
| `matched` | `BOOLEAN` |  |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `sibiunsung_lookup`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-trigger-lookups.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `day_master_stem_id` | `INTEGER` | O |  |  |
| `branch_id` | `INTEGER` | O |  |  |
| `state` | `TEXT` | O |  |  |

### `signal_defs`

- 만든 마이그레이션: `077_signal_defs_and_links.sql`
- 봇에서 쓰는 파일: `src/agents/insight/action-transitions.ts`, `src/agents/insight/hypothesis-discovery-load.ts`, `src/agents/insight/index.ts`, `src/cron/weekly-verification/response-profile.ts`, `src/shared/pattern/confound-flag.ts`, `src/shared/pattern/load-signal-defs.ts`, `src/shared/pattern/match-seeds.ts`, `src/shared/pattern/mirror-signal.ts`, `src/shared/pattern/signal-defs.ts`, `src/shared/pattern/verify-links.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `name` | `TEXT` | O |  |  |
| `kind` | `TEXT` | O |  |  |
| `sql_body` | `TEXT` |  |  |  |
| `value_type` | `TEXT` |  |  |  |
| `direction` | `TEXT` |  |  |  |
| `threshold` | `NUMERIC` |  |  |  |
| `domain` | `TEXT` |  |  |  |
| `window_days` | `INTEGER` |  |  |  |
| `tag_name` | `TEXT` |  |  |  |
| `description` | `TEXT` | O | `''` |  |
| `source` | `TEXT` | O | `'seed'` |  |
| `status` | `TEXT` | O | `'active'` |  |
| `proposed_at` | `TIMESTAMPTZ` |  |  |  |
| `approved_at` | `TIMESTAMPTZ` |  |  |  |
| `created_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `signal_suggest_runs`

- 만든 마이그레이션: `094_signal_suggest_runs.sql`
- 봇에서 쓰는 파일: `src/cron/signal-suggest-fallback.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `month_start` | `DATE` | O |  |  |
| `posted_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `sipsin_lookup`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `day_master_stem_id` | `INTEGER` | O |  |  |
| `target_id` | `INTEGER` | O |  |  |
| `target_type` | `TEXT` | O |  |  |
| `sipsin` | `TEXT` | O |  |  |

### `slack_user_mappings`

- 만든 마이그레이션: `016_multi_user.sql`
- 바꾼 마이그레이션: `039_slack_user_mappings_channels.sql`
- 봇에서 쓰는 파일: `src/shared/user-resolver.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `slack_user_id` | `TEXT` | O |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `life_channel_id` | `TEXT` |  |  |  |
| `insight_channel_id` | `TEXT` |  |  |  |

### `sleep_events`

- 만든 마이그레이션: `008_sleep_events.sql`
- 바꾼 마이그레이션: `105_sleep_schema_hardening.sql`, `107_sleep_signals_and_events_user.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/shared/insights/sleep.ts`, `src/shared/life/queries-sleep.ts`
- 웹에서 쓰는 파일: `web/src/features/sleep/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `date` | `DATE` | O |  |  |
| `event_time` | `TEXT` | O |  |  |
| `memo` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `user_id` | `INTEGER` | O |  |  |

### `sleep_records`

- 만든 마이그레이션: `002_sleep_records.sql`
- 바꾼 마이그레이션: `005_sleep_type.sql`, `009_sleep_nullable.sql`, `016_multi_user.sql`, `105_sleep_schema_hardening.sql`
- 봇에서 쓰는 파일: `src/agents/life/prompt-sections.ts`, `src/cron/weekly-report/aggregate-correlation.ts`, `src/cron/weekly-report/aggregate-sleep.ts`, `src/shared/insights/sleep.ts`, `src/shared/life-signal-evaluators/threshold.ts`, `src/shared/life/context-sleep.ts`, `src/shared/life/queries-sleep.ts`, `src/shared/period/interpretation-stats.ts`
- 웹에서 쓰는 파일: `web/src/features/sleep/lib/queries.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `date` | `DATE` | O |  |  |
| `bedtime` | `TEXT` |  |  |  |
| `wake_time` | `TEXT` |  |  |  |
| `duration_minutes` | `INTEGER` |  |  |  |
| `memo` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |
| `sleep_type` | `TEXT` | O | `'night'` |  |
| `user_id` | `INTEGER` |  |  |  |
| `tags` | `TEXT[]` | O | `'{}'` |  |

### `stem_relations`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `stem_a_id` | `INTEGER` | O |  |  |
| `stem_b_id` | `INTEGER` | O |  |  |
| `relation_type` | `TEXT` | O |  |  |

### `stems_master`

- 만든 마이그레이션: `049_saju_master_schema.sql`
- 봇에서 쓰는 파일: `src/shared/pattern/match-trigger-lookups.ts`, `src/shared/pattern/match-trigger.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `name` | `TEXT` | O |  |  |
| `element` | `TEXT` | O |  |  |
| `yinyang` | `TEXT` | O |  |  |

### `strength_band_cutpoints`

- 만든 마이그레이션: `081_strength_band_seeds.sql`
- 봇에서 쓰는 파일: `src/cron/weekly-verification/persist-links.ts`, `src/shared/pattern/match-day.ts`
- 웹에서 쓰는 파일: 찾지 못함

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `user_id` | `INTEGER` | O |  |  |
| `target` | `TEXT` | O |  |  |
| `low_cut` | `NUMERIC` | O |  |  |
| `high_cut` | `NUMERIC` | O |  |  |
| `n_samples` | `INTEGER` | O |  |  |
| `computed_at` | `TIMESTAMPTZ` | O | `NOW()` |  |

### `users`

- 만든 마이그레이션: `016_multi_user.sql`
- 봇에서 쓰는 파일: `src/cron/life/budget-backfill.ts`
- 웹에서 쓰는 파일: `web/src/lib/users.ts`

| 컬럼 | 타입 | NOT NULL | 기본값 | PK |
| --- | --- | --- | --- | --- |
| `id` | `SERIAL` | O |  | O |
| `kakao_id` | `BIGINT` | O |  |  |
| `nickname` | `TEXT` |  |  |  |
| `email` | `TEXT` |  |  |  |
| `gender` | `TEXT` |  |  |  |
| `birthday` | `TEXT` |  |  |  |
| `age_range` | `TEXT` |  |  |  |
| `profile_image` | `TEXT` |  |  |  |
| `created_at` | `TIMESTAMPTZ` |  | `NOW()` |  |

## 뷰

뷰는 이름과 마지막으로 정의한 마이그레이션만 적는다.

### `pattern_summary`

- 정의한 마이그레이션: `080_graded_exposure_and_weekly_stats.sql`
- 봇에서 쓰는 파일: `src/agents/insight/pattern-seed-fast-path.ts`, `src/cron/weekly-report/aggregate-saju.ts`
- 웹에서 쓰는 파일: 찾지 못함

### `saju_influence_summary`

- 정의한 마이그레이션: `083_confound_adjustment_exposure.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

### `schedule_fate`

- 정의한 마이그레이션: `106_schedule_delete_reason.sql`
- 봇에서 쓰는 파일: 찾지 못함
- 웹에서 쓰는 파일: 찾지 못함

## 해석하지 못한 문장

해석하지 못한 문장은 3개다.
이 문장들이 테이블이나 컬럼을 바꿨다면 위 표에 반영되지 않았으니 해당 마이그레이션을 직접 확인한다.

- `101_signal_semantics.sql`: `FOR rec IN SELECT name, sql_body FROM signal_defs WHERE user_id = 1 AN`
- `107_sleep_signals_and_events_user.sql`: `FOR rec IN SELECT name, sql_body FROM signal_defs WHERE user_id = 1 AN`
- `108_routine_tracking_modes.sql`: `FOR rec IN SELECT name, sql_body FROM signal_defs WHERE user_id = 1 AN`
