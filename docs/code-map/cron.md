# 크론

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

봇 크론의 발송 시각 원본은 DB `notification_settings` 테이블이다. 코드와 마이그레이션에 적힌 시각은 처음 넣은 값일 수 있어서 이 문서에는 싣지 않았다.

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
