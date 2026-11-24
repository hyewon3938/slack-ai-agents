# 웹 API 라우트

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

`route.ts` 파일 40개에서 export한 HTTP 메서드를 한 줄씩 적었다.
인증 확인 칸에는 메서드 함수 본문에서 찾은 호출만 적는다. 인증 모듈에서 가져온 `require`로 시작하는 함수 호출과 `_SECRET`으로 끝나는 환경변수 읽기가 대상이다.
찾지 못함은 본문에 그런 호출이 없다는 뜻이고, 그 라우트가 공개인지는 파일을 열어 확인한다.

| URL | 메서드 | 인증 확인 | 파일 |
| --- | --- | --- | --- |
| `/api/auth` | GET | 찾지 못함 | `web/src/app/api/auth/route.ts` |
| `/api/auth` | DELETE | 찾지 못함 | `web/src/app/api/auth/route.ts` |
| `/api/auth/kakao` | GET | 찾지 못함 | `web/src/app/api/auth/kakao/route.ts` |
| `/api/auth/kakao/callback` | GET | 찾지 못함 | `web/src/app/api/auth/kakao/callback/route.ts` |
| `/api/budget/assets` | GET | `requireAuth()` | `web/src/app/api/budget/assets/route.ts` |
| `/api/budget/assets/[id]` | PATCH | `requireAuth()` | `web/src/app/api/budget/assets/[id]/route.ts` |
| `/api/budget/category-limits` | GET | `requireAuth()` | `web/src/app/api/budget/category-limits/route.ts` |
| `/api/budget/category-limits` | POST | `requireAuth()` | `web/src/app/api/budget/category-limits/route.ts` |
| `/api/budget/category-limits/[id]` | PATCH | `requireAuth()` | `web/src/app/api/budget/category-limits/[id]/route.ts` |
| `/api/budget/category-limits/[id]` | DELETE | `requireAuth()` | `web/src/app/api/budget/category-limits/[id]/route.ts` |
| `/api/budget/daily-logs` | GET | `requireAuth()` | `web/src/app/api/budget/daily-logs/route.ts` |
| `/api/budget/fixed-costs` | GET | `requireAuth()` | `web/src/app/api/budget/fixed-costs/route.ts` |
| `/api/budget/fixed-costs` | POST | `requireAuth()` | `web/src/app/api/budget/fixed-costs/route.ts` |
| `/api/budget/fixed-costs/[id]` | PATCH | `requireAuth()` | `web/src/app/api/budget/fixed-costs/[id]/route.ts` |
| `/api/budget/fixed-costs/[id]` | DELETE | `requireAuth()` | `web/src/app/api/budget/fixed-costs/[id]/route.ts` |
| `/api/budget/monthly` | GET | `requireAuth()` | `web/src/app/api/budget/monthly/route.ts` |
| `/api/budget/planned-expenses` | GET | `requireAuth()` | `web/src/app/api/budget/planned-expenses/route.ts` |
| `/api/budget/planned-expenses` | POST | `requireAuth()` | `web/src/app/api/budget/planned-expenses/route.ts` |
| `/api/budget/planned-expenses` | PATCH | `requireAuth()` | `web/src/app/api/budget/planned-expenses/route.ts` |
| `/api/budget/planned-expenses` | DELETE | `requireAuth()` | `web/src/app/api/budget/planned-expenses/route.ts` |
| `/api/budget/runway` | GET | `requireAuth()` | `web/src/app/api/budget/runway/route.ts` |
| `/api/budget/settings` | GET | `requireAuth()` | `web/src/app/api/budget/settings/route.ts` |
| `/api/budget/settings` | PUT | `requireAuth()` | `web/src/app/api/budget/settings/route.ts` |
| `/api/budget/today` | GET | `requireAuth()` | `web/src/app/api/budget/today/route.ts` |
| `/api/categories` | GET | `requireAuth()` | `web/src/app/api/categories/route.ts` |
| `/api/categories` | POST | `requireAuth()` | `web/src/app/api/categories/route.ts` |
| `/api/categories/[id]` | PATCH | `requireAuth()` | `web/src/app/api/categories/[id]/route.ts` |
| `/api/categories/[id]` | DELETE | `requireAuth()` | `web/src/app/api/categories/[id]/route.ts` |
| `/api/categories/reorder` | POST | `requireAuth()` | `web/src/app/api/categories/reorder/route.ts` |
| `/api/cron/daily-budget-log` | GET | `CRON_SECRET` | `web/src/app/api/cron/daily-budget-log/route.ts` |
| `/api/cron/monthly-settlement` | GET | `CRON_SECRET` | `web/src/app/api/cron/monthly-settlement/route.ts` |
| `/api/expenses` | GET | `requireAuth()` | `web/src/app/api/expenses/route.ts` |
| `/api/expenses` | POST | `requireAuth()` | `web/src/app/api/expenses/route.ts` |
| `/api/expenses/[id]` | PATCH | `requireAuth()` | `web/src/app/api/expenses/[id]/route.ts` |
| `/api/expenses/[id]` | DELETE | `requireAuth()` | `web/src/app/api/expenses/[id]/route.ts` |
| `/api/expenses/summary` | GET | `requireAuth()` | `web/src/app/api/expenses/summary/route.ts` |
| `/api/health` | GET | 찾지 못함 | `web/src/app/api/health/route.ts` |
| `/api/routines` | GET | `requireAuth()` | `web/src/app/api/routines/route.ts` |
| `/api/routines` | POST | `requireAuth()` | `web/src/app/api/routines/route.ts` |
| `/api/routines/[id]` | PATCH | `requireAuth()` | `web/src/app/api/routines/[id]/route.ts` |
| `/api/routines/[id]` | DELETE | `requireAuth()` | `web/src/app/api/routines/[id]/route.ts` |
| `/api/routines/[id]/heatmap` | GET | `requireAuth()` | `web/src/app/api/routines/[id]/heatmap/route.ts` |
| `/api/routines/[id]/inactive-periods` | GET | `requireAuth()` | `web/src/app/api/routines/[id]/inactive-periods/route.ts` |
| `/api/routines/[id]/inactive-periods` | POST | `requireAuth()` | `web/src/app/api/routines/[id]/inactive-periods/route.ts` |
| `/api/routines/[id]/inactive-periods/[periodId]` | PATCH | `requireAuth()` | `web/src/app/api/routines/[id]/inactive-periods/[periodId]/route.ts` |
| `/api/routines/[id]/inactive-periods/[periodId]` | DELETE | `requireAuth()` | `web/src/app/api/routines/[id]/inactive-periods/[periodId]/route.ts` |
| `/api/routines/[id]/records` | DELETE | `requireAuth()` | `web/src/app/api/routines/[id]/records/route.ts` |
| `/api/routines/records` | GET | `requireAuth()` | `web/src/app/api/routines/records/route.ts` |
| `/api/routines/records` | POST | `requireAuth()` | `web/src/app/api/routines/records/route.ts` |
| `/api/routines/records/[id]` | PATCH | `requireAuth()` | `web/src/app/api/routines/records/[id]/route.ts` |
| `/api/routines/records/[id]` | DELETE | `requireAuth()` | `web/src/app/api/routines/records/[id]/route.ts` |
| `/api/routines/stats` | GET | `requireAuth()` | `web/src/app/api/routines/stats/route.ts` |
| `/api/schedules` | GET | `requireAuth()` | `web/src/app/api/schedules/route.ts` |
| `/api/schedules` | POST | `requireAuth()` | `web/src/app/api/schedules/route.ts` |
| `/api/schedules/[id]` | GET | `requireAuth()` | `web/src/app/api/schedules/[id]/route.ts` |
| `/api/schedules/[id]` | PATCH | `requireAuth()` | `web/src/app/api/schedules/[id]/route.ts` |
| `/api/schedules/[id]` | DELETE | `requireAuth()` | `web/src/app/api/schedules/[id]/route.ts` |
| `/api/sleep/dashboard` | GET | `requireAuth()` | `web/src/app/api/sleep/dashboard/route.ts` |
| `/api/sleep/events` | POST | `requireAuth()` | `web/src/app/api/sleep/events/route.ts` |
| `/api/sleep/events/[id]` | DELETE | `requireAuth()` | `web/src/app/api/sleep/events/[id]/route.ts` |
| `/api/sleep/records` | POST | `requireAuth()` | `web/src/app/api/sleep/records/route.ts` |
| `/api/sleep/records/[id]` | PATCH | `requireAuth()` | `web/src/app/api/sleep/records/[id]/route.ts` |
| `/api/sleep/records/[id]` | DELETE | `requireAuth()` | `web/src/app/api/sleep/records/[id]/route.ts` |

## 공개 경로 상수

이름에 PUBLIC이 들어간 문자열 배열 상수와 그 값이다.

- `web/src/proxy.ts`: `/login`, `/api/auth`, `/api/cron`, `/api/health`
