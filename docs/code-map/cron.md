# 크론

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

봇 크론의 발송 시각 원본은 DB `notification_settings` 테이블이다. 코드와 마이그레이션에 적힌 시각은 처음 넣은 값일 수 있어서 이 문서에는 싣지 않았다.

## 봇 크론 슬롯

슬롯 11개다. 슬롯 이름은 DB `notification_settings` 행과 핸들러 함수를 연결하는 키다.

| 슬롯 | 핸들러 | 핸들러 파일 | 주석 | 슬롯 이름이 나오는 마이그레이션 |
| --- | --- | --- | --- | --- |
| `morning` | `morningTask` | `src/cron/life/morning-night-tasks.ts` |  | `007_notifications.sql`, `025_morning_time_align.sql` |
| `night` | `nightTask` | `src/cron/life/morning-night-tasks.ts` |  | `005_sleep_type.sql`, `007_notifications.sql`, `023_routine_slot_merge.sql`, `052_saju_seeds.sql`, `107_sleep_signals_and_events_user.sql` |
| `weeklyReport` | `weeklyReportTask` | `src/cron/weekly-report/task.ts` |  | `015_weekly_report_slot.sql` |
| `insightNight` | `insightNightTask` | `src/cron/life/insight-night-task.ts` |  | `017_insight_tables.sql` |
| `dailySajuMatching` | `dailyPatternMatchingTask` | `src/cron/daily-pattern-matching.ts` |  | `051_saju_signal_catalog.sql`, `076_daily_insight.sql` |
| `diaryMetaExtract` | `diaryMetaExtractTask` | `src/cron/diary-meta-extract.ts` |  | `051_saju_signal_catalog.sql`, `054_diary_meta_extract_reschedule.sql` |
| `weeklyVerification` | `weeklyVerificationTask` | `src/cron/weekly-verification/tasks.ts` |  | `079_weekly_verification_slot.sql` |
| `weeklyReviewFallback` | `weeklyReviewFallbackTask` | `src/cron/weekly-verification/tasks.ts` | 월 10:00 — routine 미발송 시 수동 실행 알림 (#542 ADR-0052) | `093_weekly_review_fallback_slot.sql` |
| `signalSuggestFallback` | `signalSuggestFallbackTask` | `src/cron/signal-suggest-fallback.ts` | 월 2일 11:00 — monthly-signal-suggest 미실행 시 알림 (#466 ADR-0058) | `104_signal_suggest_fallback_slot.sql` |
| `discoveryRecommend` | `discoveryRecommendTask` | `src/cron/discovery-recommend.ts` | 07:30 데일리 — 묶음 전부 패스 시 다음 best (#512 ADR-0047) | `087_discovery_recommend_slot.sql` |
| `periodFortune` | `periodFortuneTask` | `src/cron/period-fortune.ts` | 08:20 데일리 — 절기/입춘/대운 전환 시 주기 운세 카드 (#529 ADR-0050) | `090_period_fortune_slot.sql` |

슬롯 표를 선언한 곳은 `src/cron/life/slot-tasks.ts`의 `SLOT_TASKS`이다.

## `cron.schedule` 호출

| 파일 | 위치 | 시각 식 |
| --- | --- | --- |
| `src/cron/life/scheduler.ts` | `CronScheduler.loadAndSchedule` | `cronExpr` |
| `src/cron/life/scheduler.ts` | `CronScheduler.startReminderChecker` | `'* * * * *'` |
| `src/ops/uptime-heartbeat.ts` | `startUptimeHeartbeat` | `HEARTBEAT_CRON = '*/5 * * * *'` |

## Vercel 크론

`web/vercel.json`의 `crons` 항목이다. 이 시각 식은 설정 파일이 원본이고 UTC 기준이다.

| 경로 | 시각 식 |
| --- | --- |
| `/api/cron/daily-budget-log` | `0 20 * * *` |
| `/api/cron/monthly-settlement` | `30 15 * * *` |

## GitHub Actions 예약 실행

| 워크플로 | 시각 식 |
| --- | --- |
| `.github/workflows/uptime-check.yml` | `*/5 * * * *` |
