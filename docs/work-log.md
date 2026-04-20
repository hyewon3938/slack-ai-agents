# Work Log

## 2026-04-19 (일)

### 작업 요약
- 수면 대시보드 시각화 전면 개선 — 밤잠·아침잠·낮잠 3분류 `DailySleep` 타입 도입 (PR #318)
- 낮잠 전용 타임라인(`NapTimeline`) 신규 + 요약 카드 낮잠 통계(5번째 카드) 추가
- 공통 터치 툴팁 훅(`useChartTooltip`) 분리 — 모바일 tap 인터랙션 전 차트에 일괄 적용

### 변경 규모
- 1개 커밋, 1개 PR 머지, 13개 파일, +858 / -211 lines

### 주요 변경
- `web/src/features/sleep/lib/queries.ts` — DailySleep 분류 로직 + `effectiveWakeTime` 계산 재설계 (+184/-34)
- `web/src/features/sleep/components/nap-timeline.tsx` — 낮잠 전용 타임라인 신규 (210줄)
- `web/src/features/sleep/components/sleep-trend-chart.tsx` — 아침잠 반영 추이 차트 재설계 (+228/-95)
- `web/src/features/sleep/hooks/use-chart-tooltip.ts` — 공통 툴팁 훅 신규 (27줄)

### 다음 할 일
- 수면 분석 인사이트(패턴 요약 텍스트 생성) 또는 수면 주간 리포트 검토

## 2026-04-18 (토)

### 작업 요약
- 카드 결제주기 `billing_month` 시스템 전면 도입 — DB 컬럼 추가부터 facade/query/UI까지 수직 완성 (PR #312, #313)
- 대금기간 경계일 14\~13일로 변경 + 프로레이션 제거 + 가용자금 계산 단순화 (PR #310, #311)
- `billing_month` 기준 지출 조회·예산 요약 계산 정합성 확보 (PR #314, #308, #309)

### 변경 규모
- 12개 커밋, 3개 PR 머지, 47개 파일, +509 / -353 lines

### 주요 변경
- `db/migrations/043_billing_month.sql` — billing_month 컬럼 + 카드별 대금기간 모듈 신규
- `web/src/features/budget/lib/billing/cycle.ts` — 대금기간 경계일 14\~13일로 변경
- `web/src/features/budget/lib/queries.ts` — billing_month 기준 지출 조회 로직 전면 수정
- `web/src/features/budget/lib/facade.ts`, `repository/expenses-repo.ts`, `incomes-repo.ts` — billing_month 기준 예산 계산 통일
- `web/src/app/api/expenses/route.ts` — 결제주기 UI 보정 + billing_month 기준 API 정합성 보정

### 다음 할 일
- billing_month 기반 월간 통계 뷰 + 카드사별 정산 리포트 검토

## 2026-04-17 (금)

### 작업 요약
- 수면 차트 데스크탑 hover 툴팁 신규 추가 (PR #305) → 중간기상 중복·우측 끝 잘림 버그 즉각 수정 (PR #306) → sleep_events JOIN 쿼리 롤백 + JS 중복 제거로 전환 (PR #307)
- 예정지출 연결 지출 일일 예산 이중 차감 버그 수정 + 수정 모달 연결 폼 추가 (PR #303)
- 예정지출 수정 모달 신규 구현 + 연결 지출 내역 표시 (PR #304)
- 아침/밤 크론 톤 + 달성률 개선 (PR #302)

### 변경 규모
- 6개 커밋, 5개 PR 머지, 18개 파일, +704 / -147 lines

### 주요 변경
- `web/src/features/sleep/components/sleep-timeline.tsx`, `sleep-trend-chart.tsx` — 툴팁 신규 (+123줄) + 버그 수정 (+20/-11)
- `web/src/features/sleep/lib/queries.ts` — JOIN 쿼리 롤백, JS 레벨 중복 제거로 전환
- `web/src/features/budget/components/planned-expense-edit-modal.tsx` — 수정 모달 신규 (201줄)
- `web/src/features/budget/components/planned-expense-list.tsx` — 수정 모달 연결 + 이중 차감 방어
- `web/src/features/budget/lib/repository/__tests__/expenses-repo.test.ts` — 이중 차감 회귀 테스트 추가 (75줄)
- `src/cron/life-cron.ts` — 밤 크론 현황 톤 + 아침 크론 어제 달성률 추가

### 다음 할 일
- 예정지출 삭제/연결 해제 UX 검토

## 2026-04-16 (목)

### 작업 요약
- 루틴 시작일 이전 체크리스트 생성 방어 + 이전 기록 자동 정리 기능 추가 (PR #300, #301)
- 예산 도메인 강화 — projectFromAllocator 계산 정합성 통합 + 수입 옵션 추가 + 감사 테스트 확대 (PR #295, #299)
- Gemini provider 완전 제거 — LLM 스택을 Claude 단일화 (PR #297/#298)

### 변경 규모
- 6개 커밋, 38개 파일, +986 / -1237 lines

### 주요 변경
- `src/shared/life-queries.ts`, `web/src/app/api/routines/[id]/` — 루틴 시작일 경계 검사 + 이전 기록 정리 API
- `web/src/features/budget/lib/allocator/runway-projection.ts` — projectFromAllocator 도입, 설정/분석 계산 일치 보장
- `docs/domains/budget-spec.md` — 기능 명세 193줄 신규 + 테스트 파일 3개 (\~360줄) 추가
- `src/shared/llm.ts`, `src/shared/__tests__/llm.test.ts` — Gemini 관련 코드 전면 제거 (-1134줄)

### 다음 할 일
- 루틴 시작일 변경 + 월 전환 엣지케이스 동작 검증

## 2026-04-15 (수)

### 작업 요약
- 예산 도메인 v2 아키텍처 전환 완료 — TDD 기반 계산 엔진 → Repository/Facade → API → v1 제거 수직 완성 (PR #284, #286, #288, #290, #292, #293)
- insight 일기 저장 안정화 — LLM 경로 제거 + 날짜 경계 5시 적용 (#279)
- 수면 기록 user_id 검증 면제 버그 수정 (#281)

### 변경 규모
- 9개 커밋, 71개 파일, +2492 / -1553 lines

### 주요 변경
- `web/src/features/budget/lib/allocator/` — 순수 함수 계산 엔진 신규 (day-allocator, month-allocator, proration, runway-projection)
- `web/src/features/budget/lib/repository/` — 도메인별 Repository 레이어 10개 신규
- `web/src/features/budget/lib/facade.ts` — Facade 통합 레이어 (+145줄)
- `web/src/features/budget/lib/budget-calc.ts` — v1 삭제 (-289줄)
- `db/migrations/042_drop_budgets_table.sql` — v1 budgets 테이블 DROP
- `src/agents/insight/diary-fast-path.ts` — LLM 경로 제거, fast path 단일화

### 다음 할 일
- Slack 에이전트에서 v2 API 연동 확인
- 월 정산 cron 실제 동작 검증 (월 초 전환 시점)

## 2026-04-14 (화)

### 작업 요약
- Next.js 중첩 라우팅으로 탭 전환 구조 전환 — 클라이언트 상태 → URL 기반 라우팅 (#277)
- useSearchParams Suspense 래핑 누락 즉시 수정 (#278)
- insight 밤 알림에 오늘 일기 내용 포함 (#275)

### 변경 규모
- 3개 커밋, 34개 파일, +967 / -527 lines

### 주요 변경
- `web/src/app/schedules/`, `budget/`, `life/` — 도메인별 중첩 레이아웃 + 서브 라우트 신규 분리 (31개 파일)
- `web/src/components/ui/tabs.tsx` — URL 기반 탭 컴포넌트 신규 추가 (58줄)
- `src/cron/life-cron.ts` — 밤 알림에 오늘 일기 내용 포함

### 다음 할 일
- 새 라우팅 구조 실제 동작 검증 (네비게이션 히스토리, 뒤로가기 UX)

## 2026-04-13 (일)

### 작업 요약
- 수면 대시보드 신규 개발 (feat #266) + 모바일 UX 세밀화 연속 수정 (#267\~274)
- LLM 비용 최적화 — 프롬프트 캐싱 + insight fast path + 크론 정리 (#262)
- 예산·리마인더·insight 버그 수정 (#258, #259, #260, #264)

### 변경 규모
- 15개 커밋, \~60개 파일, +2047 / -687 lines

### 주요 변경
- `web/src/features/sleep/` — 수면 시각화 전체 신규 (timeline, trend-chart, summary-cards, period-selector, queries, types)
- `src/shared/llm.ts`, `src/agents/insight/` — 프롬프트 캐싱 + 일기 fast path 도입, 크론 통합 정리
- `web/src/features/budget/lib/budget-calc.ts` — 예산 계산 버그 2종 수정 + 단위 테스트 추가

### 다음 할 일
- 수면 대시보드 sleep-day-pattern 컴포넌트 연결 확인
- LLM 비용 절감 효과 모니터링

## 2026-04-06 (일)

### 작업 요약
- 지출/예산 도메인 전체 수직 완성 — DB 스키마부터 대시보드 UI까지 (Issue #162, PR #163\~#168)
- 보안 이슈(개인정보 하드코딩) 발견 및 즉시 수정 (PR #167)
- 도메인별 타입 파일·문서 분리 리팩토링 (PR #164)
- 네비게이션 일정/루틴/지출 3탭 체제 전환

### 변경 규모
- 16개 커밋, 60+ 파일, +\~3700 / -\~600 lines

### 주요 변경
- `db/migrations/030_budget_expenses.sql` — expenses, budget_settings, assets, fixed_costs 테이블 추가
- `src/agents/money/` — #money 채널 지출 Slack 에이전트 신규 추가
- `web/src/app/api/budget/`, `web/src/app/api/expenses/` — 지출/예산 API 엔드포인트 8개 추가
- `web/src/features/budget/components/` — 대시보드 UI 전체 (budget-page, category-chart, expense-form, expense-list, month-summary, runway-card, settings-panel)
- `web/src/components/ui/icons.tsx` — 아이콘 시스템 신규 구축 (226줄)
- `docs/domains/budget.md`, `routine.md`, `schedule.md`, `insight.md` — 도메인별 문서 분리
- `web/src/features/*/lib/types.ts` — 도메인별 타입 파일 분리

### 다음 할 일
- 지출 도메인 추가 기능(카테고리 분석, 월별 트렌드 등) 검토

## 2026-03-17 (화)

### 작업 요약
- 아침 크론이 잘못된 날짜의 수면 기록을 참조하는 버그 수정 (PR #145)
- 루틴 N일마다 빈도 패턴을 동적으로 파싱하여 매일 생성되는 버그 수정 (PR #144)
- 탭 복귀 시 일정 추가 기본 날짜가 갱신되지 않는 버그 수정 (PR #143)
- PWA 아이콘 & 파비콘 픽셀아트 캐릭터로 교체 후 배경 투명 처리

### 변경 규모
- 5개 커밋, 9개 파일, +67 / -56 lines

### 주요 변경
- `src/shared/life-context.ts` — 아침 크론 수면 기록 날짜 참조 버그 수정 (#145)
- `src/shared/life-queries.ts` — 루틴 N일마다 빈도 패턴 동적 파싱으로 근본 해결 (#144)
- `web/src/features/schedule/hooks/use-schedules.ts` — 탭 복귀 시 날짜 미갱신 수정 (#143)
- `web/public/` — PWA 아이콘 4종 + 파비콘 픽셀아트 교체

### 다음 할 일
- Issues #7\~#10 착수 검토 (fortune, diet, expense 등)

## 2026-03-15 (일)

### 작업 요약
- 대시보드 UX 집중 다듬기: ActionMenu Portal 전환(z-index 근본 해결), 주간뷰 스페이서 열별 계산, 삭제 확인 다이얼로그 추가, 카테고리 태그/주간뷰 여백/메모 확대 (PR #126\~#131, 5개 PR 머지)
- Slack 봇 일정 표시 전면 수정 — 메모 제거 + event 타입 분리 (PR #132\~#133)
- event 타입 카테고리 UX 개선 — 상태 버튼 숨김 + overdue 제외 (PR #136\~#137)
- 루틴 created_at 기준 달성률 분기 처리 버그 수정 (PR #138\~#139)
- Opus 일운/월운 분석 품질 개선 + saju-calendar 유틸 신규 작성 + 테스트 추가 (PR #134\~#135)
- 주간뷰 오늘 날짜 동그라미 밀림 수정 + 간격 조정

### 변경 규모
- 20개 커밋, PR 6개 머지, 순 변경 12개 파일, +341 / -64 lines

### 주요 변경
- `web/src/features/schedule/components/action-menu.tsx` — Portal 패턴으로 z-index stacking context 문제 근본 해결 (#129)
- `src/shared/saju-calendar.ts` — 사주 달력 유틸리티 신규 (104줄, 테스트 101줄 포함)
- `src/agents/life/blocks.ts` — Slack 일정 블록 전면 수정, event 타입 분리 (#132)
- `src/cron/weekly-report.ts` + `src/shared/insights.ts` — 루틴 created_at 기준 달성률 분기 처리 (#138)

### 미완료
- Issues #7\~#10 미착수 (fortune, diet, expense 등)

### 다음 할 일
- Issues #7\~#10 착수 검토

## 2026-03-12 (수)

### 작업 요약
- 프로액티브 인사이트 시스템 완성 → PR #106 머지 (5가지 패턴 감지 엔진 + 주간 리포트 + 크론 연동)
- 대시보드 UX 개선 PR #104 머지 (색상 프리셋/정렬/Optimistic UI/스켈레톤)
- 테스트 커버리지 PR #102 머지 (router, calendar-utils, kst, types)
- Next.js 캐싱 PR #100 머지 (unstable_cache + revalidateTag)
- CI/CD Slack 배포 알림 PR #98 머지
- v3 아키텍처 전환 (Vercel + VM PostgreSQL), 개발 크론 Scheduled Task 통합
- README 포트폴리오 전략 정비 + developer-profile 구조 개편

### 변경 규모
- 33개 커밋, 81개 파일, +4001 / -1055 lines

### 주요 변경
- `src/shared/insights.ts` — 신규: 인사이트 감지 엔진 (276줄, 5가지 패턴 감지)
- `src/cron/weekly-report.ts` — 신규: 주간 리포트 (382줄, SQL 집계 + Gemini 총평)
- `src/shared/__tests__/insights.test.ts` — 인사이트 테스트 (428줄)
- `src/cron/life-cron.ts` — 아침/밤 크론에 인사이트 넛지 연동
- `src/agents/life/prompt.ts` — 자연어 분석 가이드 추가 (크로스 분석 SQL 패턴)
- `web/src/lib/cache.ts` — Next.js 캐싱 유틸리티 신규
- `src/cron/dev-cron.ts` — 삭제 (Scheduled Task로 통합)

### 미완료
- Issues #7~#10 미착수 (fortune, diet, expense 등)

### 다음 할 일
- 인사이트 시스템 실제 운영 검증 (패턴 감지 정확도)
- 주간 리포트 크론 슬롯 실제 동작 확인

## 2026-03-11 (화)

### 작업 요약
- 웹 대시보드 PR #74 최종 완료 및 머지 — 코드 리뷰 반영 (보안 강화, 에러 처리, 컨벤션)
- 드래그 양방향 리사이즈 + 주간뷰 카드 통일 + 모바일/데스크탑 레이아웃 완성
- 로그인 세션 버그 수정 + Docker 빌드 수정 (web/public/.gitkeep)

### 변경 파일
- `web/src/` (다수) — 코드 리뷰 반영: 보안 강화, 에러 처리, 컨벤션 정비 (+266/-88)
- `web/src/components/calendar/dnd-calendar.tsx`, `week-view.tsx` — 드래그 양방향 리사이즈 + 카드 통일 (+423/-176)
- `web/src/app/login/page.tsx`, `web/src/lib/auth.ts` — SESSION_SECRET 길이 + 쿠키 타이밍 버그 수정
- `web/src/app/layout.tsx` 등 — 일정 상태순 정렬 + 주간뷰 배경 + 모바일 safe area
- `docs/conventions.md`, `docs/project-history.md` — 신규 작성 (컨벤션 문서화)
- `web/public/.gitkeep` — Docker COPY 실패 방지
- `src/agents/life/prompt.ts` — 루틴 메모 덮어쓰기 방식으로 수정

### 미완료
- Issues #7~#10 미착수 (fortune, diet, expense 등)
- 웹 대시보드 배포 후 실제 동작 검증

### 다음 할 일
- 웹 대시보드 Oracle Cloud 배포 확인 (`yarn deploy`)
- Issues #7~#10 중 다음 기능 착수 (식단 또는 지출 관리)

## 2026-03-10 (월)

### 작업 요약
- 백로그/내일일정 fast path 추가 — LLM 없이 SQL 직접 조회로 응답 (Block Kit 카드)
- GitHub Actions CI/CD 구축 — PR 체크(테스트/린트) + main 푸시 시 자동 배포
- 수면 기록 프롬프트 강화 — 날짜 오인/임의 생성/자동 관찰 기록 문제 해결
- lint 에러 수정 — non-null assertion, console.log 정리
- 생활 맥락 인식 잔소리 시스템 구현 + LLM 비용 최적화 + AI 개발 워크플로우 자동화
- README 포트폴리오 리뉴얼 — 스크린샷, 개발자 프로필 공개

### 변경 파일
- `src/agents/life/index.ts` — 백로그/내일일정 fast path 정규식 매칭 (+45줄)
- `src/agents/life/blocks.ts` — 백로그/내일일정 Block Kit 카드 빌더 (+44줄)
- `src/shared/life-queries.ts` — 백로그/내일일정 SQL 조회 함수 추가
- `src/agents/life/actions.ts` — 버튼 핸들러 fast path 연동
- `.github/workflows/ci.yml` — 신규: PR 체크 워크플로우 (테스트/린트)
- `.github/workflows/deploy.yml` — 신규: main 자동 배포 워크플로우
- `src/agents/life/prompt.ts` — 수면 기록 날짜 오인 방지 규칙 강화
- `src/shared/life-context.ts` — 신규: 생활 맥락 분석 + 잔소리 생성 (305줄)
- `src/shared/llm.ts` — 하이브리드 모델 지원 추가
- `src/cron/life-cron.ts` — 생활 맥락 기반 잔소리 통합 + lint 수정
- `db/migrations/010_routine_memo_completed_at.sql` — 루틴 메모/완료시각 컬럼
- `docs/developer-profile.md` — 신규: 개발자 프로필 공개
- `README.md` — 포트폴리오용 대규모 리뉴얼 + 스크린샷 추가

### 미완료
- Issues #7~#10 미착수 (fortune, diet 등)
- CI/CD 배포 자동화 실제 동작 검증

### 다음 할 일
- Issues #7~#10 중 다음 기능 착수 (식단 또는 지출 관리)
- fast path 패턴 추가 확장 (자주 쓰는 조회 커버리지 넓히기)
