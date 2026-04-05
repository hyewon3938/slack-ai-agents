# Work Log

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
- v3 아키텍처 전환 (Vercel + Neon), 개발 크론 Scheduled Task 통합
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
